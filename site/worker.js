/* Range support for the hero videos.
 *
 * Workers static assets always answer 206-style Range requests with a 200 and
 * the whole file, which Safari refuses to treat as seekable media. This
 * worker runs first for /assets/vid/* only, fetches the asset, and slices the
 * requested byte range itself. Everything else is served as plain assets.
 */
const IP_SALT = 'ldv-interest-salt-9f3a1c';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function json(data, status, extraHeaders) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ip_hash = await sha256Hex(ip + IP_SALT);
  const user_agent = clampStr(request.headers.get('User-Agent') || '', 500);

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { results: countRows } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM interest WHERE ip_hash = ? AND created_at >= ?')
    .bind(ip_hash, windowStart)
    .all();
  const count = (countRows && countRows[0] && countRows[0].n) || 0;
  if (count >= RATE_LIMIT_MAX) {
    return json({ ok: false, error: 'rate limited' }, 429);
  }

  await env.DB
    .prepare(
      `INSERT INTO interest (group_slug, group_title, full_name, email, phone, travelers, room, comments, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(group_slug, group_title, full_name, email, phone, travelers, room, comments, ip_hash, user_agent)
    .run();

  if (env.WEB3FORMS_KEY) {
    try {
      await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: env.WEB3FORMS_KEY,
          subject: `Expression of interest: ${group_title || group_slug}`,
          from_name: "L'Dor Vador website",
          full_name,
          email,
          phone,
          travelers,
          room,
          comments,
          group: group_slug,
          group_title,
        }),
      });
    } catch (err) {
      console.error('Web3Forms forward failed', err);
    }
  }

  return json({ ok: true }, 200);
}

async function handleInterestExport(request, env, url, slug, format) {
  const key = url.searchParams.get('key') || '';
  const expected = env.INTEREST_EXPORT_KEY || '';
  if (!expected || !timingSafeEqual(key, expected)) {
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
};
