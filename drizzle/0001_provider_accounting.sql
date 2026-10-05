ALTER TABLE jobs ADD COLUMN estimated REAL NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN actual_credits REAL;
ALTER TABLE jobs ADD COLUMN billing_details TEXT;
ALTER TABLE jobs ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN poll_started INTEGER;
ALTER TABLE jobs ADD COLUMN next_poll INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN poll_failures INTEGER NOT NULL DEFAULT 0;
CREATE TABLE job_charges (
  id TEXT PRIMARY KEY NOT NULL,
  job TEXT NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider TEXT,
  outcome TEXT NOT NULL,
  estimated REAL NOT NULL DEFAULT 0,
  actual REAL,
  details TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX job_charges_budget ON job_charges(kind);
UPDATE jobs SET estimated = CASE WHEN reserved > 0 THEN reserved WHEN kind='world' THEN 230 WHEN kind='furniture' THEN 30 ELSE 0 END,
  poll_started = CASE WHEN provider IS NOT NULL THEN updated ELSE NULL END;
UPDATE jobs SET actual_credits = CASE
  WHEN json_valid(result) AND json_type(result,'$.cost') IN ('integer','real') THEN json_extract(result,'$.cost')
  WHEN json_valid(result) AND json_type(result,'$.cost.total_credits') IN ('integer','real') THEN json_extract(result,'$.cost.total_credits')
  ELSE NULL END WHERE status='done';
INSERT INTO job_charges(id,job,owner,kind,attempt,provider,outcome,estimated,actual,details,created)
  SELECT id||':'||attempt,id,owner,kind,attempt,provider,'success',estimated,actual_credits,result,updated FROM jobs WHERE status='done';
UPDATE jobs SET reserved=0,settled=1 WHERE status='done';
INSERT INTO job_charges(id,job,owner,kind,attempt,provider,outcome,estimated,actual,details,created)
  SELECT id||':'||attempt,id,owner,kind,attempt,provider,'failed',0,NULL,result,updated FROM jobs
  WHERE status='failed' AND json_valid(result) AND json_extract(result,'$.terminal')=1;
UPDATE jobs SET reserved=0,settled=1 WHERE status='failed' AND json_valid(result) AND json_extract(result,'$.terminal')=1;
UPDATE jobs SET status=CASE WHEN provider IS NULL THEN 'uncertain' ELSE 'paused' END
  WHERE status='failed' AND settled=0;
