-- Bookings (deposit via Stripe Checkout, balance via Stripe Payment Link).
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref TEXT NOT NULL,
  trip_ref TEXT NOT NULL,
  slug TEXT NOT NULL,
  trip_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','deposit_paid','deposit_failed','balance_sent','balance_paid','cancelled')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','manual')),
  travelers INTEGER NOT NULL DEFAULT 1,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  room TEXT NOT NULL CHECK (room IN ('single','double')),
  bed TEXT CHECK (bed IS NULL OR bed IN ('king','queens')),
  rm_first_name TEXT, rm_last_name TEXT, rm_email TEXT, rm_phone TEXT,
  pre_from TEXT, pre_to TEXT, post_from TEXT, post_to TEXT,
  extensions_confirmed INTEGER NOT NULL DEFAULT 0,
  pre_confirmed_from TEXT, pre_confirmed_to TEXT,
  post_confirmed_from TEXT, post_confirmed_to TEXT,
  ec_name TEXT, ec_email TEXT, ec_phone TEXT,
  dietary TEXT,
  terms_version TEXT,
  terms_accepted_at TEXT,
  g1_dob TEXT, g1_passport_number TEXT, g1_passport_country TEXT, g1_passport_expiry TEXT,
  g1_flight_arrival TEXT, g1_flight_departure TEXT,
  g2_dob TEXT, g2_passport_number TEXT, g2_passport_country TEXT, g2_passport_expiry TEXT,
  g2_flight_arrival TEXT, g2_flight_departure TEXT,
  details_submitted_at TEXT,
  optionals_selected TEXT,            -- JSON array of optional names
  deposit_amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_id TEXT,
  stripe_payment_intent TEXT,
  deposit_paid_at TEXT,
  balance_amount_cents INTEGER,
  balance_breakdown TEXT,             -- JSON [{label, cents}]
  stripe_payment_link_id TEXT,
  stripe_payment_link_url TEXT,
  balance_sent_at TEXT,
  balance_paid_at TEXT,
  room_number TEXT,
  is_tour_leader INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_ref ON bookings (booking_ref);
CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings (trip_ref, status);
CREATE INDEX IF NOT EXISTS idx_bookings_slug ON bookings (slug);
CREATE INDEX IF NOT EXISTS idx_bookings_ip ON bookings (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS booking_seq (
  trip_ref TEXT PRIMARY KEY,
  last INTEGER NOT NULL DEFAULT 0
);

-- Stripe webhook idempotency: one row per processed event id.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Light per-IP rate limiting for endpoints that don't insert rows (details form).
CREATE TABLE IF NOT EXISTS rate_events (
  kind TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events (kind, ip_hash, created_at);
