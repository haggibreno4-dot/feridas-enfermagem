-- DermeQuest migration 001: private patient-owned wound records
CREATE TABLE IF NOT EXISTS patients (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_code VARCHAR(64) NOT NULL, display_name VARCHAR(160) NOT NULL,
  birth_date DATE, sex VARCHAR(40), contact TEXT, clinical_context TEXT,
  comorbidities TEXT, allergies TEXT, observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, patient_code)
);
CREATE INDEX IF NOT EXISTS patients_owner_name_idx ON patients(user_id, display_name);
CREATE TABLE IF NOT EXISTS wounds (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  wound_code VARCHAR(64) NOT NULL, label VARCHAR(160) NOT NULL, location VARCHAR(160) NOT NULL,
  laterality VARCHAR(40), etiology VARCHAR(120), onset_date DATE, classification VARCHAR(120), notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, wound_code)
);
CREATE INDEX IF NOT EXISTS wounds_owner_patient_idx ON wounds(user_id, patient_id);
CREATE TABLE IF NOT EXISTS wound_assessments (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  wound_id BIGINT NOT NULL REFERENCES wounds(id) ON DELETE CASCADE,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, evolution_draft TEXT NOT NULL DEFAULT '', evolution_final TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assessments_wound_time_idx ON wound_assessments(user_id, wound_id, assessed_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL, entity_type VARCHAR(32) NOT NULL, entity_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_owner_time_idx ON audit_events(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS assessment_amendments (
  id BIGSERIAL PRIMARY KEY, assessment_id BIGINT NOT NULL REFERENCES wound_assessments(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assessment_amendments_assessment_idx ON assessment_amendments(assessment_id, created_at);
