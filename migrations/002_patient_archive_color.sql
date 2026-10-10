-- DermaTriz migration 002: safe patient archive and organization color
ALTER TABLE patients ADD COLUMN IF NOT EXISTS card_color VARCHAR(24) NOT NULL DEFAULT 'default';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS patients_owner_active_idx ON patients(user_id, archived_at, display_name);
