-- The swarm: nodes that joined a coordinator, the runs they trained and each run's rounds.
-- Written only by the coordinator through POST /v1/swarm/ingest; read by /v1/swarm, /dashboard and /console.
-- Times are Unix milliseconds. A node's `github` is the member it is attributed to.
CREATE TABLE swarm_nodes (
  id TEXT PRIMARY KEY,
  github TEXT COLLATE NOCASE,
  hostname TEXT NOT NULL,
  device TEXT NOT NULL,
  gpu TEXT NOT NULL,
  memory_gib REAL NOT NULL,
  torch TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL
) STRICT;
CREATE INDEX swarm_nodes_github ON swarm_nodes (github);

CREATE TABLE swarm_runs (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  params INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  weights_hash TEXT,
  git_sha TEXT,
  initial_val_loss REAL,
  wall_seconds REAL
) STRICT;
CREATE INDEX swarm_runs_started ON swarm_runs (started_at);

CREATE TABLE swarm_run_nodes (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  PRIMARY KEY (run_id, node_id)
) STRICT;
CREATE INDEX swarm_run_nodes_node ON swarm_run_nodes (node_id);

CREATE TABLE swarm_rounds (
  run_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  val_loss REAL NOT NULL,
  hashes_agree INTEGER NOT NULL,
  elapsed REAL NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, round)
) STRICT;
CREATE INDEX swarm_rounds_at ON swarm_rounds (at);

CREATE TABLE swarm_round_nodes (
  run_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  train_loss REAL NOT NULL,
  seconds REAL NOT NULL,
  PRIMARY KEY (run_id, round, node_id)
) STRICT;
CREATE INDEX swarm_round_nodes_node ON swarm_round_nodes (node_id);
