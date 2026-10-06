-- Roommate who books and pays separately (two-way link between the two bookings).
ALTER TABLE bookings ADD COLUMN roommate_separate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN partner_booking_ref TEXT;
