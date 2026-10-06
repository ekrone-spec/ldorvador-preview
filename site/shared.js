/* Helpers shared by worker.js and bookings.js (and admin.js). Moved out of worker.js because
 * the main module may only export handlers. */
export const IP_SALT = 'ldv-interest-salt-9f3a1c';
export const DEFAULT_NOTIFY_TO = 'connect@ldorvadortravel.com,erik@tcstudio.io';

export function json(data, status, extraHeaders) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function truthy(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

export function clampStr(v, maxLen) {
  return String(v == null ? '' : v).trim().slice(0, maxLen);
}

export function csvField(v) {
  let s = v == null ? '' : String(v);
  // Spreadsheet formula guard: a leading = + - @ would be evaluated by Excel.
  // Phone-like values (+1 614 ...) are left alone.
  if (/^[=+\-@]/.test(s) && !/^\+?[\d\s().-]+$/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function readFields(request) {
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

export function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

export function utcDayStartIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export async function verifyTurnstile(token, ip, env) {
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

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export async function sendResendEmail(env, payload) {
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


/* ---- Branded email shell (inline-styled, table-based; no external images) ---- */
/* Matches site/BRAND.md's "Email" application section and the mock in brand.html:
   light compact header (cream, ink lockup), cream/white body, dark footer band. */
export const EMAIL_COLORS = {
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
export const EMAIL_SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
export const EMAIL_SANS = "'Hanken Grotesk', -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const EMAIL_FONT_LINK = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Hanken+Grotesk:wght@400;700&display=swap";
export const PROD_ORIGIN = 'https://www.ldorvadortravel.com';

/* Real site wordmark, shot from the site's own .brand markup (see scratchpad/shoot_lockups.py). */
export function emailAssetOrigin(request) {
  try {
    const origin = new URL(request.url).origin;
    return /^https?:\/\/localhost(:\d+)?$/.test(origin) ? PROD_ORIGIN : origin;
  } catch {
    return PROD_ORIGIN;
  }
}

/* Compact lockup on a light ground (header): the site's real header-solid/logo-min lockup, as an image. */
export function emailHeaderLockup(origin) {
  return `<img src="${origin}/assets/img/email-lockup-compact.png" width="220" height="75" alt="L'Dor Vador — Heritage Travel" style="display:block;border:0;outline:none;width:220px;height:75px;">`;
}

/* Stacked lockup on the dark footer ground: the site's real stacked footer lockup, as an image. */
export function emailFooterLockup(origin) {
  return `<img src="${origin}/assets/img/email-lockup-stacked.png" width="140" height="122" alt="L'Dor Vador — Heritage Travel" style="display:block;border:0;outline:none;width:140px;height:122px;margin-left:auto;">`;
}

export function emailShell({ title, preheader, eyebrow, heading, bodyHtml, footerNote, origin }) {
  const assetOrigin = origin || PROD_ORIGIN;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
<link href="${EMAIL_FONT_LINK}" rel="stylesheet">
<style>
  @import url('${EMAIL_FONT_LINK}');
  body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
</style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.cream};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${EMAIL_COLORS.white};">
  <tr><td align="left" style="background:${EMAIL_COLORS.cream};padding:22px 32px;border-bottom:1px solid ${EMAIL_COLORS.line};">
    ${emailHeaderLockup(assetOrigin)}
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
        ${emailFooterLockup(assetOrigin)}
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

export function emailButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
  <tr><td style="background:${EMAIL_COLORS.blue};padding:0;border-radius:0;">
    <a href="${href}" style="display:inline-block;height:52px;line-height:52px;padding:0 32px;font-family:${EMAIL_SANS};font-size:13px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${EMAIL_COLORS.cream};text-decoration:none;">${label}</a>
  </td></tr>
</table>`;
}


export function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function base64UrlToJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

export async function fetchAccessJwks(env) {
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

export async function verifyAccessJwt(request, env) {
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

