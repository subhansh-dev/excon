-- DSSC Trainer schema. Applied by `npm run db:migrate`.
-- JSONL files remain the replay source of truth; these tables are the queryable mirror.

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  deception_objective TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  t DOUBLE PRECISION NOT NULL,
  from_seat TEXT NOT NULL,
  to_seat TEXT,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  origin TEXT NOT NULL DEFAULT 'truth',
  integrity DOUBLE PRECISION NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_run ON messages(run_id, t);

CREATE TABLE IF NOT EXISTS decisions (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  t DOUBLE PRECISION NOT NULL,
  seat TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  choice TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ooda_s DOUBLE PRECISION NOT NULL DEFAULT 0,
  correct BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(run_id, seat);

CREATE TABLE IF NOT EXISTS probes (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  t DOUBLE PRECISION NOT NULL,
  seat TEXT NOT NULL,
  freeze_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tick INTEGER NOT NULL,
  t DOUBLE PRECISION NOT NULL,
  seat TEXT NOT NULL,
  iis DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics_snapshots(run_id, seat, tick);
