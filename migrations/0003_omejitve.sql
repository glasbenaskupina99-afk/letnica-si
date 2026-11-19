-- Časolov: omejitve števila zahtevkov na obiskovalca na dan (zaščita pred boti)
CREATE TABLE IF NOT EXISTS rate_limits (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  action TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, visitor, action)
);
