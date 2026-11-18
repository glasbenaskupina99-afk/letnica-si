-- Časolov: igralci brez prijave, zasebne sobe in dnevni rezultati

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, player_id)
);
CREATE INDEX IF NOT EXISTS idx_members_player ON room_members(player_id);

-- En rezultat na igralca in dan; velja v vseh sobah, v katerih je igralec
CREATE TABLE IF NOT EXISTS results (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  reached_year INTEGER NOT NULL,
  points INTEGER NOT NULL,
  exact_count INTEGER NOT NULL,
  emojis TEXT NOT NULL,
  answers TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date_key)
);
CREATE INDEX IF NOT EXISTS idx_results_date ON results(date_key);
