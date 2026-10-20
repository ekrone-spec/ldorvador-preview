-- Traveler-chosen payment method (card adds a 3% processing fee; ACH has none) and amounts actually charged.
ALTER TABLE bookings ADD COLUMN pay_method TEXT;
ALTER TABLE bookings ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN deposit_charged_cents INTEGER;
ALTER TABLE bookings ADD COLUMN balance_charged_cents INTEGER;
