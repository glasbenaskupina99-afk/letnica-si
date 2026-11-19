-- Časolov: anonimna statistika odigranih iger
-- visitor = psevdonimna oznaka, izračunana iz IP-naslova in naključne dnevne
-- vrednosti (stats_salts). Vrednosti se po dveh dneh izbrišejo, zato oznak ni
-- mogoče povezati med dnevi ali nazaj z IP-naslovom. IP-naslov se ne shrani.

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,              -- dan igranja (Europe/Ljubljana)
  mode TEXT NOT NULL,             -- 'daily' | 'freeplay'
  challenge_date TEXT,            -- datum dnevnega izziva (le za 'daily')
  visitor TEXT NOT NULL,
  reached_year INTEGER NOT NULL,
  points INTEGER NOT NULL,
  exact_count INTEGER NOT NULL,
  timeouts INTEGER NOT NULL,
  answers TEXT NOT NULL,          -- [{e: id dogodka, d: odstopanje ali null}]
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_day ON plays(day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_daily_once ON plays(challenge_date, visitor) WHERE mode = 'daily';

CREATE TABLE IF NOT EXISTS stats_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
