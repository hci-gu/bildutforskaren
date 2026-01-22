from __future__ import annotations

import sqlite3
from pathlib import Path

DB_FILENAME = "dataset.sqlite"

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  rel_path TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (image_id, tag_id, source),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
"""


def dataset_db_path(dataset_dir: Path, db_name: str = DB_FILENAME) -> Path:
    return dataset_dir / db_name


def init_dataset_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    return conn


def connect_dataset_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_images(conn: sqlite3.Connection, dataset_dir: Path, image_paths: list[Path]) -> int:
    row = conn.execute("SELECT COUNT(1) AS cnt FROM images").fetchone()
    if row and int(row["cnt"]) > 0:
        return 0

    rows: list[tuple[int, str]] = []
    for idx, path in enumerate(image_paths):
        rel = path.relative_to(dataset_dir).as_posix()
        rows.append((idx, rel))

    if not rows:
        return 0

    conn.executemany("INSERT INTO images (id, rel_path) VALUES (?, ?)", rows)
    return len(rows)
