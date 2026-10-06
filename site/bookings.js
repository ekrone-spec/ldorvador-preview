/* Bookings: deposits (Stripe Checkout), traveler details, balances (Stripe Payment Links).
 *
 * ===== Exported interface (admin.js is written against this) =====
 *
 * Route handlers (wired in worker.js):
 *   handleBookPost(request, env, url, ctx)        POST /api/book
 *   handleDetails(request, env, url, ctx)         GET|POST /api/details
 *   handleStripeWebhook(request, env, url, ctx)   POST /api/stripe/webhook
 *
 * Data helpers:
 *   getTrip(env, request, slug) -> trip | null
 *       Reads /groups/<slug>/trip.json from env.ASSETS. Normalised fields:
 *       {slug,title,dates,trip_ref,bookings_open:boolean,congregation,contact_email,contact_phone,
 *        arrival_date,departure_date (ISO 'YYYY-MM-DD' or ''),
 *        price_package_cents,price_single_supplement_cents,deposit_amount_cents,
 *        extension_price_per_night_cents (null if absent),
 *        optionals:[{name,price_cents,description}], raw:<original json>}
 *   getBooking(env, booking_ref) -> row | null
 *   listBookings(env, {slug?, trip_ref?, status?}) -> rows[]
 *   assignBookingRef(env, trip_ref) -> 'TRIPREF-0001' (atomic, D1 booking_seq upsert ... RETURNING)
 *   insertBooking(env, row) -> booking_ref   (row: column->value; assigns ref, retries once on UNIQUE conflict)
 *   updateBooking(env, booking_ref, fields) -> changes   (whitelisted columns only; sets updated_at)
 *   bookingToken(env, booking_ref) -> 32-char base64url HMAC (env.BOOKING_TOKEN_SECRET)
 *   detailsUrl(origin, booking, token) -> `${origin}/groups/<slug>/details/?ref=..&t=..&pax=n`
 *   bookingToExportRow(b) -> flat object {column: value} for CSV/JSON export (EXPORT_COLUMNS order)
 *   EXPORT_COLUMNS, ROOMING_COLUMNS  (arrays of header labels)
 *   roomingRow(b, trip) -> {booking reference, guest 1, guest 2, room number, room type, bed type,
 *                           arrival, departure, dietary requirements/special requests}
 *   formatUsd(cents) -> '$1,234.00'
 *
 * Balance:
 *   computeBalance(trip, booking) -> {total_cents, lines:[{label, cents}]}
 *       package x travelers + single supplement (single) + confirmed extension nights x
 *       extension_price_per_night x travelers (0 + 'to be confirmed' line if no price) +
 *       selected optionals x travelers - deposit paid.
 *   createBalancePaymentLink(env, trip, booking, amount_cents, lines, origin)
 *       -> {id, url}; creates Price + Payment Link, stores balance_amount_cents, balance_breakdown,
 *       stripe_payment_link_id/url on the booking. Throws on Stripe error.
 *   sendBalanceEmail(env, origin, trip, booking, lines, url, request?) -> true
 *       Branded email with breakdown + "Pay the balance"; sets status 'balance_sent', balance_sent_at.
 *   sendManualConfirmation(env, origin, trip, booking, request?) -> true
 *       Confirmation for a source='manual' booking (no Stripe deposit), incl. details link.
 *   sendDepositConfirmation(env, origin, trip, booking, request?)  (used by the webhook)
 *
 * All Stripe calls: REST, Bearer env.STRIPE_SECRET_KEY, 15s AbortSignal timeout.
 */
import {
  json, sha256Hex, truthy, clampStr, readFields, sameOrigin, verifyTurnstile, escapeHtml,
  sendResendEmail, emailShell, emailButton, emailAssetOrigin, EMAIL_COLORS, EMAIL_SANS,
  IP_SALT, DEFAULT_NOTIFY_TO,
} from './shared.js';

const BOOK_RATE_MAX = 5;
const DETAILS_RATE_MAX = 30;
const HOUR_MS = 60 * 60 * 1000;
const STRIPE_TIMEOUT_MS = 15000;
const WEBHOOK_TOLERANCE_S = 300;
const FROM = "L'Dor Vador Travel <connect@ldorvadortravel.com>";
const REPLY_TO = 'connect@ldorvadortravel.com';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const UPDATABLE = new Set([
  'status', 'travelers', 'first_name', 'last_name', 'email', 'phone', 'room', 'bed',
  'rm_first_name', 'rm_last_name', 'rm_email', 'rm_phone', 'pre_from', 'pre_to', 'post_from', 'post_to',
  'extensions_confirmed', 'pre_confirmed_from', 'pre_confirmed_to', 'post_confirmed_from', 'post_confirmed_to',
  'ec_name', 'ec_email', 'ec_phone', 'dietary', 'terms_version', 'terms_accepted_at',
  'g1_dob', 'g1_passport_number', 'g1_passport_country', 'g1_passport_expiry', 'g1_flight_arrival', 'g1_flight_departure',
  'g2_dob', 'g2_passport_number', 'g2_passport_country', 'g2_passport_expiry', 'g2_flight_arrival', 'g2_flight_departure',
  'details_submitted_at', 'optionals_selected', 'deposit_amount_cents', 'stripe_checkout_id', 'stripe_payment_intent',
  'deposit_paid_at', 'balance_amount_cents', 'balance_breakdown', 'stripe_payment_link_id', 'stripe_payment_link_url',
  'balance_sent_at', 'balance_paid_at', 'room_number', 'is_tour_leader', 'notes', 'trip_title',
]);

/* ---------------- small utils ---------------- */

export function formatUsd(cents) {
  const n = (Number(cents) || 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function nowIso() { return new Date().toISOString(); }

function validIso(s) {
  if (!ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function nightsBetween(from, to) {
  if (!validIso(from || '') || !validIso(to || '')) return 0;
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));
}

function appendNote(existing, note) {
  const line = `[${nowIso()}] ${note}`;
  return existing ? `${existing}\n${line}` : line;
}

function notifyList(env) {
  return (env.NOTIFY_TO || DEFAULT_NOTIFY_TO).split(',').map((s) => s.trim()).filter(Boolean);
}

function isLocalHost(url) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

async function ipHashOf(request) {
  return sha256Hex((request.headers.get('CF-Connecting-IP') || '') + IP_SALT);
}

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function constantTimeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

/* ---------------- trip + booking data ---------------- */

export async function getTrip(env, request, slug) {
  if (!/^[A-Za-z0-9_-]+$/.test(slug || '')) return null;
  let resp;
  try {
    resp = await env.ASSETS.fetch(new Request(new URL(`/groups/${slug}/trip.json`, request.url)));
  } catch (err) {
    console.error(`trip.json fetch failed for "${slug}"`, err);
    return null;
  }
  if (!resp.ok) {
    if (resp.body) resp.body.cancel().catch(() => {});
    return null;
  }
  let raw;
  try { raw = await resp.json(); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  return {
    slug: raw.slug || slug,
    title: String(raw.title || slug),
    dates: String(raw.dates || ''),
    trip_ref: String(raw.trip_ref || '').trim(),
    bookings_open: raw.bookings_open === true || truthy(raw.bookings_open),
    congregation: String(raw.congregation || ''),
    contact_email: String(raw.contact_email || ''),
    contact_phone: String(raw.contact_phone || ''),
    arrival_date: validIso(raw.arrival_date || '') ? raw.arrival_date : '',
    departure_date: validIso(raw.departure_date || '') ? raw.departure_date : '',
    price_package_cents: toCents(raw.price_package) || 0,
    price_single_supplement_cents: toCents(raw.price_single_supplement) || 0,
    deposit_amount_cents: toCents(raw.deposit_amount) || 0,
    extension_price_per_night_cents: toCents(raw.extension_price_per_night),
    optionals: (Array.isArray(raw.optionals) ? raw.optionals : [])
      .filter((o) => o && o.name)
      .map((o) => ({ name: String(o.name), price_cents: toCents(o.price) || 0, description: String(o.description || '') })),
    raw,
  };
}

export async function getBooking(env, booking_ref) {
  return env.DB.prepare('SELECT * FROM bookings WHERE booking_ref = ?').bind(booking_ref).first();
}

export async function listBookings(env, filter = {}) {
  const where = [];
  const binds = [];
  for (const k of ['slug', 'trip_ref', 'status']) {
    if (filter[k]) { where.push(`${k} = ?`); binds.push(filter[k]); }
  }
  const sql = `SELECT * FROM bookings${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at ASC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

export async function assignBookingRef(env, trip_ref) {
  const row = await env.DB.prepare(
    `INSERT INTO booking_seq (trip_ref, last) VALUES (?, 1)
     ON CONFLICT(trip_ref) DO UPDATE SET last = last + 1
     RETURNING last`
  ).bind(trip_ref).first();
  return `${trip_ref}-${String(row.last).padStart(4, '0')}`;
}

export async function insertBooking(env, row) {
  const cols = Object.keys(row).filter((k) => UPDATABLE.has(k) || ['trip_ref', 'slug', 'source', 'ip_hash'].includes(k));
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await assignBookingRef(env, row.trip_ref);
    try {
      await env.DB.prepare(
        `INSERT INTO bookings (booking_ref, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
      ).bind(ref, ...cols.map((c) => (row[c] === undefined ? null : row[c]))).run();
      return ref;
    } catch (err) {
      if (attempt === 0 && /UNIQUE/i.test(String(err && err.message))) {
        console.error(`booking_ref conflict on ${ref}, retrying`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('could not assign booking_ref');
}

export async function updateBooking(env, booking_ref, fields) {
  const cols = Object.keys(fields).filter((k) => UPDATABLE.has(k));
  if (!cols.length) return 0;
  const res = await env.DB.prepare(
    `UPDATE bookings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE booking_ref = ?`
  ).bind(...cols.map((c) => (fields[c] === undefined ? null : fields[c])), nowIso(), booking_ref).run();
  return (res && res.meta && res.meta.changes) || 0;
}

export async function bookingToken(env, booking_ref) {
  if (!env.BOOKING_TOKEN_SECRET) throw new Error('BOOKING_TOKEN_SECRET not set');
  return b64url(await hmacSha256(env.BOOKING_TOKEN_SECRET, booking_ref)).slice(0, 32);
}

export function detailsUrl(origin, booking, token) {
  return `${origin}/groups/${booking.slug}/details/?ref=${encodeURIComponent(booking.booking_ref)}&t=${encodeURIComponent(token)}&pax=${booking.travelers}`;
}

/* ---------------- exports / rooming ---------------- */

export const EXPORT_COLUMNS = [
  'booking_ref', 'status', 'source', 'trip_ref', 'slug', 'travelers', 'first_name', 'last_name', 'email', 'phone',
  'room', 'bed', 'rm_first_name', 'rm_last_name', 'rm_email', 'rm_phone',
  'pre_from', 'pre_to', 'post_from', 'post_to', 'extensions_confirmed',
  'pre_confirmed_from', 'pre_confirmed_to', 'post_confirmed_from', 'post_confirmed_to',
  'ec_name', 'ec_email', 'ec_phone', 'dietary',
  'g1_dob', 'g1_passport_number', 'g1_passport_country', 'g1_passport_expiry', 'g1_flight_arrival', 'g1_flight_departure',
  'g2_dob', 'g2_passport_number', 'g2_passport_country', 'g2_passport_expiry', 'g2_flight_arrival', 'g2_flight_departure',
  'optionals_selected', 'deposit_amount', 'deposit_paid_at', 'balance_amount', 'balance_sent_at', 'balance_paid_at',
  'stripe_payment_link_url', 'room_number', 'is_tour_leader', 'terms_version', 'terms_accepted_at',
  'details_submitted_at', 'notes', 'created_at', 'updated_at',
];

export function bookingToExportRow(b) {
  const out = {};
  for (const c of EXPORT_COLUMNS) {
    if (c === 'deposit_amount') out[c] = b.deposit_amount_cents != null ? (b.deposit_amount_cents / 100).toFixed(2) : '';
    else if (c === 'balance_amount') out[c] = b.balance_amount_cents != null ? (b.balance_amount_cents / 100).toFixed(2) : '';
    else if (c === 'optionals_selected') {
      let arr = [];
      try { arr = JSON.parse(b.optionals_selected || '[]'); } catch { /* ignore */ }
      out[c] = Array.isArray(arr) ? arr.join('; ') : '';
    } else out[c] = b[c] == null ? '' : b[c];
  }
  return out;
}

export const ROOMING_COLUMNS = [
  'booking reference', 'guest 1', 'guest 2', 'room number', 'room type', 'bed type',
  'arrival', 'departure', 'dietary requirements/special requests',
];

export function roomingRow(b, trip) {
  const ext = Number(b.extensions_confirmed) === 1;
  const arrival = (ext && b.pre_confirmed_from) || (trip && trip.arrival_date) || '';
  const departure = (ext && b.post_confirmed_to) || (trip && trip.departure_date) || '';
  const g2 = b.room === 'double' ? `${b.rm_first_name || ''} ${b.rm_last_name || ''}`.trim() : '';
  return {
    'booking reference': b.booking_ref,
    'guest 1': `${b.first_name || ''} ${b.last_name || ''}`.trim(),
    'guest 2': g2,
    'room number': b.room_number || '',
    'room type': b.room === 'double' ? 'Double' : 'Single',
    'bed type': b.room === 'double' ? (b.bed === 'queens' ? 'Two queens' : b.bed === 'king' ? 'King' : '') : 'King',
    arrival,
    departure,
    'dietary requirements/special requests': b.dietary || '',
  };
}

/* ---------------- balance ---------------- */

function parseOptionals(b) {
  try {
    const a = JSON.parse(b.optionals_selected || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

export function computeBalance(trip, booking) {
  const n = Number(booking.travelers) || 1;
  const lines = [];
  lines.push({ label: `Tour package × ${n}`, cents: trip.price_package_cents * n });
  if (booking.room === 'single' && trip.price_single_supplement_cents) {
    lines.push({ label: 'Single supplement', cents: trip.price_single_supplement_cents });
  }
  if (Number(booking.extensions_confirmed) === 1) {
    const nights = nightsBetween(booking.pre_confirmed_from, booking.pre_confirmed_to) +
      nightsBetween(booking.post_confirmed_from, booking.post_confirmed_to);
    if (nights > 0) {
      if (trip.extension_price_per_night_cents != null) {
        lines.push({ label: `Extra nights: ${nights} × ${n} traveler${n > 1 ? 's' : ''}`, cents: nights * n * trip.extension_price_per_night_cents });
      } else {
        lines.push({ label: 'Extra nights — to be confirmed', cents: 0 });
      }
    }
  }
  const byName = new Map(trip.optionals.map((o) => [o.name, o]));
  for (const name of parseOptionals(booking)) {
    const o = byName.get(name);
    if (o) lines.push({ label: `${o.name} × ${n}`, cents: o.price_cents * n });
  }
  if (booking.deposit_paid_at && booking.deposit_amount_cents) {
    lines.push({ label: 'Less deposit paid', cents: -booking.deposit_amount_cents });
  }
  const total_cents = lines.reduce((s, l) => s + l.cents, 0);
  return { total_cents, lines };
}

/* ---------------- Stripe ---------------- */

async function stripePost(env, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  const body = new URLSearchParams();
  for (const [k, v] of params) body.append(k, String(v));
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(`Stripe ${path} ${resp.status}: ${msg}`);
  }
  return data;
}

async function createDepositCheckout(env, origin, trip, booking) {
  const n = booking.travelers;
  const ref = booking.booking_ref;
  return stripePost(env, '/v1/checkout/sessions', [
    ['mode', 'payment'],
    ['currency', 'usd'],
    ['line_items[0][quantity]', 1],
    ['line_items[0][price_data][currency]', 'usd'],
    ['line_items[0][price_data][unit_amount]', booking.deposit_amount_cents],
    ['line_items[0][price_data][product_data][name]', `Deposit — ${trip.title} (${n} traveler${n > 1 ? 's' : ''})`],
    ['customer_email', booking.email],
    ['client_reference_id', ref],
    ['metadata[booking_ref]', ref],
    ['metadata[slug]', trip.slug],
    ['metadata[trip_ref]', trip.trip_ref],
    ['metadata[kind]', 'deposit'],
    ['payment_intent_data[description]', `${ref} deposit`],
    ['payment_intent_data[metadata][booking_ref]', ref],
    ['payment_intent_data[metadata][kind]', 'deposit'],
    ['payment_method_types[]', 'card'],
    ['payment_method_types[]', 'us_bank_account'],
    ['success_url', `${origin}/groups/${trip.slug}/reserved/?ref=${encodeURIComponent(ref)}`],
    ['cancel_url', `${origin}/groups/${trip.slug}/reserve/?cancelled=1`],
  ]);
}

export async function createBalancePaymentLink(env, trip, booking, amount_cents, lines, origin) {
  const ref = booking.booking_ref;
  const amount = Math.round(Number(amount_cents));
  if (!Number.isInteger(amount) || amount < 50) throw new Error('balance amount must be at least 50 cents');
  const price = await stripePost(env, '/v1/prices', [
    ['currency', 'usd'],
    ['unit_amount', amount],
    ['product_data[name]', `${trip.title} — balance for ${ref}`],
  ]);
  const link = await stripePost(env, '/v1/payment_links', [
    ['line_items[0][price]', price.id],
    ['line_items[0][quantity]', 1],
    ['metadata[booking_ref]', ref],
    ['metadata[slug]', trip.slug],
    ['metadata[trip_ref]', trip.trip_ref],
    ['metadata[kind]', 'balance'],
    ['payment_intent_data[metadata][booking_ref]', ref],
    ['payment_intent_data[metadata][kind]', 'balance'],
    ['payment_intent_data[description]', `${ref} balance`],
    ['payment_method_types[]', 'card'],
    ['payment_method_types[]', 'us_bank_account'],
    ['after_completion[type]', 'redirect'],
    ['after_completion[redirect][url]', `${origin}/groups/${trip.slug}/reserved/?ref=${encodeURIComponent(ref)}&balance=1`],
  ]);
  await updateBooking(env, ref, {
    balance_amount_cents: amount,
    balance_breakdown: JSON.stringify(lines || []),
    stripe_payment_link_id: link.id,
    stripe_payment_link_url: link.url,
  });
  return { id: link.id, url: link.url };
}

/* ---------------- emails ---------------- */

function row(label, value) {
  return `<tr>
    <td style="padding:8px 12px 8px 0;font-family:${EMAIL_SANS};font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${EMAIL_COLORS.inkSoft};white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;font-family:${EMAIL_SANS};font-size:16px;color:${EMAIL_COLORS.ink};border-bottom:1px solid ${EMAIL_COLORS.line};">${value || '&mdash;'}</td>
  </tr>`;
}
function table(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">${rowsHtml}</table>`;
}

function roomLabel(b) {
  if (b.room === 'double') return `Double room, ${b.bed === 'queens' ? 'two queen beds' : 'king bed'}`;
  return 'Single room';
}
function travelerNames(b) {
  const lead = `${b.first_name} ${b.last_name}`.trim();
  return b.travelers > 1 ? `${lead} &amp; ${escapeHtml(`${b.rm_first_name || ''} ${b.rm_last_name || ''}`.trim())}` : escapeHtml(lead);
}
function contactSentence(trip) {
  const phone = trip.contact_phone ? ` or call ${escapeHtml(trip.contact_phone)}` : '';
  return `Questions? Reply to this email${phone}.`;
}
const SIGNOFF = `<p style="margin:0;">Warmly,<br>Hannah Berkeley Cohen<br>L&rsquo;Dor Vador Travel</p>`;
const SIGNOFF_TEXT = `Warmly,\nHannah Berkeley Cohen\nL'Dor Vador Travel\n\nwww.ldorvadortravel.com`;

function bookingSummaryRows(trip, b) {
  return [
    row('Booking reference', `<strong>${escapeHtml(b.booking_ref)}</strong>`),
    row('Trip', escapeHtml(trip.title)),
    row('Dates', escapeHtml(trip.dates)),
    row('Travelers', travelerNames(b)),
    row('Room', escapeHtml(roomLabel(b))),
    ...(extraNightsLine(b) ? [row('Extra nights requested', escapeHtml(extraNightsLine(b).replace('Extra nights requested: ', '')))] : []),
  ].join('');
}

function internalSummaryText(trip, b) {
  const lines = [
    `Booking: ${b.booking_ref} (${b.status}, source ${b.source || 'web'})`,
    `Trip: ${trip.title} (${b.slug}, ${b.trip_ref})`,
    `Lead: ${b.first_name} ${b.last_name} <${b.email}> ${b.phone || ''}`,
    b.travelers > 1 ? `Roommate: ${b.rm_first_name || ''} ${b.rm_last_name || ''} <${b.rm_email || ''}> ${b.rm_phone || ''}` : 'Roommate: none',
    `Travelers: ${b.travelers}`,
    `Room: ${roomLabel(b)}`,
    `Pre-trip nights requested: ${b.pre_from || '-'} to ${b.pre_to || '-'}`,
    `Post-trip nights requested: ${b.post_from || '-'} to ${b.post_to || '-'}`,
    `Emergency contact: ${b.ec_name || '-'} ${b.ec_email || ''} ${b.ec_phone || ''}`,
    `Dietary/special requests: ${b.dietary || '-'}`,
    `Deposit: ${formatUsd(b.deposit_amount_cents)}${b.deposit_paid_at ? ` paid ${b.deposit_paid_at}` : ''}`,
    `Terms version: ${b.terms_version || '-'} accepted ${b.terms_accepted_at || '-'}`,
  ];
  return lines.join('\n');
}

function internalHtml(title, eyebrow, heading, text, origin) {
  const rowsHtml = text.split('\n').map((l) => {
    const i = l.indexOf(':');
    return row(escapeHtml(l.slice(0, i)), escapeHtml(l.slice(i + 1).trim()));
  }).join('');
  return emailShell({
    title: escapeHtml(title), preheader: escapeHtml(title), eyebrow, heading: escapeHtml(heading),
    bodyHtml: table(rowsHtml), footerNote: 'L&rsquo;Dor Vador Travel &mdash; internal notification', origin,
  });
}

async function sendInternal(env, subject, eyebrow, heading, text, request) {
  const origin = request ? emailAssetOrigin(request) : undefined;
  return sendResendEmail(env, {
    from: FROM, to: notifyList(env), reply_to: REPLY_TO, subject,
    html: internalHtml(subject, eyebrow, heading, text, origin), text,
  });
}

function guestRecipients(b) {
  const to = [b.email];
  if (b.travelers > 1 && b.rm_email && b.rm_email.toLowerCase() !== b.email.toLowerCase()) to.push(b.rm_email);
  return to;
}

async function sendGuestConfirmation(env, origin, trip, b, request, manual) {
  const token = await bookingToken(env, b.booking_ref);
  const link = detailsUrl(origin, b, token);
  const first = escapeHtml(b.first_name);
  const depositRow = manual ? '' : row('Deposit paid', escapeHtml(formatUsd(b.deposit_amount_cents)));
  const depositText = manual ? '' : `Deposit paid: ${formatUsd(b.deposit_amount_cents)}\n`;
  const html = emailShell({
    title: `Your booking is confirmed — ${escapeHtml(trip.title)}`,
    preheader: `Booking ${escapeHtml(b.booking_ref)} for ${escapeHtml(trip.title)} is confirmed.`,
    eyebrow: 'Booking confirmed',
    heading: escapeHtml(trip.title),
    bodyHtml: `
      <p style="margin:0 0 16px;">Hi ${first},</p>
      <p style="margin:0 0 16px;">${manual ? 'Your place is reserved' : 'Thank you &mdash; we have received your deposit and your place is reserved'} on <strong>${escapeHtml(trip.title)}</strong>.</p>
      ${table(bookingSummaryRows(trip, b) + depositRow)}
      <p style="margin:0 0 8px;"><strong>What happens next</strong></p>
      <p style="margin:0 0 16px;">Once the trip is confirmed, we will email you a secure link to pay the balance.${manual ? '' : ' If the minimum number of travelers is not reached, your deposit is fully refunded.'}</p>
      <p style="margin:0 0 22px;">Please take a moment to complete your traveler details (passport and flight information) so we can finalize your arrangements.</p>
      ${emailButton(link, 'Complete your traveler details')}
      <p style="margin:26px 0 16px;">${contactSentence(trip)}</p>
      ${SIGNOFF}`,
    footerNote: 'L&rsquo;Dor Vador Travel',
    origin: request ? emailAssetOrigin(request) : undefined,
  });
  const text =
    `Hi ${b.first_name},\n\n` +
    `${manual ? 'Your place is reserved' : 'Thank you - we have received your deposit and your place is reserved'} on ${trip.title}.\n\n` +
    `Booking reference: ${b.booking_ref}\nTrip: ${trip.title}\nDates: ${trip.dates}\nTravelers: ${b.travelers}\nRoom: ${roomLabel(b)}\n${depositText}\n` +
    `What happens next: once the trip is confirmed, we will email you a secure link to pay the balance.` +
    `${manual ? '' : ' If the minimum number of travelers is not reached, your deposit is fully refunded.'}\n\n` +
    `Complete your traveler details: ${link}\n\n` +
    `Questions? Reply to this email${trip.contact_phone ? ` or call ${trip.contact_phone}` : ''}.\n\n${SIGNOFF_TEXT}`;
  return sendResendEmail(env, {
    from: FROM, to: guestRecipients(b), reply_to: REPLY_TO,
    subject: `Booking confirmed — ${trip.title} (${b.booking_ref})`, html, text,
  });
}

export async function sendDepositConfirmation(env, origin, trip, booking, request) {
  const results = await Promise.allSettled([
    sendGuestConfirmation(env, origin, trip, booking, request, false),
    sendInternal(env, `Deposit paid: ${trip.title} — ${booking.booking_ref}`, 'Deposit received', trip.title,
      internalSummaryText(trip, booking), request),
  ]);
  for (const r of results) if (r.status === 'rejected') console.error(`Deposit email failed for ${booking.booking_ref}`, r.reason);
  return results[0].status === 'fulfilled';
}

export async function sendManualConfirmation(env, origin, trip, booking, request) {
  await sendGuestConfirmation(env, origin, trip, booking, request, true);
  return true;
}

export async function sendBalanceEmail(env, origin, trip, booking, lines, url, request) {
  const total = (lines || []).reduce((s, l) => s + (Number(l.cents) || 0), 0);
  const linesHtml = (lines || []).map((l) => row(escapeHtml(l.label), escapeHtml(formatUsd(l.cents)))).join('') +
    row('<strong>Balance due</strong>', `<strong>${escapeHtml(formatUsd(total))}</strong>`);
  const html = emailShell({
    title: `Your balance — ${escapeHtml(trip.title)}`,
    preheader: `The balance for booking ${escapeHtml(booking.booking_ref)} is ready to pay.`,
    eyebrow: 'Balance due',
    heading: escapeHtml(trip.title),
    bodyHtml: `
      <p style="margin:0 0 16px;">Hi ${escapeHtml(booking.first_name)},</p>
      <p style="margin:0 0 16px;">Good news &mdash; <strong>${escapeHtml(trip.title)}</strong> (${escapeHtml(trip.dates)}) is confirmed. Here is the balance for booking <strong>${escapeHtml(booking.booking_ref)}</strong>:</p>
      ${table(linesHtml)}
      ${emailButton(url, 'Pay the balance')}
      <p style="margin:26px 0 16px;">You can pay by card or directly from a US bank account. ${contactSentence(trip)}</p>
      ${SIGNOFF}`,
    footerNote: 'L&rsquo;Dor Vador Travel',
    origin: request ? emailAssetOrigin(request) : undefined,
  });
  const text =
    `Hi ${booking.first_name},\n\n${trip.title} (${trip.dates}) is confirmed. Balance for booking ${booking.booking_ref}:\n\n` +
    (lines || []).map((l) => `${l.label}: ${formatUsd(l.cents)}`).join('\n') +
    `\nBalance due: ${formatUsd(total)}\n\nPay the balance: ${url}\n\n` +
    `Questions? Reply to this email${trip.contact_phone ? ` or call ${trip.contact_phone}` : ''}.\n\n${SIGNOFF_TEXT}`;
  await sendResendEmail(env, {
    from: FROM, to: guestRecipients(booking), reply_to: REPLY_TO,
    subject: `Balance due — ${trip.title} (${booking.booking_ref})`, html, text,
  });
  await updateBooking(env, booking.booking_ref, { status: 'balance_sent', balance_sent_at: nowIso() });
  return true;
}

/* ---------------- POST /api/book ---------------- */

/* Phone -> E.164. country: 'US' | 'CA' | 'OTHER'. Returns null when invalid. */
export function normalizePhone(raw, country) {
  const v = String(raw || '').trim();
  const digits = v.replace(/\D/g, '');
  if (String(country || 'US').toUpperCase() === 'OTHER') {
    return v.startsWith('+') && digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

function addDaysIso(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function fmtMonDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

function fmtRange(from, to) {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${fmtMonDay(from)}\u2013${b.getUTCDate()}`;
  return `${fmtMonDay(from)}\u2013${fmtMonDay(to)}`;
}

export function extraNightsLine(b) {
  const parts = [];
  const pre = nightsBetween(b.pre_from, b.pre_to), post = nightsBetween(b.post_from, b.post_to);
  if (pre > 0) parts.push(`${pre} before (${fmtRange(b.pre_from, b.pre_to)})`);
  if (post > 0) parts.push(`${post} after (${fmtRange(b.post_from, b.post_to)})`);
  return parts.length ? `Extra nights requested: ${parts.join(', ')}` : '';
}

function parseNights(v, name, errors) {
  const s = clampStr(v, 3);
  if (s === '') return 0;
  if (!/^\d+$/.test(s) || Number(s) > 7) { errors.push(`${name} must be 0 to 7`); return 0; }
  return Number(s);
}

function validatePair(fields, a, b, errors) {
  const from = clampStr(fields[a], 10);
  const to = clampStr(fields[b], 10);
  if (!from && !to) return [null, null];
  if (!from || !to) { errors.push(`${a}/${b} incomplete`); return [null, null]; }
  if (!validIso(from) || !validIso(to)) { errors.push(`${a}/${b} invalid date`); return [null, null]; }
  if (from > to) { errors.push(`${a} after ${b}`); return [null, null]; }
  return [from, to];
}

export async function handleBookPost(request, env, url, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!sameOrigin(request, url)) return json({ ok: false, error: 'forbidden' }, 403);
  let f;
  try { f = await readFields(request); } catch { return json({ ok: false, error: 'invalid body' }, 400); }
  if (truthy(f.botcheck)) return json({ ok: true }, 200);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ip_hash = await ipHashOf(request);

  const skipCaptcha = env.TURNSTILE_SKIP === '1' && isLocalHost(url);
  if (!skipCaptcha) {
    const ts = await verifyTurnstile(clampStr(f['cf-turnstile-response'], 3000), ip, env);
    if (ts.unavailable) return json({ ok: false, error: 'captcha_unavailable' }, 503);
    if (!ts.ok) { console.log('book: captcha failed', slug, ts.codes || ''); return json({ ok: false, error: 'captcha' }, 400); }
  }

  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const rl = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE ip_hash = ? AND created_at >= ?')
    .bind(ip_hash, since).first();
  if (rl && rl.n >= BOOK_RATE_MAX) return json({ ok: false, error: 'rate limited' }, 429);

  const errors = [];
  const slug = clampStr(f.group, 200);
  const trip_ref_in = clampStr(f.trip_ref, 60);
  const first_name = clampStr(f.first_name, 120);
  const last_name = clampStr(f.last_name, 120);
  const email = clampStr(f.email, 200);
  let phone = clampStr(f.phone, 60);
  const room = clampStr(f.room, 10).toLowerCase();
  let bed = clampStr(f.bed, 10).toLowerCase() || null;
  if (!slug || !trip_ref_in || !first_name || !last_name || !email || !phone || !room) errors.push('missing required fields');
  if (email && !EMAIL_RE.test(email)) errors.push('invalid email');
  if (room && !['single', 'double'].includes(room)) errors.push('invalid room');
  const rm = { rm_first_name: null, rm_last_name: null, rm_email: null, rm_phone: null };
  if (room === 'double') {
    if (!['king', 'queens'].includes(bed || '')) errors.push('invalid bed');
    rm.rm_first_name = clampStr(f.rm_first_name, 120) || null;
    rm.rm_last_name = clampStr(f.rm_last_name, 120) || null;
    rm.rm_email = clampStr(f.rm_email, 200) || null;
    rm.rm_phone = clampStr(f.rm_phone, 60) || null;
    if (!rm.rm_first_name || !rm.rm_last_name) errors.push('roommate name required');
    if (rm.rm_email && !EMAIL_RE.test(rm.rm_email)) errors.push('invalid roommate email');
    if (rm.rm_first_name && rm.rm_last_name && first_name && last_name &&
        `${rm.rm_first_name} ${rm.rm_last_name}`.trim().toLowerCase() === `${first_name} ${last_name}`.trim().toLowerCase()) {
      errors.push('roommate must be a different person');
    }
  } else bed = null;
  const ec_email = clampStr(f.ec_email, 200) || null;
  if (ec_email && !EMAIL_RE.test(ec_email)) errors.push('invalid emergency contact email');
  if (ec_email && email && ec_email.toLowerCase() === email.toLowerCase()) errors.push("emergency contact email must be different from the traveler's");
  if (ec_email && rm.rm_email && ec_email.toLowerCase() === rm.rm_email.toLowerCase()) errors.push("emergency contact email must be different from the roommate's");
  // phones -> E.164
  const phoneErr = 'invalid phone number (10 digits for US/Canada)';
  const phoneN = phone ? normalizePhone(phone, f.phone_country) : null;
  if (phone && !phoneN) errors.push(phoneErr); else if (phoneN) phone = phoneN;
  let ec_phone = clampStr(f.ec_phone, 60) || null;
  if (ec_phone) {
    const n = normalizePhone(ec_phone, f.ec_phone_country);
    if (!n) errors.push(phoneErr); else ec_phone = n;
  }
  if (rm.rm_phone) {
    const n = normalizePhone(rm.rm_phone, f.phone_country);
    if (!n) errors.push(phoneErr); else rm.rm_phone = n;
  }
  if (ec_phone && phoneN && ec_phone === phoneN) errors.push("emergency contact phone must be different from the traveler's");
  if (!truthy(f.terms)) errors.push('terms must be accepted');
  const nightsMode = f.pre_nights !== undefined || f.post_nights !== undefined;
  let pre_from = null, pre_to = null, post_from = null, post_to = null;
  let preN = 0, postN = 0;
  if (nightsMode) {
    preN = parseNights(f.pre_nights, 'pre_nights', errors);
    postN = parseNights(f.post_nights, 'post_nights', errors);
  } else {
    [pre_from, pre_to] = validatePair(f, 'pre_from', 'pre_to', errors);
    [post_from, post_to] = validatePair(f, 'post_from', 'post_to', errors);
  }
  if (errors.length) { console.log('book: validation', slug, errors.join('; ')); return json({ ok: false, error: 'validation', errors }, 400); }

  const trip = await getTrip(env, request, slug);
  if (!trip) return json({ ok: false, error: 'unknown trip' }, 404);
  if (!trip.bookings_open || !trip.trip_ref) return json({ ok: false, error: 'bookings closed', message: 'Bookings for this trip are not open.' }, 409);
  if (trip_ref_in !== trip.trip_ref) return json({ ok: false, error: 'trip mismatch' }, 409);
  if (!trip.deposit_amount_cents) {
    console.error(`Trip ${slug} has no deposit_amount`);
    return json({ ok: false, error: 'bookings closed', message: 'Bookings for this trip are not open.' }, 409);
  }
  if (nightsMode && (preN > 0 || postN > 0)) {
    if (!trip.arrival_date || !trip.departure_date) {
      return json({ ok: false, error: 'validation', errors: ['extra nights not available for this trip'] }, 400);
    }
    if (preN > 0) { pre_from = addDaysIso(trip.arrival_date, -preN); pre_to = trip.arrival_date; }
    if (postN > 0) { post_from = trip.departure_date; post_to = addDaysIso(trip.departure_date, postN); }
  }

  const travelers = room === 'double' ? 2 : 1;
  const record = {
    trip_ref: trip.trip_ref, slug: trip.slug, trip_title: trip.title, status: 'pending', source: 'web', travelers,
    first_name, last_name, email, phone, room, bed, ...rm, pre_from, pre_to, post_from, post_to,
    ec_name: clampStr(f.ec_name, 200) || null, ec_email, ec_phone,
    dietary: clampStr(f.dietary, 2000) || null,
    terms_version: clampStr(f.terms_version, 60) || null, terms_accepted_at: nowIso(),
    deposit_amount_cents: trip.deposit_amount_cents * travelers, ip_hash,
  };

  let booking_ref;
  try {
    booking_ref = await insertBooking(env, record);
  } catch (err) {
    console.error(`Booking insert failed for trip ${trip.trip_ref}`, err);
    return json({ ok: false, error: 'server', message: 'We could not save your booking. Please try again.' }, 500);
  }

  try {
    const session = await createDepositCheckout(env, url.origin, trip, { ...record, booking_ref });
    await updateBooking(env, booking_ref, { stripe_checkout_id: session.id });
    return json({ ok: true, checkout_url: session.url, booking_ref }, 200);
  } catch (err) {
    console.error(`Stripe checkout failed for ${booking_ref}`, err);
    try {
      await updateBooking(env, booking_ref, { notes: appendNote(null, `Checkout creation failed: ${String(err && err.message).slice(0, 300)}`) });
    } catch (e2) { console.error(`Note update failed for ${booking_ref}`, e2); }
    return json({
      ok: false, error: 'payment_unavailable', booking_ref,
      message: 'Our payment page is temporarily unavailable. Your details are saved — please try again in a few minutes, or contact us and quote your booking reference.',
    }, 502);
  }
}

/* ---------------- Stripe webhook ---------------- */

async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => (s || '').trim());
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || !v1.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > WEBHOOK_TOLERANCE_S) return false;
  const sig = await hmacSha256(secret, `${t}.${rawBody}`);
  const expected = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  let ok = false;
  for (const s of v1) if (constantTimeEqual(s, expected)) ok = true;
  return ok;
}

async function markDepositPaid(env, ref, paymentIntent) {
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = 'deposit_paid', deposit_paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent), updated_at = ?
     WHERE booking_ref = ? AND status IN ('pending','deposit_failed')`
  ).bind(nowIso(), paymentIntent || null, nowIso(), ref).run();
  return ((res && res.meta && res.meta.changes) || 0) > 0;
}

async function markBalancePaid(env, ref) {
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = 'balance_paid', balance_paid_at = ?, updated_at = ?
     WHERE booking_ref = ? AND status <> 'balance_paid' AND status <> 'cancelled'`
  ).bind(nowIso(), nowIso(), ref).run();
  return ((res && res.meta && res.meta.changes) || 0) > 0;
}

async function addNote(env, ref, note) {
  const b = await getBooking(env, ref);
  if (b) await updateBooking(env, ref, { notes: appendNote(b.notes, note) });
}

async function afterDepositPaid(env, request, url, ref) {
  const b = await getBooking(env, ref);
  if (!b) return;
  const trip = (await getTrip(env, request, b.slug)) || {
    slug: b.slug, title: b.trip_title || b.slug, dates: '', trip_ref: b.trip_ref, contact_phone: '', optionals: [],
  };
  await sendDepositConfirmation(env, url.origin, trip, b, request);
}

async function processEvent(env, request, url, ctx, event) {
  const obj = (event.data && event.data.object) || {};
  const md = obj.metadata || {};
  const ref = md.booking_ref || obj.client_reference_id;
  const kind = md.kind || 'deposit';
  const later = (p, label) => ctx.waitUntil(p.catch((err) => console.error(`${label} failed for ${ref}`, err)));
  if (!ref) return 'no booking_ref';

  switch (event.type) {
    case 'checkout.session.completed':
      if (kind === 'balance') {
        if (obj.payment_status === 'paid') { await markBalancePaid(env, ref); return 'balance_paid'; }
        await addNote(env, ref, 'Balance checkout completed — awaiting bank debit');
        return 'balance awaiting';
      }
      if (obj.payment_status === 'paid') {
        if (await markDepositPaid(env, ref, obj.payment_intent)) later(afterDepositPaid(env, request, url, ref), 'Deposit emails');
        return 'deposit_paid';
      }
      await updateBooking(env, ref, { stripe_payment_intent: obj.payment_intent || null });
      await addNote(env, ref, 'Deposit checkout completed — awaiting bank debit');
      return 'awaiting bank debit';
    case 'checkout.session.async_payment_succeeded':
      if (kind === 'balance') { await markBalancePaid(env, ref); return 'balance_paid'; }
      if (await markDepositPaid(env, ref, obj.payment_intent)) later(afterDepositPaid(env, request, url, ref), 'Deposit emails');
      return 'deposit_paid';
    case 'checkout.session.async_payment_failed': {
      if (kind === 'balance') await addNote(env, ref, 'Balance bank debit failed');
      else {
        await env.DB.prepare(`UPDATE bookings SET status = 'deposit_failed', updated_at = ? WHERE booking_ref = ? AND status = 'pending'`)
          .bind(nowIso(), ref).run();
        await addNote(env, ref, 'Deposit bank debit failed');
      }
      const b = await getBooking(env, ref);
      if (b) {
        later(sendInternal(env, `${kind === 'balance' ? 'Balance' : 'Deposit'} payment FAILED — ${ref}`, 'Payment failed',
          b.trip_title || b.slug, internalSummaryText({ title: b.trip_title || b.slug }, b), request), 'Failure notification');
      }
      return 'failed';
    }
    case 'payment_intent.succeeded':
      if (kind === 'balance') { await markBalancePaid(env, ref); return 'balance_paid'; }
      return 'ignored (deposit PI)';
    default:
      return 'ignored type';
  }
}

export async function handleStripeWebhook(request, env, url, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ ok: false, error: 'bad signature' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  if (!event || !event.id || !event.type) return json({ ok: false, error: 'bad event' }, 400);

  const ins = await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)').bind(event.id, event.type).run();
  if (!((ins && ins.meta && ins.meta.changes) || 0)) return json({ ok: true, duplicate: true }, 200);

  try {
    const result = await processEvent(env, request, url, ctx, event);
    return json({ ok: true, result }, 200);
  } catch (err) {
    const ref = event.data && event.data.object && ((event.data.object.metadata || {}).booking_ref || event.data.object.client_reference_id);
    console.error(`Webhook ${event.type} ${event.id} failed for ${ref}`, err);
    // Un-record so Stripe's retry is processed.
    await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(event.id).run().catch(() => {});
    return json({ ok: false, error: 'processing failed' }, 500);
  }
}

/* ---------------- /api/details ---------------- */

async function readFieldsMulti(request) {
  // readFields() keeps only the last value per key; optional[] needs all of them.
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const f = await readFields(request);
    const opt = f['optional[]'] ?? f.optional ?? [];
    return { f, optionals: (Array.isArray(opt) ? opt : [opt]).map(String) };
  }
  const form = await request.formData();
  const f = {};
  for (const [k, v] of form.entries()) f[k] = typeof v === 'string' ? v : '';
  const optionals = [...form.getAll('optional[]'), ...form.getAll('optional')].filter((v) => typeof v === 'string');
  return { f, optionals };
}

async function checkToken(env, ref, t) {
  if (!ref || !t) return false;
  try { return constantTimeEqual(await bookingToken(env, ref), t); } catch (err) {
    console.error('bookingToken failed', err);
    return false;
  }
}

export async function handleDetails(request, env, url, ctx) {
  if (request.method === 'GET') {
    const ref = clampStr(url.searchParams.get('ref'), 80);
    const t = clampStr(url.searchParams.get('t'), 80);
    if (!(await checkToken(env, ref, t))) return json({ ok: false, error: 'forbidden' }, 403);
    const b = await getBooking(env, ref);
    if (!b) return json({ ok: false, error: 'not found' }, 404);
    return json({ ok: true, travelers: b.travelers, has_details: !!b.details_submitted_at }, 200);
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!sameOrigin(request, url)) return json({ ok: false, error: 'forbidden' }, 403);

  const ip_hash = await ipHashOf(request);
  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const rl = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'details' AND ip_hash = ? AND created_at >= ?")
    .bind(ip_hash, since).first();
  if (rl && rl.n >= DETAILS_RATE_MAX) return json({ ok: false, error: 'rate limited' }, 429);
  await env.DB.prepare("INSERT INTO rate_events (kind, ip_hash) VALUES ('details', ?)").bind(ip_hash).run();

  let f, optionals;
  try { ({ f, optionals } = await readFieldsMulti(request)); } catch { return json({ ok: false, error: 'invalid body' }, 400); }
  const ref = clampStr(f.ref, 80);
  if (!(await checkToken(env, ref, clampStr(f.t, 80)))) return json({ ok: false, error: 'forbidden' }, 403);
  const b = await getBooking(env, ref);
  if (!b) return json({ ok: false, error: 'not found' }, 404);
  if (f.group && clampStr(f.group, 200) !== b.slug) return json({ ok: false, error: 'group mismatch' }, 400);

  const errors = [];
  const upd = {};
  const tripEarly = await getTrip(env, request, b.slug);
  const depIso = tripEarly && tripEarly.departure_date ? tripEarly.departure_date : '';
  const todayIso = nowIso().slice(0, 10);
  const guests = b.travelers > 1 ? ['g1', 'g2'] : ['g1'];
  for (const g of guests) {
    for (const k of ['dob', 'passport_expiry']) {
      const v = clampStr(f[`${g}_${k}`], 10);
      if (v && !validIso(v)) errors.push(`${g}_${k} invalid date`);
      else if (v && k === 'dob' && (v >= todayIso || v < '1900-01-01')) errors.push(`${g}_dob invalid date of birth`);
      else if (v && k === 'passport_expiry' && depIso && v <= depIso) errors.push('passport expires before the trip ends');
      upd[`${g}_${k}`] = v || null;
    }
    upd[`${g}_passport_number`] = clampStr(f[`${g}_passport_number`], 40) || null;
    upd[`${g}_passport_country`] = clampStr(f[`${g}_passport_country`], 80) || null;
    upd[`${g}_flight_arrival`] = clampStr(f[`${g}_flight_arrival`], 300) || null;
    upd[`${g}_flight_departure`] = clampStr(f[`${g}_flight_departure`], 300) || null;
  }
  if (errors.length) { console.log('book: validation', slug, errors.join('; ')); return json({ ok: false, error: 'validation', errors }, 400); }

  const trip = await getTrip(env, request, b.slug);
  const allowed = new Set(trip ? trip.optionals.map((o) => o.name) : []);
  upd.optionals_selected = JSON.stringify([...new Set(optionals.map((s) => s.trim()).filter((s) => allowed.has(s)))]);
  upd.details_submitted_at = nowIso();
  await updateBooking(env, ref, upd);

  const fresh = await getBooking(env, ref);
  const text = [
    `Booking: ${ref}`,
    `Trip: ${fresh.trip_title || fresh.slug}`,
    ...guests.flatMap((g) => [
      `${g.toUpperCase()} name: ${g === 'g1' ? `${fresh.first_name} ${fresh.last_name}` : `${fresh.rm_first_name || ''} ${fresh.rm_last_name || ''}`}`,
      `${g.toUpperCase()} DOB: ${fresh[`${g}_dob`] || '-'}`,
      `${g.toUpperCase()} passport: ${fresh[`${g}_passport_country`] || '-'} exp ${fresh[`${g}_passport_expiry`] || '-'}`,
      `${g.toUpperCase()} arrival flight: ${fresh[`${g}_flight_arrival`] || '-'}`,
      `${g.toUpperCase()} departure flight: ${fresh[`${g}_flight_departure`] || '-'}`,
    ]),
    `Optionals: ${JSON.parse(fresh.optionals_selected || '[]').join(', ') || 'none'}`,
  ].join('\n');
  ctx.waitUntil(sendInternal(env, `Traveler details received — ${ref}`, 'Traveler details', fresh.trip_title || fresh.slug, text, request)
    .catch((err) => console.error(`Details notification failed for ${ref}`, err)));
  return json({ ok: true }, 200);
}
