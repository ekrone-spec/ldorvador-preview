/* Range support for the hero videos.
 *
 * Workers static assets always answer 206-style Range requests with a 200 and
 * the whole file, which Safari refuses to treat as seekable media. This
 * worker runs first for /assets/vid/* only, fetches the asset, and slices the
 * requested byte range itself. Everything else is served as plain assets.
 */
import puppeteer from '@cloudflare/puppeteer';

const IP_SALT = 'ldv-interest-salt-9f3a1c';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GROUP_DAILY_CAP = 200;
const GLOBAL_EMAIL_DAILY_CAP = 150;
const DEFAULT_NOTIFY_TO = 'connect@ldorvadortravel.com,erik@tcstudio.io';

function json(data, status, extraHeaders) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function truthy(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

function clampStr(v, maxLen) {
  return String(v == null ? '' : v).trim().slice(0, maxLen);
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function readFields(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    return body && typeof body === 'object' ? body : {};
  }
  const form = await request.formData();
  const out = {};
  for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : '';
  return out;
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

function utcDayStartIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function verifyTurnstile(token, ip, env) {
  if (!token) return { ok: false, unavailable: false };
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (!resp.ok) return { ok: false, unavailable: true };
    const data = await resp.json();
    return { ok: !!data.success, unavailable: false };
  } catch (err) {
    console.error('Turnstile verify failed', err);
    return { ok: false, unavailable: true };
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function sendResendEmail(env, payload) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${text}`);
  }
  return resp;
}

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
  const base = String(name || 'trip-details').trim().replace(/[^A-Za-z0-9 _.-]/g, '').trim() || 'trip-details';
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

/* ---- Branded email shell (inline-styled, table-based; no external images) ---- */
/* Matches site/BRAND.md's "Email" application section and the mock in brand.html:
   light compact header (cream, ink lockup), cream/white body, dark footer band. */
const EMAIL_COLORS = {
  cream: '#fff9f3',
  ink: '#282819',
  inkSoft: '#555a45',
  sage: '#7d9065',
  blue: '#282819',
  footer: '#282819',
  footerBody: '#c3c8b0',
  line: '#ebe1d1',
  white: '#fffdfa',
};
const EMAIL_SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const EMAIL_SANS = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif";

/* Compact lockup on a light ground (header): stacked "L'Dor / Vador" + hairline + tagline, in a row. */
function emailHeaderLockup() {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:${EMAIL_SERIF};font-weight:600;font-size:26px;line-height:.95;color:${EMAIL_COLORS.ink};" valign="middle">
      L&rsquo;Dor<br>Vador
    </td>
    <td style="padding-left:15px;border-left:1px solid ${EMAIL_COLORS.ink};" valign="middle">
      <span style="font-family:${EMAIL_SANS};font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:rgba(40,40,25,.85);">Heritage Travel</span>
    </td>
  </tr></table>`;
}

/* Stacked lockup on the dark footer ground: cream wordmark, right-aligned, tagline below. */
function emailFooterLockup() {
  return `<div style="font-family:${EMAIL_SERIF};font-weight:600;font-size:22px;line-height:.95;color:${EMAIL_COLORS.white};text-align:right;">
    L&rsquo;Dor<br>Vador
  </div>
  <div style="font-family:${EMAIL_SANS};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${EMAIL_COLORS.footerBody};margin-top:6px;text-align:right;">Heritage Travel</div>`;
}

function emailShell({ title, preheader, eyebrow, heading, bodyHtml, footerNote }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.cream};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${EMAIL_COLORS.white};">
  <tr><td align="left" style="background:${EMAIL_COLORS.cream};padding:22px 32px;border-bottom:1px solid ${EMAIL_COLORS.line};">
    ${emailHeaderLockup()}
  </td></tr>
  <tr><td style="padding:36px 32px 8px;">
    <p style="margin:0 0 10px;font-family:${EMAIL_SANS};font-size:12.5px;letter-spacing:.26em;text-transform:uppercase;color:${EMAIL_COLORS.sage};font-weight:700;">${eyebrow}</p>
    <h1 style="margin:0 0 18px;font-family:${EMAIL_SERIF};font-weight:600;font-size:30px;line-height:1.2;color:${EMAIL_COLORS.ink};">${heading}</h1>
    <hr style="border:none;border-top:1px solid ${EMAIL_COLORS.line};margin:0 0 22px;">
  </td></tr>
  <tr><td style="padding:0 32px 36px;font-family:${EMAIL_SANS};font-size:18px;line-height:1.6;color:${EMAIL_COLORS.inkSoft};">
    ${bodyHtml}
  </td></tr>
  <tr><td style="background:${EMAIL_COLORS.footer};padding:32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="bottom" align="left" style="width:40%;">
        ${emailFooterLockup()}
      </td>
      <td valign="bottom" align="right" style="width:60%;font-family:${EMAIL_SANS};font-size:13px;line-height:1.7;color:${EMAIL_COLORS.footerBody};">
        ${footerNote}<br>
        <a href="mailto:connect@ldorvadortravel.com" style="color:${EMAIL_COLORS.footerBody};">connect@ldorvadortravel.com</a><br>
        <a href="https://www.ldorvadortravel.com" style="color:${EMAIL_COLORS.footerBody};">www.ldorvadortravel.com</a>
      </td>
    </tr></table>
    <div style="border-top:1px solid rgba(255,253,250,.18);margin-top:22px;padding-top:14px;text-align:center;font-family:${EMAIL_SANS};font-size:12px;color:${EMAIL_COLORS.footerBody};">
      L&rsquo;Dor Vador Travel &middot; Willemstad, Cura&ccedil;ao &middot; www.ldorvadortravel.com
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function emailButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
  <tr><td style="background:${EMAIL_COLORS.blue};padding:0;border-radius:0;">
    <a href="${href}" style="display:inline-block;height:52px;line-height:52px;padding:0 32px;font-family:${EMAIL_SANS};font-size:13px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${EMAIL_COLORS.cream};text-decoration:none;">${label}</a>
  </td></tr>
</table>`;
}

async function sendInterestEmails(env, fields, groupCount, request) {
  const { full_name, email, phone, travelers, room, comments, group_slug, group_title, group_dates, contact_phone } = fields;
  const firstName = (full_name || '').trim().split(/\s+/)[0] || full_name;
  const titleForCopy = group_title || group_slug;
  const dateLine = group_dates ? `, ${escapeHtml(group_dates)}` : '';
  const dateLineText = group_dates ? `, ${group_dates}` : '';
  const groupUrl = `https://www.ldorvadortravel.com/groups/${group_slug}/`;
  const phoneSentence = contact_phone ? `Questions? Reply to this email or call ${contact_phone}.` : 'Questions? Reply to this email.';
  const phoneSentenceHtml = contact_phone
    ? `Questions? Reply to this email or call ${escapeHtml(contact_phone)}.`
    : 'Questions? Reply to this email.';

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
      <p style="margin:0;">Warmly,<br>Hannah &amp; Cornelis<br>L&rsquo;Dor Vador Travel</p>
    `,
    footerNote: 'L&rsquo;Dor Vador Travel',
  });
  const registrantText =
    `Hi ${firstName},\n\n` +
    `We've registered your interest in ${titleForCopy}${dateLineText}.\n\n` +
    `${pdfSentenceText}\n\n` +
    `This is not a booking. We will contact you once the program and booking details are finalized.\n\n` +
    `View the trip page: ${groupUrl}\n\n` +
    `${phoneSentence}\n\n` +
    `Warmly,\nHannah & Cornelis\nL'Dor Vador Travel\n\nwww.ldorvadortravel.com`;

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
    `Travelers: ${travelers}\nRoom: ${room || ''}\nComments: ${comments || ''}\n\n` +
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
        ${notifyRow('Room', escapeHtml(room || ''))}
        ${notifyRow('Comments', escapeHtml(comments || ''))}
      </table>
      <p style="margin:0 0 8px;">Registrations for this group so far: <strong>${groupCount}</strong></p>
      <p style="margin:0;">PDF attached to confirmation: <strong>${pdfBase64 ? 'yes' : 'no'}</strong></p>
    `,
    footerNote: 'L&rsquo;Dor Vador Travel &mdash; internal notification',
  });

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
  const room = roomRaw === 'single' || roomRaw === 'double' ? roomRaw : '';

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
      `INSERT INTO interest (group_slug, group_title, full_name, email, phone, travelers, room, comments, ip_hash, user_agent, emailed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(group_slug, group_title, full_name, email, phone, travelers, room, comments, ip_hash, user_agent)
    .run();

  if (shouldEmail && env.RESEND_API_KEY) {
    try {
      const sent = await sendInterestEmails(
        env,
        { full_name, email, phone, travelers, room, comments, group_slug, group_title, group_dates, contact_phone },
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

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

async function fetchAccessJwks(env) {
  const cache = caches.default;
  const jwksUrl = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const cacheKey = new Request(jwksUrl);
  let resp = await cache.match(cacheKey);
  if (resp) return resp.json();

  resp = await fetch(jwksUrl);
  if (!resp.ok) throw new Error('jwks fetch failed');
  const body = await resp.text();
  const cacheable = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
  });
  await cache.put(cacheKey, cacheable.clone());
  return JSON.parse(body);
}

async function verifyAccessJwt(request, env) {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return false;

  let token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!token) {
    const cookie = request.headers.get('Cookie') || '';
    const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlToJson(headerB64);
    payload = base64UrlToJson(payloadB64);
  } catch {
    return false;
  }
  if (header.alg !== 'RS256') return false;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return false;

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return false;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return false;

  let jwks;
  try {
    jwks = await fetchAccessJwks(env);
  } catch (err) {
    console.error('Access JWKS fetch failed', err);
    return false;
  }
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid) || (jwks.keys || [])[0];
  if (!jwk) return false;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (err) {
    console.error('Access key import failed', err);
    return false;
  }

  const signature = base64UrlToBytes(sigB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  } catch (err) {
    console.error('Access signature verify failed', err);
    return false;
  }
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
      'SELECT created_at, full_name, email, phone, travelers, room, comments FROM interest WHERE group_slug = ? ORDER BY created_at ASC'
    )
    .bind(slug)
    .all();
  const rows = results || [];

  if (format === 'json') {
    return json(rows, 200, { 'X-Robots-Tag': 'noindex' });
  }

  const cols = ['created_at', 'full_name', 'email', 'phone', 'travelers', 'room', 'comments'];
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

async function handleApi(request, env, url) {
  if (url.pathname === '/api/interest') {
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
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


