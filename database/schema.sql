-- Schema idempotent. Ne supprime jamais de donnees au demarrage.
CREATE TABLE IF NOT EXISTS roles (
  id smallserial PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name IN ('admin', 'user'))
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  role_id smallint NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username));
CREATE INDEX IF NOT EXISTS users_role_active_idx ON users(role_id, active);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS survey_solutions_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  server_url text NOT NULL,
  workspace text NOT NULL DEFAULT 'primary',
  allow_insecure_http boolean NOT NULL DEFAULT false,
  username_encrypted text NOT NULL,
  password_encrypted text NOT NULL,
  connection_status text NOT NULL DEFAULT 'NON CONNECTÉ' CHECK (connection_status IN ('CONNECTÉ', 'NON CONNECTÉ', 'ERREUR DE CONNEXION')),
  server_version text,
  last_tested_at timestamptz,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Migration non destructive pour les bases créées avant l'option HTTP explicite.
ALTER TABLE survey_solutions_config ADD COLUMN IF NOT EXISTS allow_insecure_http boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS questionnaires (
  id uuid PRIMARY KEY,
  external_id text NOT NULL,
  workspace text NOT NULL,
  title text NOT NULL,
  variable text,
  status text NOT NULL DEFAULT 'SYNCHRONISÉ',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace, external_id)
);
CREATE TABLE IF NOT EXISTS questionnaire_versions (
  id uuid PRIMARY KEY,
  questionnaire_id uuid NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  version bigint NOT NULL,
  identity text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_id, version)
);
CREATE INDEX IF NOT EXISTS questionnaire_versions_questionnaire_idx ON questionnaire_versions(questionnaire_id, version DESC);
CREATE TABLE IF NOT EXISTS sections (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  parent_id uuid REFERENCES sections(id) ON DELETE SET NULL,
  title text NOT NULL,
  variable_name text,
  enabling_condition text,
  is_roster boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  UNIQUE (version_id, external_id)
);
CREATE INDEX IF NOT EXISTS sections_version_position_idx ON sections(version_id, position);
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  section_id uuid REFERENCES sections(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  variable_name text NOT NULL,
  label text NOT NULL,
  type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',
  constraints jsonb NOT NULL DEFAULT '[]',
  min_value numeric,
  max_value numeric,
  enabling_condition text,
  is_roster boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  UNIQUE(version_id, external_id)
);
CREATE INDEX IF NOT EXISTS questions_version_section_idx ON questions(version_id, section_id, position);
CREATE INDEX IF NOT EXISTS questions_variable_idx ON questions(version_id, variable_name);
CREATE TABLE IF NOT EXISTS quality_rules (
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('min','max','range','equals','not_equals','allowed','required','format','min_length','max_length','compare','consistency','duplicate')),
  params jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_rules_question_active_idx ON quality_rules(question_id, active);
CREATE TABLE IF NOT EXISTS survey_responses (
  id uuid PRIMARY KEY,
  external_id text NOT NULL,
  questionnaire_id uuid NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  interviewer text,
  supervisor text,
  source_status text,
  answers jsonb NOT NULL DEFAULT '{}',
  last_modified_at timestamptz,
  status text NOT NULL DEFAULT 'NON CONTRÔLÉ' CHECK (status IN ('CONFORME','NON CONFORME','NON CONTRÔLÉ')),
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, external_id)
);
CREATE INDEX IF NOT EXISTS survey_responses_questionnaire_status_idx ON survey_responses(questionnaire_id, status);
CREATE INDEX IF NOT EXISTS survey_responses_filter_idx ON survey_responses(version_id, last_modified_at, interviewer, supervisor);
CREATE TABLE IF NOT EXISTS quality_results (
  id uuid PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES quality_rules(id) ON DELETE CASCADE,
  instance_key text NOT NULL DEFAULT '',
  value jsonb,
  status text NOT NULL CHECK (status IN ('CONFORME','NON CONFORME','NON CONTRÔLÉ')),
  error_type text,
  details text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(response_id, rule_id, instance_key)
);
CREATE INDEX IF NOT EXISTS quality_results_status_date_idx ON quality_results(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS quality_results_question_idx ON quality_results(question_id, status);
CREATE TABLE IF NOT EXISTS sync_logs (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  questionnaires_count int NOT NULL DEFAULT 0,
  questions_count int NOT NULL DEFAULT 0,
  responses_count int NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS sync_logs_started_idx ON sync_logs(started_at DESC);
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  username text NOT NULL,
  action text NOT NULL,
  target text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_logs_date_idx ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_user_idx ON activity_logs(user_id, created_at DESC);

-- Automatic analysis extends existing results without removing manual rules.
ALTER TABLE quality_results ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS occurrence integer NOT NULL DEFAULT 1;
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'MODÉRÉE';
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS related jsonb NOT NULL DEFAULT '[]';
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS automatic_check text;
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS quality_score integer;
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS quality_class text;
CREATE TABLE IF NOT EXISTS quality_settings (
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1), settings jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO quality_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS quality_analysis (
 version_id uuid PRIMARY KEY REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
 fingerprint text NOT NULL, checked integer NOT NULL, missing_count integer NOT NULL, eligible integer NOT NULL,
 detected_types jsonb NOT NULL, analyzed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_results_response_idx ON quality_results(response_id);
CREATE INDEX IF NOT EXISTS quality_results_severity_idx ON quality_results(severity) WHERE status='NON CONFORME';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT false;
