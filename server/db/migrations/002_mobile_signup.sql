-- Players sign up with a mobile number instead of an email address.
-- Email becomes optional (admins created from the CLI may still have one).
ALTER TABLE users ADD COLUMN mobile TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_mobile_format CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$');
CREATE UNIQUE INDEX users_mobile_uq ON users (mobile) WHERE mobile IS NOT NULL;
