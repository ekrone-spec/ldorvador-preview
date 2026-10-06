/* Range support for the hero videos.
 *
 * Workers static assets always answer 206-style Range requests with a 200 and
 * the whole file, which Safari refuses to treat as seekable media. This
 * worker runs first for /assets/vid/* only, fetches the asset, and slices the
 * requested byte range itself. Everything else is served as plain assets.
 */
import puppeteer from '@cloudflare/puppeteer';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GROUP_DAILY_CAP = 200;
const GLOBAL_EMAIL_DAILY_CAP = 150;
import {
  DEFAULT_NOTIFY_TO, utcDayStartIso, EMAIL_COLORS, EMAIL_FONT_LINK, EMAIL_SANS, EMAIL_SERIF, IP_SALT, PROD_ORIGIN, base64UrlToBytes, base64UrlToJson, clampStr, csvField, emailAssetOrigin, emailButton, emailFooterLockup, emailHeaderLockup, emailShell, escapeHtml, fetchAccessJwks, json, readFields, sameOrigin, sendResendEmail, sha256Hex, truthy, verifyAccessJwt, verifyTurnstile,
} from './shared.js';
import { handleBookPost, handleDetails, handleStripeWebhook } from './bookings.js';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function sanitizeFilename(name) {
  // strip accents to ASCII (Curaçao -> Curacao) instead of deleting the letter
  const ascii = String(name || 'trip-details').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const base = ascii.trim().replace(/[^A-Za-z0-9 _.-]/g, '').trim() || 'trip-details';
  return `${base}.pdf`;
}

async function fetchGroupPdfBase64(env, request, groupSlug) {
  try {
    const { buf } = await getGroupPdfBuffer(env, request, groupSlug);
    if (!buf) {
      console.warn(`No trip-details PDF for group "${groupSlug}"`);
      return null;
    }
    if (buf.byteLength > MAX_PDF_BYTES) {
      console.warn(`Trip-details PDF for group "${groupSlug}" is ${buf.byteLength} bytes, exceeds ${MAX_PDF_BYTES} cap; skipping attachment`);
      return null;
    }
    return bytesToBase64(new Uint8Array(buf));
  } catch (err) {
    console.warn(`Failed to fetch trip-details PDF for group "${groupSlug}"`, err);
    return null;
  }
}

/* ---- On-demand trip-details PDF: /groups/<slug>/trip-details.pdf ----
 *
 * Cache key is `${slug}:${etag}` in KV (PDF_CACHE), where `etag` is the
 * ETag (or a content hash fallback) of the group's print.html asset — so
 * editing a trip in the CMS invalidates the cached PDF automatically the
 * next time it's requested, with no explicit purge step.
 *
 * Rendering uses the Browser Rendering binding (free plan: 10 browser-
 * minutes/day, 3 concurrent, 60s timeout), so it must stay rare: every hit
 * after the first for a given print.html version is served straight out of
 * KV. If a render fails (including the daily/concurrency limit being hit),
 * we fall back to serving *any* previously-cached PDF for the same slug
 * (a stale-but-real brochure) rather than a hard error.
 */
async function findGroupPrintEtag(env, request, slug) {
  const printResp = await env.ASSETS.fetch(new Request(new URL(`/groups/${slug}/print.html`, request.url)));
  if (!printResp.ok) {
    if (printResp.body) printResp.body.cancel().catch(() => {});
    return null;
  }
  let etag = printResp.headers.get('etag');
  if (etag) {
    if (printResp.body) printResp.body.cancel().catch(() => {});
    return etag.replace(/^W\//, '').replace(/"/g, '');
  }
  // No ETag header (unlikely for static assets, but be defensive): hash a
  // cheap fingerprint of the response instead of the whole body.
  const buf = await printResp.arrayBuffer();
  return sha256Hex(`${buf.byteLength}:${printResp.headers.get('last-modified') || ''}`);
}

async function renderGroupPdfBuffer(env, request, slug) {
  const origin = new URL(request.url).origin;
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
    await page.goto(`${origin}/groups/${slug}/print.html`, { waitUntil: 'networkidle0', timeout: 45000 });
    return await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, scale: 1 });
  } finally {
    await browser.close();
  }
}

async function findAnyStaleGroupPdf(env, slug) {
  const list = await env.PDF_CACHE.list({ prefix: `${slug}:` });
  for (const k of list.keys) {
    const buf = await env.PDF_CACHE.get(k.name, 'arrayBuffer');
    if (buf) return buf;
  }
  return null;
}

/**
 * Returns { buf, notFound }. `buf` is an ArrayBuffer of the PDF, or null.
 * `notFound` is true only when the group itself doesn't exist (no
 * print.html) — a render failure with no stale fallback returns
 * { buf: null, notFound: false } instead, so callers can tell "no such
 * trip" apart from "temporarily unavailable".
 */
async function getGroupPdfBuffer(env, request, slug) {
  const etag = await findGroupPrintEtag(env, request, slug);
  if (!etag) return { buf: null, notFound: true };

  const cacheKey = `${slug}:${PDF_RENDER_VERSION}-${etag}`;
  const cached = await env.PDF_CACHE.get(cacheKey, 'arrayBuffer');
  if (cached) return { buf: cached, notFound: false };

  try {
    const rendered = await renderGroupPdfBuffer(env, request, slug);
    await env.PDF_CACHE.put(cacheKey, rendered);
    return { buf: rendered, notFound: false };
  } catch (err) {
    console.error(`PDF render failed for group "${slug}"`, err);
    const stale = await findAnyStaleGroupPdf(env, slug);
    return { buf: stale, notFound: false };
  }
}

async function handleGroupPdfRoute(request, env, slug) {
  const { buf, notFound } = await getGroupPdfBuffer(env, request, slug);
  if (notFound) return new Response('Not found', { status: 404 });
  if (!buf) {
    return new Response('Trip details PDF is temporarily unavailable; please try again shortly.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
    });
  }
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${slug}-trip-details.pdf"`,
    'Cache-Control': 'public, max-age=3600',
  });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(buf, { status: 200, headers });
}

async function sendInterestEmails(env, fields, groupCount, request, registrantOnly = false) {
  const { full_name, email, phone, travelers, room, beds, comments, group_slug, group_title, group_dates, contact_phone } = fields;
  const roomLine = room ? (beds ? `${room}, ${beds}` : room) : '';
  const firstName = (full_name || '').trim().split(/\s+/)[0] || full_name;
  const titleForCopy = group_title || group_slug;
  const dateLine = group_dates ? `, ${escapeHtml(group_dates)}` : '';
  const dateLineText = group_dates ? `, ${group_dates}` : '';
  const groupUrl = `https://www.ldorvadortravel.com/groups/${group_slug}/`;
  const phoneSentence = contact_phone ? `Questions? Reply to this email or call ${contact_phone}.` : 'Questions? Reply to this email.';
  const phoneSentenceHtml = contact_phone
    ? `Questions? Reply to this email or call ${escapeHtml(contact_phone)}.`
    : 'Questions? Reply to this email.';

  const emailOrigin = emailAssetOrigin(request);
  const pdfBase64 = await fetchGroupPdfBase64(env, request, group_slug);
  const attachmentFilename = sanitizeFilename(titleForCopy);
  const pdfSentenceHtml = pdfBase64
    ? `The trip details are attached as a PDF, and always available on <a href="${groupUrl}" style="color:${EMAIL_COLORS.sage};">the trip page</a>.`
    : `The trip details are always available on <a href="${groupUrl}" style="color:${EMAIL_COLORS.sage};">the trip page</a>.`;
  const pdfSentenceText = pdfBase64
    ? `The trip details are attached as a PDF, and always available at ${groupUrl}.`
    : `The trip details are always available at ${groupUrl}.`;

  const registrantHtml = emailShell({
    title: `We've registered your interest — ${escapeHtml(titleForCopy)}`,
    preheader: `Your expression of interest for ${escapeHtml(titleForCopy)} has been received.`,
    eyebrow: 'Expression of interest received',
    heading: escapeHtml(titleForCopy),
    bodyHtml: `
      ${group_dates ? `<p style="margin:0 0 18px;font-family:${EMAIL_SANS};font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:${EMAIL_COLORS.inkSoft};">${escapeHtml(group_dates)}</p>` : ''}
      <p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 16px;">We've registered your interest in <strong>${escapeHtml(titleForCopy)}</strong>${dateLine}.</p>
      <p style="margin:0 0 16px;">${pdfSentenceHtml}</p>
      <p style="margin:0 0 22px;">This is not a booking. We will contact you once the program and booking details are finalized.</p>
      ${emailButton(groupUrl, 'View the trip page')}
      <p style="margin:26px 0 16px;">${phoneSentenceHtml}</p>
      <p style="margin:0;">Warmly,<br>Hannah Berkeley Cohen<br>L&rsquo;Dor Vador Travel</p>
    `,
    footerNote: 'L&rsquo;Dor Vador Travel',
    origin: emailOrigin,
  });
  const registrantText =
    `Hi ${firstName},\n\n` +
    `We've registered your interest in ${titleForCopy}${dateLineText}.\n\n` +
    `${pdfSentenceText}\n\n` +
    `This is not a booking. We will contact you once the program and booking details are finalized.\n\n` +
    `View the trip page: ${groupUrl}\n\n` +
    `${phoneSentence}\n\n` +
    `Warmly,\nHannah Berkeley Cohen\nL'Dor Vador Travel\n\nwww.ldorvadortravel.com`;

  const registrantPayload = {
    from: "L'Dor Vador Travel <connect@ldorvadortravel.com>",
    to: [email],
    reply_to: 'connect@ldorvadortravel.com',
    subject: `We've registered your interest — ${titleForCopy}`,
    html: registrantHtml,
    text: registrantText,
  };
  if (pdfBase64) {
    registrantPayload.attachments = [{ filename: attachmentFilename, content: pdfBase64 }];
  }

  const notifyTo = (env.NOTIFY_TO || DEFAULT_NOTIFY_TO).split(',').map((s) => s.trim()).filter(Boolean);
  const notifyText =
    `Group: ${titleForCopy} (${group_slug})\n` +
    `Name: ${full_name}\nEmail: ${email}\nPhone: ${phone || ''}\n` +
    `Travelers: ${travelers}\nRoom: ${roomLine}\nComments: ${comments || ''}\n\n` +
    `Registrations for this group so far: ${groupCount}\n` +
    `PDF attached to confirmation: ${pdfBase64 ? 'yes' : 'no'}`;

  function notifyRow(label, value) {
    return `<tr>
      <td style="padding:8px 12px 8px 0;font-family:${EMAIL_SANS};font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${EMAIL_COLORS.inkSoft};white-space:nowrap;vertical-align:top;">${label}</td>
      <td style="padding:8px 0;font-family:${EMAIL_SANS};font-size:16px;color:${EMAIL_COLORS.ink};border-bottom:1px solid ${EMAIL_COLORS.line};">${value || '&mdash;'}</td>
    </tr>`;
  }
  const notifyHtml = emailShell({
    title: `Expression of interest: ${escapeHtml(titleForCopy)} — ${escapeHtml(full_name)}`,
    preheader: `New expression of interest from ${escapeHtml(full_name)} for ${escapeHtml(titleForCopy)}.`,
    eyebrow: 'New expression of interest',
    heading: escapeHtml(titleForCopy),
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
        ${notifyRow('Group', `${escapeHtml(titleForCopy)} (${escapeHtml(group_slug)})`)}
        ${notifyRow('Name', escapeHtml(full_name))}
        ${notifyRow('Email', escapeHtml(email))}
        ${notifyRow('Phone', escapeHtml(phone || ''))}
        ${notifyRow('Travelers', escapeHtml(String(travelers)))}
        ${notifyRow('Room', escapeHtml(roomLine))}
        ${notifyRow('Comments', escapeHtml(comments || ''))}
      </table>
      <p style="margin:0 0 8px;">Registrations for this group so far: <strong>${groupCount}</strong></p>
      <p style="margin:0;">PDF attached to confirmation: <strong>${pdfBase64 ? 'yes' : 'no'}</strong></p>
    `,
    footerNote: 'L&rsquo;Dor Vador Travel &mdash; internal notification',
    origin: emailOrigin,
  });

  if (registrantOnly) {
    const only = await Promise.allSettled([sendResendEmail(env, registrantPayload)]);
    return only[0].status === 'fulfilled' && only[0].value;
  }
  const results = await Promise.allSettled([
    sendResendEmail(env, registrantPayload),
    sendResendEmail(env, {
      from: "L'Dor Vador Travel <connect@ldorvadortravel.com>",
      to: notifyTo,
      reply_to: 'connect@ldorvadortravel.com',
      subject: `Expression of interest: ${titleForCopy} — ${full_name}`,
      html: notifyHtml,
      text: notifyText,
    }),
  ]);

  const [registrantResult] = results;
  for (const r of results) {
    if (r.status === 'rejected') console.error('Resend send failed', r.reason);
  }
  return registrantResult.status === 'fulfilled';
}

async function handleInterestPost(request, env, url) {
  if (!sameOrigin(request, url)) return json({ ok: false, error: 'forbidden' }, 403);

  let fields;
  try {
    fields = await readFields(request);
  } catch {
    return json({ ok: false, error: 'invalid body' }, 400);
  }

  if (truthy(fields.botcheck)) {
    return json({ ok: true }, 200);
  }

  const full_name = clampStr(fields.full_name, 200);
  const email = clampStr(fields.email, 200);
  const phone = clampStr(fields.phone, 200);
  const group_slug = clampStr(fields.group, 200);
  const group_title = clampStr(fields.group_title, 200);
  const comments = clampStr(fields.comments, 4000);
  const roomRaw = clampStr(fields.room, 20);
  const VALID_ROOMS = ['Single (1 bed)', 'Double (1 bed)', 'Double (2 beds)', 'single', 'double'];
  const room = VALID_ROOMS.includes(roomRaw) ? roomRaw : '';
  const beds = clampStr(fields.beds, 20); // legacy field, no longer required or validated

  if (!full_name || !email || !group_slug) {
    return json({ ok: false, error: 'missing required fields' }, 400);
  }
  if (!email.includes('@')) {
    return json({ ok: false, error: 'invalid email' }, 400);
  }
  if (roomRaw && room === '') {
    return json({ ok: false, error: 'invalid room' }, 400);
  }

  let travelers = parseInt(fields.travelers, 10);
  if (Number.isNaN(travelers)) travelers = 1;
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 20) {
    return json({ ok: false, error: 'invalid travelers' }, 400);
  }

  const group_dates = clampStr(fields.group_dates, 200);
  const contact_phone = clampStr(fields.contact_phone, 60);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ip_hash = await sha256Hex(ip + IP_SALT);
  const user_agent = clampStr(request.headers.get('User-Agent') || '', 500);

  const turnstileToken = clampStr(fields['cf-turnstile-response'], 3000);
  const turnstile = await verifyTurnstile(turnstileToken, ip, env);
  if (turnstile.unavailable) {
    return json({ ok: false, error: 'captcha_unavailable' }, 503);
  }
  if (!turnstile.ok) {
    return json({ ok: false, error: 'captcha' }, 400);
  }

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { results: countRows } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM interest WHERE ip_hash = ? AND created_at >= ?')
    .bind(ip_hash, windowStart)
    .all();
  const count = (countRows && countRows[0] && countRows[0].n) || 0;
  if (count >= RATE_LIMIT_MAX) {
    return json({ ok: false, error: 'rate limited' }, 429);
  }

  const emailLower = email.toLowerCase();
  const dedupeStart = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { results: dupeRows } = await env.DB
    .prepare(
      'SELECT id FROM interest WHERE lower(email) = ? AND group_slug = ? AND created_at >= ? LIMIT 1'
    )
    .bind(emailLower, group_slug, dedupeStart)
    .all();
  if (dupeRows && dupeRows.length) {
    // Repeat within the window: no new row, no internal notification, but the
    // person still gets their confirmation (a resubmission is not spam; the
    // IP rate limit above still caps volume).
    if (env.RESEND_API_KEY) {
      try {
        await sendInterestEmails(env,
          { full_name, email, phone, travelers, room, beds, comments, group_slug, group_title, group_dates, contact_phone },
          0, request, true);
      } catch (err) { console.error('Resend resend-on-duplicate failed', err); }
    }
    return json({ ok: true }, 200);
  }

  const dayStart = utcDayStartIso(Date.now());
  const { results: groupCountRows } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM interest WHERE group_slug = ? AND created_at >= ?')
    .bind(group_slug, dayStart)
    .all();
  const groupCountToday = (groupCountRows && groupCountRows[0] && groupCountRows[0].n) || 0;

  const { results: emailedCountRows } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM interest WHERE emailed = 1 AND created_at >= ?')
    .bind(dayStart)
    .all();
  const emailedToday = (emailedCountRows && emailedCountRows[0] && emailedCountRows[0].n) || 0;

  const overGroupCap = groupCountToday >= GROUP_DAILY_CAP;
  const overGlobalEmailCap = emailedToday >= GLOBAL_EMAIL_DAILY_CAP;
  const shouldEmail = !overGroupCap && !overGlobalEmailCap;

  const insertResult = await env.DB
    .prepare(
      `INSERT INTO interest (group_slug, group_title, full_name, email, phone, travelers, room, beds, comments, ip_hash, user_agent, emailed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(group_slug, group_title, full_name, email, phone, travelers, room, beds, comments, ip_hash, user_agent)
    .run();

  if (shouldEmail && env.RESEND_API_KEY) {
    try {
      const sent = await sendInterestEmails(
        env,
        { full_name, email, phone, travelers, room, beds, comments, group_slug, group_title, group_dates, contact_phone },
        groupCountToday + 1,
        request
      );
      if (sent) {
        const rowId = insertResult && insertResult.meta && insertResult.meta.last_row_id;
        if (rowId) {
          await env.DB.prepare('UPDATE interest SET emailed = 1 WHERE id = ?').bind(rowId).run();
        }
      }
    } catch (err) {
      console.error('Resend send failed', err);
    }
  }

  return json({ ok: true }, 200);
}

async function handleInterestList(request, env) {
  if (!(await verifyAccessJwt(request, env))) {
    return new Response('Not found', { status: 404 });
  }
  const { results } = await env.DB
    .prepare(
      'SELECT group_slug, COUNT(*) AS count, MAX(created_at) AS latest FROM interest GROUP BY group_slug ORDER BY latest DESC'
    )
    .all();
  return json(results || [], 200, { 'X-Robots-Tag': 'noindex' });
}

async function handleInterestExport(request, env, url, slug, format) {
  if (!(await verifyAccessJwt(request, env))) {
    return new Response('Not found', { status: 404 });
  }

  const { results } = await env.DB
    .prepare(
      'SELECT created_at, full_name, email, phone, travelers, room, beds, comments FROM interest WHERE group_slug = ? ORDER BY created_at ASC'
    )
    .bind(slug)
    .all();
  const rows = results || [];

  if (format === 'json') {
    return json(rows, 200, { 'X-Robots-Tag': 'noindex' });
  }

  const cols = ['created_at', 'full_name', 'email', 'phone', 'travelers', 'room', 'beds', 'comments'];
  let csv = '﻿' + cols.join(',') + '\r\n';
  for (const row of rows) {
    csv += cols.map((c) => csvField(row[c])).join(',') + '\r\n';
  }
  const datestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="interest-${slug}-${datestamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

async function handleApi(request, env, url, ctx) {
  if (url.pathname === '/api/book') return handleBookPost(request, env, url, ctx);
  if (url.pathname === '/api/details') return handleDetails(request, env, url, ctx);
  if (url.pathname === '/api/stripe/webhook') return handleStripeWebhook(request, env, url, ctx);
  if (url.pathname === '/api/register' || url.pathname === '/api/interest') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
    return handleInterestPost(request, env, url);
  }
  if (url.pathname === '/api/interest/') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method not allowed' }, 405);
    return handleInterestList(request, env);
  }
  const m = /^\/api\/interest\/([A-Za-z0-9_-]+)\.(csv|json)$/.exec(url.pathname);
  if (m) {
    if (request.method !== 'GET') return json({ ok: false, error: 'method not allowed' }, 405);
    return handleInterestExport(request, env, url, m[1], m[2]);
  }
  return json({ ok: false, error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin')) {
      if (!(await verifyAccessJwt(request, env))) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
      return (await import('./admin.js')).handleAdmin(request, env, url, ctx);
    }
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url, ctx);
    }
    const pdfMatch = /^\/groups\/([A-Za-z0-9_-]+)\/trip-details\.pdf$/.exec(url.pathname);
    if (pdfMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleGroupPdfRoute(request, env, pdfMatch[1]);
    }
    if (url.hostname === 'ldorvadortravel.com' ||
        url.hostname === 'ldorvadortravel.org' ||
        url.hostname === 'www.ldorvadortravel.org') {
      url.hostname = 'www.ldorvadortravel.com';
      return Response.redirect(url.toString(), 301);
    }
    const asset = await env.ASSETS.fetch(request);
    if (url.hostname.endsWith('.workers.dev')) {
      const h = new Headers(asset.headers);
      h.set('X-Robots-Tag', 'noindex');
      return new Response(asset.body, { status: asset.status, headers: h });
    }
    const range = request.headers.get('Range');
    if (!asset.ok || !range) return asset;

    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) return asset;

    const buf = await asset.arrayBuffer();
    const size = buf.byteLength;
    let start, end;
    if (m[1] === '') {           // suffix form: bytes=-N (final N bytes)
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(buf.slice(start, end + 1), { status: 206, headers });
  },
};const PDF_RENDER_VERSION = 'r2'; // bump when render settings change (invalidates cached PDFs)


