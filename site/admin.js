/* Admin console (Cloudflare Access protected; JWT already verified in worker.js).
 * handleAdmin(request, env, url, ctx) -> Response. Server-rendered HTML, site tokens only. */
import {
  json, csvField, escapeHtml, sameOrigin, clampStr, truthy, emailShell, emailButton, emailAssetOrigin, sendResendEmail,
} from './shared.js';
import {
  getTrip, getBooking, listBookings, insertBooking, updateBooking, bookingToken, detailsUrl,
  bookingToExportRow, EXPORT_COLUMNS, roomingRows, ROOMING_COLUMNS, resolvePartnerRef, linkPartner, computeBalance, createBalancePaymentLink,
  sendBalanceEmail, sendManualConfirmation, formatUsd,
} from './bookings.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEG_RE = /^[A-Za-z0-9_-]+$/;
const STATUSES = ['pending', 'deposit_paid', 'deposit_failed', 'balance_sent', 'balance_paid', 'cancelled'];
const STATUS_LABEL = {
  pending: 'Pending', deposit_paid: 'Deposit paid', deposit_failed: 'Deposit failed',
  balance_sent: 'Balance sent', balance_paid: 'Balance paid', cancelled: 'Cancelled',
};
const STATUS_COLOR = {
  pending: 'var(--ink-soft)', deposit_paid: 'var(--sage)', deposit_failed: '#9b3d2e',
  balance_sent: 'var(--brown)', balance_paid: '#4f6b38', cancelled: '#9b3d2e',
};
const FROM = "L'Dor Vador Travel <connect@ldorvadortravel.com>";
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline' 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'";

const esc = escapeHtml;
const nowIso = () => new Date().toISOString();
function validIso(s) {
  if (!ISO_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function moneyToCents(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const fmtDate = (s) => (s ? esc(String(s).slice(0, 10)) : '');

/* ---------------- responses ---------------- */

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP,
      'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    },
  });
}
function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
function csvResponse(name, columns, rows) {
  const lines = [columns.map(csvField).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvField(r[c])).join(','));
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    },
  });
}

/* ---------------- page chrome ---------------- */

const CSS = `
header.adm-head{position:static;opacity:1;animation:none;padding:14px 0;background:var(--paper);border-bottom:1px solid rgba(40,40,25,.12);transition:none}
header.adm-head::before{display:none}
.adm-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 clamp(20px,4vw,56px);flex-wrap:wrap}
.adm-bar .left{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.adm-bar .eyebrow{color:var(--ink-soft);font-size:11.5px}
.adm-user{font-size:13px;color:var(--ink-soft);letter-spacing:.02em}
.adm-main{max-width:1280px;margin:0 auto;padding:clamp(28px,4vw,56px) clamp(20px,4vw,56px) 96px;font-size:16px}
.adm-main h1{font-size:clamp(32px,4vw,48px);margin:10px 0 6px}
.adm-main h2{font-size:26px;margin:0 0 18px}
.adm-sub{color:var(--ink-soft);font-size:17px;margin:0 0 26px}
.adm-crumb{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--sage);text-decoration:none}
.adm-banner{padding:14px 18px;margin:0 0 26px;border:1px solid rgba(40,40,25,.12);border-left:3px solid var(--sage);background:#fff;font-size:15px}
.adm-banner.err{border-left-color:#9b3d2e}
.adm-card{background:var(--white);border:1px solid rgba(40,40,25,.12);padding:clamp(20px,3vw,36px);margin:0 0 28px}
.adm-actions{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 30px}
.adm .btn{width:auto;min-height:42px;padding:0 20px;font-size:11.5px;letter-spacing:.16em}
.adm .btn[disabled],.adm .btn.disabled{opacity:.35;pointer-events:none}
.adm .btn-line{color:var(--ink);border-color:var(--ink)}
.adm .btn-line:hover{background:var(--ink);color:#fff}
.adm .btn-danger{color:#9b3d2e;border-color:#9b3d2e;background:transparent}
.adm .btn-danger:hover{background:#9b3d2e;color:#fff}
.adm-stats{display:flex;gap:clamp(24px,5vw,64px);flex-wrap:wrap;margin:0 0 30px}
.adm-stats div b{display:block;font-family:var(--display);font-size:38px;font-weight:600;line-height:1}
.adm-stats div span{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--ink-soft)}
.adm-filter{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700}
.adm-filter a{color:var(--ink-soft);text-decoration:none;padding-bottom:3px;border-bottom:1.5px solid transparent}
.adm-filter a.on{color:var(--ink);border-bottom-color:var(--sage)}
.adm-scroll{overflow-x:auto}
table.adm-t{width:100%;border-collapse:collapse;font-family:var(--body);font-size:14px}
table.adm-t th{text-align:left;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--ink-soft);padding:10px 12px 10px 0;border-bottom:1px solid rgba(40,40,25,.12);white-space:nowrap}
table.adm-t td{padding:12px 12px 12px 0;border-bottom:1px solid rgba(40,40,25,.12);vertical-align:top}
table.adm-t td.num,table.adm-t th.num{text-align:right}
table.adm-t a{color:var(--ink)}
.adm-st{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;white-space:nowrap}
.adm-lead{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--camel);display:block;margin-top:3px}
.adm-rowact{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
.adm-rowact a,.adm-rowact button{color:var(--sage);text-decoration:none;background:none;border:0;border-bottom:1.5px solid var(--sage);padding:0 0 3px;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}
.adm-rowact .off{color:var(--ink-soft);opacity:.4;border-bottom-color:transparent;cursor:default}
.adm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px 20px}
.adm-grid .wide{grid-column:1/-1}
.adm label,.adm .lab{display:block;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--sage);margin:0 0 6px}
.adm input[type=text],.adm input[type=email],.adm input[type=tel],.adm input[type=date],.adm input[type=number],.adm select,.adm textarea{width:100%;background:#fff;border:1.5px solid var(--line);padding:10px 12px;font-size:16px;font-family:var(--body);color:var(--ink);min-height:44px;border-radius:0;box-sizing:border-box}
.adm textarea{min-height:90px;resize:vertical}
.adm input:focus,.adm select:focus,.adm textarea:focus{outline:none;border-color:var(--sage)}
.adm .chk{display:flex;gap:10px;align-items:center;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;color:var(--ink);margin:0}
.adm .chk input{width:auto;min-height:0;accent-color:var(--sage)}
.adm .hint{font-size:13.5px;color:var(--ink-soft);margin-top:6px;text-transform:none;letter-spacing:0;font-weight:400}
.adm-sec{font-size:12.5px;letter-spacing:.26em;text-transform:uppercase;font-weight:700;color:var(--sage);margin:30px 0 14px;padding-top:22px;border-top:1px solid rgba(40,40,25,.12)}
.adm-sec:first-child{margin-top:0;padding-top:0;border-top:0}
ul.adm-facts{list-style:none;padding:0;margin:0}
ul.adm-facts li{display:flex;flex-direction:column;gap:3px;padding:11px 0;border-bottom:1px solid rgba(40,40,25,.12);font-size:15px;word-break:break-all}
ul.adm-facts li:last-child{border-bottom:0}
ul.adm-facts li span{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--sage)}
.adm-linkbox{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#fff;border:1px solid rgba(40,40,25,.12);padding:12px;word-break:break-all;margin:10px 0 18px}
.adm-total{font-family:var(--display);font-size:30px;font-weight:600}
form:not(.adm-card){background:none;border:0;padding:0;margin:0;box-shadow:none;max-width:none;display:inline-block}
@media(max-width:700px){.adm-main{font-size:15px}}
`;

function layout({ title, email, body, banner }) {
  const b = banner
    ? `<div class="adm-banner${banner.err ? ' err' : ''}" role="${banner.err ? 'alert' : 'status'}">${esc(banner.text)}</div>` : '';
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Administration · L'Dor Vador</title>
<link rel="stylesheet" href="/assets/app.css"><style>${CSS}</style></head>
<body class="adm"><header class="logo-min header-solid adm-head"><div class="adm-bar"><div class="left">
<a class="brand" href="/admin/" aria-label="L'Dor Vador, Heritage Travel, administration home"><span class="brand-stack"><span class="brand-word">L'Dor</span><span class="brand-word">Vador</span></span><span class="brand-tx">Heritage Travel</span></a>
<span class="eyebrow">Administration</span></div><div class="adm-user">${esc(email || '')}</div></div></header>
<main class="adm-main">${b}${body}</main></body></html>`);
}

/* ---------------- form helpers ---------------- */

async function readForm(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    let o = {};
    try { o = await request.json(); } catch { /* empty */ }
    return { get: (k) => (o && o[k] != null ? String(o[k]) : ''), all: (k) => [].concat(o && o[k] != null ? o[k] : []).map(String) };
  }
  const fd = await request.formData();
  return {
    get: (k) => { const v = fd.get(k); return typeof v === 'string' ? v : ''; },
    all: (k) => fd.getAll(k).filter((v) => typeof v === 'string'),
  };
}

function validatePair(F, a, b, errors) {
  const from = clampStr(F.get(a), 10);
  const to = clampStr(F.get(b), 10);
  if (!from && !to) return [null, null];
  if (!from || !to) { errors.push(`${a}/${b} incomplete`); return [null, null]; }
  if (!validIso(from) || !validIso(to)) { errors.push(`${a}/${b} invalid date`); return [null, null]; }
  if (from > to) { errors.push(`${a} is after ${b}`); return [null, null]; }
  return [from, to];
}

/* Shared validation for create + edit. Returns {errors, fields}. */
function parseBookingForm(F, trip, { edit }) {
  const errors = [];
  const first_name = clampStr(F.get('first_name'), 120);
  const last_name = clampStr(F.get('last_name'), 120);
  const email = clampStr(F.get('email'), 200);
  const room = clampStr(F.get('room'), 10).toLowerCase();
  let bed = clampStr(F.get('bed'), 10).toLowerCase() || null;
  if (!first_name || !last_name || !email) errors.push('First name, last name and email are required');
  if (email && !EMAIL_RE.test(email)) errors.push('Invalid email');
  if (!['single', 'double'].includes(room)) errors.push('Room must be single or double');
  const rm = { rm_first_name: null, rm_last_name: null, rm_email: null, rm_phone: null };
  const separate = room === 'double' && F.get('roommate_separate') === '1';
  let partner_booking_ref = null;
  if (separate) {
    const ref = clampStr(F.get('partner_booking_ref'), 40).toUpperCase();
    if (ref) {
      if (!/^[0-9]{8}[A-Z]{3}[0-9]{2}-[0-9]{4}$/.test(ref)) errors.push('Roommate booking reference not found');
      else partner_booking_ref = ref;
    }
  }
  if (room === 'double') {
    if (!['king', 'queens'].includes(bed || '')) errors.push('Bed must be king or queens for a double room');
    rm.rm_first_name = clampStr(F.get('rm_first_name'), 120) || null;
    rm.rm_last_name = clampStr(F.get('rm_last_name'), 120) || null;
    rm.rm_email = clampStr(F.get('rm_email'), 200) || null;
    rm.rm_phone = clampStr(F.get('rm_phone'), 60) || null;
    if (!rm.rm_first_name || !rm.rm_last_name) errors.push('Roommate name is required for a double room');
    if (rm.rm_email && !EMAIL_RE.test(rm.rm_email)) errors.push('Invalid roommate email');
  } else bed = null;
  const ec_email = clampStr(F.get('ec_email'), 200) || null;
  if (ec_email && !EMAIL_RE.test(ec_email)) errors.push('Invalid emergency contact email');
  const [pre_from, pre_to] = validatePair(F, 'pre_from', 'pre_to', errors);
  const [post_from, post_to] = validatePair(F, 'post_from', 'post_to', errors);
  const status = clampStr(F.get('status'), 20);
  if (!STATUSES.includes(status)) errors.push('Invalid status');
  const fields = {
    first_name, last_name, email, phone: clampStr(F.get('phone'), 60) || null, room, bed, ...rm,
    travelers: room === 'double' && !separate ? 2 : 1,
    roommate_separate: separate ? 1 : 0, partner_booking_ref,
    pre_from, pre_to, post_from, post_to,
    ec_name: clampStr(F.get('ec_name'), 200) || null, ec_email, ec_phone: clampStr(F.get('ec_phone'), 60) || null,
    dietary: clampStr(F.get('dietary'), 2000) || null,
    is_tour_leader: truthy(F.get('is_tour_leader')) ? 1 : 0,
    notes: clampStr(F.get('notes'), 4000) || null,
    room_number: clampStr(F.get('room_number'), 40) || null,
    status,
  };
  if (edit) {
    const ext = truthy(F.get('extensions_confirmed')) ? 1 : 0;
    fields.extensions_confirmed = ext;
    const [pcf, pct] = validatePair(F, 'pre_confirmed_from', 'pre_confirmed_to', errors);
    const [qcf, qct] = validatePair(F, 'post_confirmed_from', 'post_confirmed_to', errors);
    fields.pre_confirmed_from = pcf; fields.pre_confirmed_to = pct;
    fields.post_confirmed_from = qcf; fields.post_confirmed_to = qct;
    const known = new Set((trip.optionals || []).map((o) => o.name));
    fields.optionals_selected = JSON.stringify(F.all('optional').filter((n) => known.has(n)));
  }
  return { errors, fields };
}

/* ---------------- form HTML ---------------- */

function field(name, label, value, { type = 'text', wide = false, hint = '', attrs = '' } = {}) {
  return `<div${wide ? ' class="wide"' : ''}><label for="f_${name}">${esc(label)}</label><input id="f_${name}" type="${type}" name="${name}" value="${esc(value == null ? '' : value)}" ${attrs}>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}
function select(name, label, options, value, attrs = '') {
  return `<div><label for="f_${name}">${esc(label)}</label><select id="f_${name}" name="${name}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value == null ? '' : value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}

function bookingFormFields(b, trip, { edit }) {
  b = b || {};
  const roomOpts = [['single', 'Single'], ['double', 'Double']];
  const bedOpts = [['', '(none)'], ['king', 'King'], ['queens', 'Two queens']];
  const statusOpts = STATUSES.map((s) => [s, STATUS_LABEL[s]]);
  let h = `<div class="adm-sec">Lead traveler</div><div class="adm-grid">
${field('first_name', 'First name', b.first_name, { attrs: 'required' })}${field('last_name', 'Last name', b.last_name, { attrs: 'required' })}
${field('email', 'Email', b.email, { type: 'email', attrs: 'required' })}${field('phone', 'Phone', b.phone, { type: 'tel' })}
${select('room', 'Room', roomOpts, b.room || 'double')}${select('bed', 'Bed (double rooms)', bedOpts, b.bed || '')}
<div class="wide"><label class="chk"><input type="checkbox" name="is_tour_leader" value="1"${Number(b.is_tour_leader) ? ' checked' : ''}> Tour leader (included in the rooming list, flagged in the table)</label></div></div>
<div class="adm-sec">Roommate (double rooms)</div><div class="adm-grid">
${field('rm_first_name', 'First name', b.rm_first_name)}${field('rm_last_name', 'Last name', b.rm_last_name)}
${field('rm_email', 'Email', b.rm_email, { type: 'email' })}${field('rm_phone', 'Phone', b.rm_phone, { type: 'tel' })}
${select('roommate_separate', 'Who pays for the roommate', [['0', 'Lead books and pays for both'], ['1', 'Roommate books and pays separately']], Number(b.roommate_separate) ? '1' : '0')}${field('partner_booking_ref', 'Roommate booking reference', b.partner_booking_ref, { hint: 'Only when the roommate books separately and has already booked.' })}</div>
<div class="adm-sec">Requested extensions</div><div class="adm-grid">
${field('pre_from', 'Pre-trip from', b.pre_from, { type: 'date' })}${field('pre_to', 'Pre-trip to', b.pre_to, { type: 'date' })}
${field('post_from', 'Post-trip from', b.post_from, { type: 'date' })}${field('post_to', 'Post-trip to', b.post_to, { type: 'date' })}</div>
<div class="adm-sec">Emergency contact and dietary</div><div class="adm-grid">
${field('ec_name', 'Name', b.ec_name)}${field('ec_email', 'Email', b.ec_email, { type: 'email' })}${field('ec_phone', 'Phone', b.ec_phone, { type: 'tel' })}
<div class="wide"><label for="f_dietary">Dietary requirements and special requests</label><textarea id="f_dietary" name="dietary">${esc(b.dietary || '')}</textarea></div></div>
<div class="adm-sec">Administration</div><div class="adm-grid">
${select('status', 'Status', statusOpts, b.status || 'deposit_paid')}${field('room_number', 'Room number', b.room_number)}`;
  if (!edit) {
    h += `<div class="wide"><div class="hint">Manual bookings default to Deposit paid. Choose this when the deposit was received outside Stripe (check, wire, cash); no payment is taken here. Choose Pending if nothing has been received yet.</div></div>`;
  }
  if (edit) {
    const chosen = (() => { try { return JSON.parse(b.optionals_selected || '[]'); } catch { return []; } })();
    h += `<div class="wide"><label class="chk"><input type="checkbox" name="extensions_confirmed" value="1"${Number(b.extensions_confirmed) ? ' checked' : ''}> Extensions confirmed (these dates are billed in the balance and used on the rooming list)</label></div>
${field('pre_confirmed_from', 'Confirmed pre-trip from', b.pre_confirmed_from, { type: 'date' })}${field('pre_confirmed_to', 'Confirmed pre-trip to', b.pre_confirmed_to, { type: 'date' })}
${field('post_confirmed_from', 'Confirmed post-trip from', b.post_confirmed_from, { type: 'date' })}${field('post_confirmed_to', 'Confirmed post-trip to', b.post_confirmed_to, { type: 'date' })}`;
    if ((trip.optionals || []).length) {
      h += `<div class="wide"><div class="lab">Optionals selected</div>${trip.optionals.map((o) => `<label class="chk" style="margin-bottom:6px"><input type="checkbox" name="optional" value="${esc(o.name)}"${chosen.includes(o.name) ? ' checked' : ''}> ${esc(o.name)} (${esc(formatUsd(o.price_cents))})</label>`).join('')}</div>`;
    }
  }
  h += `<div class="wide"><label for="f_notes">Internal notes</label><textarea id="f_notes" name="notes">${esc(b.notes || '')}</textarea></div></div>`;
  return h;
}

/* ---------------- pages ---------------- */

function statusCell(b) {
  return `<span class="adm-st" style="color:${STATUS_COLOR[b.status] || 'var(--ink)'}">${esc(STATUS_LABEL[b.status] || b.status)}</span>` +
    (Number(b.is_tour_leader) ? '<span class="adm-lead">Tour leader</span>' : '') +
    (b.source === 'manual' ? '<span class="adm-lead" style="color:var(--ink-soft)">Manual</span>' : '');
}
function canBalance(b) {
  return b.status !== 'cancelled' && (['deposit_paid', 'balance_sent'].includes(b.status) || b.source === 'manual');
}
function guestNames(b) {
  const lead = `${b.first_name || ''} ${b.last_name || ''}`.trim();
  const rm = b.room === 'double' ? `${b.rm_first_name || ''} ${b.rm_last_name || ''}`.trim() : '';
  return { lead, rm };
}
const bannerFrom = (url) => {
  if (url.searchParams.get('saved')) return { text: url.searchParams.get('msg') || 'Saved.' };
  if (url.searchParams.get('err')) return { text: url.searchParams.get('err'), err: true };
  return null;
};

async function pageTripList(env, url, email) {
  const slugQ = clampStr(url.searchParams.get('slug'), 200);
  if (slugQ && SEG_RE.test(slugQ)) return redirect(`/admin/${slugQ}`);
  const { results } = await env.DB.prepare(
    `SELECT slug, trip_ref, MAX(trip_title) AS trip_title, COUNT(*) AS n,
            SUM(CASE WHEN status != 'cancelled' THEN travelers ELSE 0 END) AS pax,
            SUM(CASE WHEN deposit_paid_at IS NOT NULL AND status != 'cancelled' THEN 1 ELSE 0 END) AS deposits
     FROM bookings GROUP BY slug, trip_ref ORDER BY MAX(created_at) DESC`).all();
  const rows = (results || []).map((r) => `<tr><td><a href="/admin/${esc(r.slug)}">${esc(r.trip_title || r.slug)}</a></td><td>${esc(r.trip_ref)}</td><td class="num">${r.n}</td><td class="num">${r.pax || 0}</td><td class="num">${r.deposits || 0}</td><td><div class="adm-rowact"><a href="/admin/${esc(r.slug)}">Open</a></div></td></tr>`).join('');
  const bad = slugQ && !SEG_RE.test(slugQ) ? { text: 'That is not a valid trip slug.', err: true } : bannerFrom(url);
  return layout({
    title: 'Trips', email, banner: bad,
    body: `<a class="eyebrow">Administration</a><h1>Group trips</h1><p class="adm-sub">Bookings by trip. A trip appears here once it has a booking.</p>
<div class="adm-card adm-scroll"><table class="adm-t"><thead><tr><th>Trip</th><th>Trip ref</th><th class="num">Bookings</th><th class="num">Travelers</th><th class="num">Deposits paid</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="color:var(--ink-soft)">No bookings yet.</td></tr>'}</tbody></table></div>
<div class="adm-card"><h2>Open a trip with no bookings yet</h2><form method="get" action="/admin/" class="adm-grid" style="align-items:end">
<div><label for="f_slug">Trip slug (the /groups/&lt;slug&gt;/ name)</label><input id="f_slug" type="text" name="slug" required pattern="[A-Za-z0-9_\\-]+"></div>
<div><button class="btn btn-solid" type="submit">Open trip</button></div></form></div>`,
  });
}

async function pageTrip(env, request, url, email, slug) {
  const trip = await getTrip(env, request, slug);
  if (!trip) return layout({ title: 'Trip not found', email, banner: { text: `No trip found for "${slug}".`, err: true }, body: '<p><a class="adm-crumb" href="/admin/">All trips</a></p>' });
  const all = await listBookings(env, { slug });
  const status = clampStr(url.searchParams.get('status'), 20);
  const rows = status && STATUSES.includes(status) ? all.filter((b) => b.status === status) : all;
  const live = all.filter((b) => b.status !== 'cancelled');
  const pax = live.reduce((s, b) => s + (Number(b.travelers) || 0), 0);
  const deposits = live.filter((b) => b.deposit_paid_at).length;
  const base = `/admin/${esc(slug)}`;
  const filters = [['', 'All']].concat(STATUSES.map((s) => [s, STATUS_LABEL[s]]))
    .map(([s, l]) => `<a href="${base}${s ? `?status=${s}` : ''}"${(status || '') === s ? ' class="on"' : ''}>${esc(l)}</a>`).join('');
  const trs = rows.map((b) => {
    const { lead, rm } = guestNames(b);
    const bal = canBalance(b) ? `<a href="${base}/${esc(b.booking_ref)}/balance">Balance</a>` : '<span class="off" title="Available once the deposit is paid, or for manual bookings">Balance</span>';
    return `<tr><td><a href="${base}/${esc(b.booking_ref)}"><b>${esc(b.booking_ref)}</b></a></td>
<td>${esc(lead)}${rm ? `<div style="color:var(--ink-soft)">${esc(rm)}</div>` : ''}</td><td class="num">${b.travelers}</td>
<td>${esc(b.room)}${b.bed ? ` / ${esc(b.bed)}` : ''}</td><td>${statusCell(b)}</td><td>${fmtDate(b.deposit_paid_at)}</td>
<td class="num">${b.balance_amount_cents != null ? esc(formatUsd(b.balance_amount_cents)) : ''}</td>
<td>${b.details_submitted_at ? 'Yes' : 'No'}</td><td>${esc(b.room_number || '')}</td><td>${fmtDate(b.created_at)}</td>
<td><div class="adm-rowact"><a href="${base}/${esc(b.booking_ref)}">Edit</a>${bal}
<form method="post" action="/api/admin/${esc(slug)}/${esc(b.booking_ref)}/details-link" style="display:inline"><button type="submit">Resend details link</button></form></div></td></tr>`;
  }).join('');
  return layout({
    title: trip.title, email, banner: bannerFrom(url),
    body: `<a class="adm-crumb" href="/admin/">All trips</a><h1>${esc(trip.title)}</h1>
<p class="adm-sub">${esc(trip.dates)}${trip.dates ? ' &middot; ' : ''}Trip ref ${esc(trip.trip_ref || '(none)')}${trip.bookings_open ? '' : ' &middot; web bookings closed'}</p>
<div class="adm-stats"><div><b>${live.length}</b><span>Bookings</span></div><div><b>${pax}</b><span>Travelers</span></div><div><b>${deposits}</b><span>Deposits paid</span></div></div>
<div class="adm-actions"><a class="btn btn-solid" href="${base}/new">Add booking</a>
<a class="btn btn-line" href="/api/admin/${esc(slug)}/export.csv">Export travelers (CSV)</a>
<a class="btn btn-line" href="/api/admin/${esc(slug)}/rooming.csv">Export rooming list (CSV)</a></div>
<div class="adm-filter">${filters}</div>
<div class="adm-card adm-scroll"><table class="adm-t"><thead><tr><th>Booking</th><th>Lead / roommate</th><th class="num">Trav.</th><th>Room / bed</th><th>Status</th><th>Deposit paid</th><th class="num">Balance</th><th>Details</th><th>Room no.</th><th>Created</th><th></th></tr></thead>
<tbody>${trs || '<tr><td colspan="11" style="color:var(--ink-soft)">No bookings.</td></tr>'}</tbody></table></div>`,
  });
}

async function pageNew(env, request, url, email, slug) {
  const trip = await getTrip(env, request, slug);
  if (!trip) return layout({ title: 'Trip not found', email, banner: { text: `No trip found for "${slug}".`, err: true }, body: '' });
  return layout({
    title: 'Add booking', email, banner: bannerFrom(url),
    body: `<a class="adm-crumb" href="/admin/${esc(slug)}">${esc(trip.title)}</a><h1>Add booking</h1>
<p class="adm-sub">A manual booking for ${esc(trip.title)}, including tour leaders. The booking reference is assigned on save.</p>
<form class="adm-card" method="post" action="/api/admin/${esc(slug)}/bookings">${bookingFormFields({}, trip, { edit: false })}
<div class="adm-sec">Confirmation</div><label class="chk"><input type="checkbox" name="send_confirmation" value="1"> Send the confirmation email (with the traveler-details link) to the guest</label>
<div class="adm-actions" style="margin:28px 0 0"><button class="btn btn-solid" type="submit">Save booking</button><a class="btn btn-line" href="/admin/${esc(slug)}">Cancel</a></div></form>`,
  });
}

async function pageEdit(env, request, url, email, slug, ref) {
  const trip = await getTrip(env, request, slug);
  const b = await getBooking(env, ref);
  if (!trip || !b || b.slug !== slug) return layout({ title: 'Not found', email, banner: { text: 'Booking not found.', err: true }, body: `<a class="adm-crumb" href="/admin/${esc(slug)}">Back</a>` });
  const fact = (k, v) => `<li><span>${esc(k)}</span>${v ? esc(v) : '<i style="color:var(--ink-soft)">none</i>'}</li>`;
  const link = b.stripe_payment_link_url ? `<a href="${esc(b.stripe_payment_link_url)}" rel="noopener" style="word-break:break-all">${esc(b.stripe_payment_link_url)}</a>` : '';
  return layout({
    title: ref, email, banner: bannerFrom(url),
    body: `<a class="adm-crumb" href="/admin/${esc(slug)}">${esc(trip.title)}</a><h1>${esc(ref)}</h1>
<p class="adm-sub">${esc(guestNames(b).lead)} &middot; ${statusCell(b).replace(/<span class="adm-lead[^>]*>[^<]*<\/span>/g, '')} &middot; created ${fmtDate(b.created_at)}</p>
<div class="adm-actions">${canBalance(b) ? `<a class="btn btn-solid" href="/admin/${esc(slug)}/${esc(ref)}/balance">Balance</a>` : ''}
<form method="post" action="/api/admin/${esc(slug)}/${esc(ref)}/details-link"><button class="btn btn-line" type="submit">Resend details link</button></form>
<form method="post" action="/api/admin/${esc(slug)}/${esc(ref)}" data-confirm="Cancel booking ${esc(ref)}? The guest is not notified and no refund is issued.">
<input type="hidden" name="action" value="cancel"><button class="btn btn-danger" type="submit"${b.status === 'cancelled' ? ' disabled' : ''}>Cancel booking</button></form></div>
<form class="adm-card" method="post" action="/api/admin/${esc(slug)}/${esc(ref)}">${bookingFormFields(b, trip, { edit: true })}
<div class="adm-actions" style="margin:28px 0 0"><button class="btn btn-solid" type="submit">Save changes</button><a class="btn btn-line" href="/admin/${esc(slug)}">Back to bookings</a></div></form>
<div class="adm-card"><div class="adm-sec">Stripe and payment (read-only)</div><ul class="adm-facts">
${fact('Deposit amount', formatUsd(b.deposit_amount_cents))}${fact('Deposit paid at', b.deposit_paid_at)}${fact('Stripe checkout id', b.stripe_checkout_id)}
${fact('Stripe payment intent', b.stripe_payment_intent)}<li><span>Payment link</span>${link || '<i style="color:var(--ink-soft)">none</i>'}</li>
${fact('Balance amount', b.balance_amount_cents != null ? formatUsd(b.balance_amount_cents) : '')}${fact('Balance sent at', b.balance_sent_at)}${fact('Balance paid at', b.balance_paid_at)}
${fact('Details submitted at', b.details_submitted_at)}${fact('Terms accepted', b.terms_accepted_at ? `${b.terms_version || ''} ${b.terms_accepted_at}` : '')}</ul></div>
<script>document.querySelectorAll('form[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.dataset.confirm))e.preventDefault();});});</script>`,
  });
}

function linesFor(b, trip) {
  if (b.balance_breakdown) {
    try {
      const a = JSON.parse(b.balance_breakdown);
      if (Array.isArray(a) && a.length) return a.map((l) => ({ label: String(l.label || ''), cents: Number(l.cents) || 0 }));
    } catch { /* fall through */ }
  }
  return computeBalance(trip, b).lines;
}

async function pageBalance(env, request, url, email, slug, ref) {
  const trip = await getTrip(env, request, slug);
  const b = await getBooking(env, ref);
  if (!trip || !b || b.slug !== slug) return layout({ title: 'Not found', email, banner: { text: 'Booking not found.', err: true }, body: '' });
  const calc = computeBalance(trip, b);
  const lines = b.stripe_payment_link_url ? linesFor(b, trip) : calc.lines;
  const row = (l) => `<tr class="bl-row"><td><input type="text" name="label" value="${esc(l.label)}" aria-label="Line label"></td><td style="width:160px"><input type="number" step="0.01" name="amount" value="${(l.cents / 100).toFixed(2)}" aria-label="Amount in USD" class="bl-amt"></td></tr>`;
  const existing = b.stripe_payment_link_url ? `<div class="adm-card"><h2>Balance link</h2>
<p>${b.balance_amount_cents != null ? `<span class="adm-total">${esc(formatUsd(b.balance_amount_cents))}</span>` : ''} ${b.balance_sent_at ? `&middot; email sent ${fmtDate(b.balance_sent_at)}` : '&middot; email not sent yet'}</p>
<div class="adm-linkbox">${esc(b.stripe_payment_link_url)}</div>
<form method="post" action="/api/admin/${esc(slug)}/${esc(ref)}/balance"><input type="hidden" name="action" value="resend"><button class="btn btn-line" type="submit">Resend email</button></form>
<p class="adm-sub" style="margin:18px 0 0">To change the amount, edit the lines below and create a new link. The old link is not deactivated automatically.</p></div>` : '';
  return layout({
    title: `Balance ${ref}`, email, banner: bannerFrom(url),
    body: `<a class="adm-crumb" href="/admin/${esc(slug)}/${esc(ref)}">${esc(ref)}</a><h1>Balance</h1>
<p class="adm-sub">${esc(guestNames(b).lead)} &middot; ${esc(trip.title)} &middot; ${b.travelers} traveler${b.travelers > 1 ? 's' : ''}. Pre-filled from the trip prices and the booking; edit any line or add one.</p>${existing}
<form class="adm-card" method="post" action="/api/admin/${esc(slug)}/${esc(ref)}/balance" id="balform">
<table class="adm-t"><thead><tr><th>Line</th><th>Amount (USD)</th></tr></thead><tbody id="bl">${lines.map(row).join('')}</tbody></table>
<p style="margin:14px 0 0"><button class="btn btn-line" type="button" id="addline">Add a line</button></p>
<p style="margin:22px 0 0"><span class="lab" style="display:inline">Total</span> <span class="adm-total" id="total"></span></p>
<div class="hint">A discount or the deposit credit is a negative amount. The guest sees every line in the email.</div>
<div class="adm-actions" style="margin:24px 0 0"><button class="btn btn-solid" type="submit">${b.stripe_payment_link_url ? 'Create new link and send' : 'Create and send balance link'}</button></div></form>
<script>(function(){var bl=document.getElementById('bl');function tot(){var s=0;bl.querySelectorAll('.bl-amt').forEach(function(i){s+=Math.round((parseFloat(i.value)||0)*100)});document.getElementById('total').textContent=(s/100).toLocaleString('en-US',{style:'currency',currency:'USD'});}
bl.addEventListener('input',tot);document.getElementById('addline').addEventListener('click',function(){var t=document.createElement('tbody');t.innerHTML='<tr class="bl-row"><td><input type="text" name="label" aria-label="Line label"></td><td style="width:160px"><input type="number" step="0.01" name="amount" value="0.00" class="bl-amt" aria-label="Amount in USD"></td></tr>';bl.appendChild(t.firstChild);});
document.getElementById('balform').addEventListener('submit',function(e){if(!confirm('Create the payment link and email it to the guest?'))e.preventDefault();});tot();})();</script>`,
  });
}

/* ---------------- API actions ---------------- */

function back(path, params) {
  const q = new URLSearchParams(params).toString();
  return redirect(`${path}${q ? '?' + q : ''}`);
}
function errBack(path, text) { return back(path, { err: text }); }

async function apiCreate(env, request, url, email, slug) {
  const page = `/admin/${slug}/new`;
  const trip = await getTrip(env, request, slug);
  if (!trip || !trip.trip_ref) return errBack(`/admin/${slug}`, 'Trip not found or has no trip_ref');
  const F = await readForm(request);
  const { errors, fields } = parseBookingForm(F, trip, { edit: false });
  if (errors.length) return errBack(page, errors.join('. '));
  const rec = {
    ...fields, trip_ref: trip.trip_ref, slug: trip.slug, trip_title: trip.title, source: 'manual',
    deposit_amount_cents: trip.deposit_amount_cents * fields.travelers,
    deposit_paid_at: fields.status === 'deposit_paid' ? nowIso() : null,
    notes: fields.notes,
  };
  if (fields.partner_booking_ref) {
    const pr = await resolvePartnerRef(env, fields.partner_booking_ref, trip.trip_ref, null);
    if (pr.error) return errBack(page, 'Roommate booking reference not found');
  }
  const ref = await insertBooking(env, rec);
  if (fields.partner_booking_ref) await linkPartner(env, fields.partner_booking_ref, ref);
  console.log('admin', email, 'create_booking', ref);
  let msg = `Booking ${ref} created.`;
  if (truthy(F.get('send_confirmation'))) {
    try {
      const b = await getBooking(env, ref);
      await sendManualConfirmation(env, url.origin, trip, b, request);
      console.log('admin', email, 'send_confirmation', ref);
      msg += ' Confirmation email sent.';
    } catch (err) {
      console.error('admin confirmation email failed', ref, err);
      return back(`/admin/${slug}/${ref}`, { err: `Booking ${ref} created, but the confirmation email failed: ${String(err && err.message).slice(0, 200)}` });
    }
  }
  return back(`/admin/${slug}/${ref}`, { saved: 1, msg });
}

async function apiEdit(env, request, url, email, slug, ref) {
  const page = `/admin/${slug}/${ref}`;
  const trip = await getTrip(env, request, slug);
  const b = await getBooking(env, ref);
  if (!trip || !b || b.slug !== slug) return errBack(`/admin/${slug}`, 'Booking not found');
  const F = await readForm(request);
  if (F.get('action') === 'cancel') {
    await updateBooking(env, ref, { status: 'cancelled' });
    console.log('admin', email, 'cancel_booking', ref);
    return back(page, { saved: 1, msg: 'Booking cancelled.' });
  }
  const { errors, fields } = parseBookingForm(F, trip, { edit: true });
  if (errors.length) return errBack(page, errors.join('. '));
  if (fields.partner_booking_ref) {
    const pr = await resolvePartnerRef(env, fields.partner_booking_ref, b.trip_ref, ref);
    if (pr.error) return errBack(page, 'Roommate booking reference not found');
  }
  if (fields.status === 'deposit_paid' && !b.deposit_paid_at) fields.deposit_paid_at = nowIso();
  if (fields.status === 'balance_paid' && !b.balance_paid_at) fields.balance_paid_at = nowIso();
  await updateBooking(env, ref, fields);
  if (fields.partner_booking_ref && fields.partner_booking_ref !== b.partner_booking_ref) await linkPartner(env, fields.partner_booking_ref, ref);
  console.log('admin', email, 'edit_booking', ref);
  return back(page, { saved: 1, msg: 'Changes saved.' });
}

async function apiDetailsLink(env, request, url, email, slug, ref) {
  const trip = await getTrip(env, request, slug);
  const b = await getBooking(env, ref);
  const retPage = (request.headers.get('Referer') || '').includes(`/admin/${slug}/${ref}`) ? `/admin/${slug}/${ref}` : `/admin/${slug}`;
  if (!trip || !b || b.slug !== slug) return errBack(`/admin/${slug}`, 'Booking not found');
  try {
    const link = detailsUrl(url.origin, b, await bookingToken(env, ref));
    const to = [b.email];
    if (b.travelers > 1 && b.rm_email && b.rm_email.toLowerCase() !== b.email.toLowerCase()) to.push(b.rm_email);
    const htmlBody = emailShell({
      title: `Your traveler details — ${esc(trip.title)}`,
      preheader: `Complete your traveler details for booking ${esc(ref)}.`,
      eyebrow: 'Traveler details', heading: esc(trip.title),
      bodyHtml: `<p style="margin:0 0 16px;">Hi ${esc(b.first_name)},</p>
<p style="margin:0 0 16px;">Here is your personal link to complete the traveler details for booking <strong>${esc(ref)}</strong> (${esc(trip.dates)}). It takes a few minutes and can be saved and revisited.</p>
${emailButton(link, 'Complete traveler details')}
<p style="margin:26px 0 16px;">Questions? Just reply to this email${trip.contact_phone ? ` or call ${esc(trip.contact_phone)}` : ''}.</p>`,
      footerNote: 'L&rsquo;Dor Vador Travel',
      origin: emailAssetOrigin(request),
    });
    await sendResendEmail(env, {
      from: FROM, to, reply_to: 'connect@ldorvadortravel.com',
      subject: `Your traveler details link — ${trip.title} (${ref})`, html: htmlBody,
      text: `Hi ${b.first_name},\n\nComplete your traveler details for booking ${ref}: ${link}\n\nL'Dor Vador Travel`,
    });
    console.log('admin', email, 'resend_details_link', ref);
    return back(retPage, { saved: 1, msg: `Details link emailed to ${to.join(', ')}.` });
  } catch (err) {
    console.error('admin details link failed', ref, err);
    return errBack(retPage, `Could not send the details link: ${String(err && err.message).slice(0, 200)}`);
  }
}

async function apiBalance(env, request, url, email, slug, ref) {
  const page = `/admin/${slug}/${ref}/balance`;
  const trip = await getTrip(env, request, slug);
  const b = await getBooking(env, ref);
  if (!trip || !b || b.slug !== slug) return errBack(`/admin/${slug}`, 'Booking not found');
  const F = await readForm(request);
  try {
    if (F.get('action') === 'resend') {
      if (!b.stripe_payment_link_url) return errBack(page, 'No balance link exists yet');
      await sendBalanceEmail(env, url.origin, trip, b, linesFor(b, trip), b.stripe_payment_link_url, request);
      console.log('admin', email, 'resend_balance_email', ref);
      return back(page, { saved: 1, msg: 'Balance email resent.' });
    }
    const labels = F.all('label');
    const amounts = F.all('amount');
    const lines = [];
    for (let i = 0; i < labels.length; i++) {
      const label = clampStr(labels[i], 200);
      const cents = moneyToCents(amounts[i]);
      if (!label && (cents === null || cents === 0)) continue;
      if (!label) return errBack(page, 'Every line needs a label');
      if (cents === null) return errBack(page, `Invalid amount on line "${label}"`);
      lines.push({ label, cents });
    }
    const total = lines.reduce((s, l) => s + l.cents, 0);
    if (!lines.length || total <= 0) return errBack(page, 'The total must be greater than zero');
    const link = await createBalancePaymentLink(env, trip, b, total, lines, url.origin);
    console.log('admin', email, 'create_balance_link', ref);
    const fresh = await getBooking(env, ref);
    try {
      await sendBalanceEmail(env, url.origin, trip, fresh, lines, link.url, request);
      console.log('admin', email, 'send_balance_email', ref);
    } catch (err) {
      console.error('admin balance email failed', ref, err);
      return errBack(page, `Link created (${link.url}) but the email failed: ${String(err && err.message).slice(0, 200)}. Use Resend email.`);
    }
    return back(page, { saved: 1, msg: `Balance link created and emailed: ${link.url}` });
  } catch (err) {
    console.error('admin balance failed', ref, err);
    return errBack(page, `Could not create the balance link: ${String(err && err.message).slice(0, 200)}`);
  }
}

async function exportCsv(env, request, url, slug, kind) {
  const trip = await getTrip(env, request, slug);
  let rows = await listBookings(env, { slug });
  const tripRef = (trip && trip.trip_ref) || (rows[0] && rows[0].trip_ref) || slug;
  if (!trip && !rows.length) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (kind === 'export') {
    if (!truthy(url.searchParams.get('all'))) rows = rows.filter((b) => b.status !== 'cancelled');
    return csvResponse(`${tripRef}-travelers.csv`, EXPORT_COLUMNS, rows.map(bookingToExportRow));
  }
  rows = rows.filter((b) => b.status !== 'cancelled');
  const out = roomingRows(rows, trip);
  out.sort((a, b) => {
    const ra = a['room number'], rb = b['room number'];
    if (!ra !== !rb) return ra ? -1 : 1;
    return ra.localeCompare(rb, 'en', { numeric: true }) || a['booking reference'].localeCompare(b['booking reference']);
  });
  return csvResponse(`${tripRef}-rooming-list.csv`, ROOMING_COLUMNS, out);
}

/* ---------------- router ---------------- */

export async function handleAdmin(request, env, url, ctx) {
  const email = request.headers.get('cf-access-authenticated-user-email') || '';
  const method = request.method;
  let path = url.pathname.replace(/\/+$/, '');
  const isApi = path.startsWith('/api/admin');
  const parts = path.replace(/^\/(api\/)?admin/, '').split('/').filter(Boolean);
  if (!parts.every((p) => SEG_RE.test(p) || /^export\.csv$|^rooming\.csv$/.test(p))) return new Response('Not found', { status: 404 });
  try {
    if (!isApi) {
      if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      if (parts.length === 0) return await pageTripList(env, url, email);
      const [slug, a, c] = parts;
      if (parts.length === 1) return await pageTrip(env, request, url, email, slug);
      if (parts.length === 2) return a === 'new' ? await pageNew(env, request, url, email, slug) : await pageEdit(env, request, url, email, slug, a);
      if (parts.length === 3 && c === 'balance') return await pageBalance(env, request, url, email, slug, a);
      return new Response('Not found', { status: 404 });
    }
    const [slug, a, c] = parts;
    if (!slug || !a) return new Response('Not found', { status: 404 });
    if (method === 'GET' && parts.length === 2 && (a === 'export.csv' || a === 'rooming.csv')) {
      return await exportCsv(env, request, url, slug, a === 'export.csv' ? 'export' : 'rooming');
    }
    if (method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ ok: false, error: 'forbidden' }, 403);
    if (parts.length === 2) return a === 'bookings' ? await apiCreate(env, request, url, email, slug) : await apiEdit(env, request, url, email, slug, a);
    if (parts.length === 3 && c === 'details-link') return await apiDetailsLink(env, request, url, email, slug, a);
    if (parts.length === 3 && c === 'balance') return await apiBalance(env, request, url, email, slug, a);
    return json({ ok: false, error: 'not found' }, 404);
  } catch (err) {
    console.error('admin error', email, path, err);
    return layout({ title: 'Error', email, banner: { text: 'Something went wrong. Check the Worker logs.', err: true }, body: '<p><a class="adm-crumb" href="/admin/">Back to trips</a></p>' });
  }
}
