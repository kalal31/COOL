import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','technician','student')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  building TEXT,
  capacity INTEGER NOT NULL DEFAULT 24 CHECK (capacity > 0),
  description TEXT
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  level TEXT,
  size INTEGER NOT NULL DEFAULT 24 CHECK (size > 0)
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  serial TEXT,
  location TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','maintenance','out_of_service')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS reagents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  formula TEXT,
  cas TEXT,
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'mL',
  min_quantity REAL NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  expiry_date TEXT,
  hazards TEXT NOT NULL DEFAULT '',
  location TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  reagent_id INTEGER NOT NULL REFERENCES reagents(id) ON DELETE CASCADE,
  delta REAL NOT NULL,
  quantity_after REAL NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practicals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  level TEXT,
  duration_min INTEGER NOT NULL DEFAULT 120 CHECK (duration_min > 0),
  objectives TEXT,
  description TEXT,
  safety_notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practical_equipment (
  practical_id INTEGER NOT NULL REFERENCES practicals(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (practical_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS practical_reagents (
  practical_id INTEGER NOT NULL REFERENCES practicals(id) ON DELETE CASCADE,
  reagent_id INTEGER NOT NULL REFERENCES reagents(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (practical_id, reagent_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  practical_id INTEGER REFERENCES practicals(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  stations INTEGER NOT NULL DEFAULT 1 CHECK (stations > 0),
  notes TEXT,
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON bookings(room_id, date);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  loaned_at TEXT NOT NULL,
  due_date TEXT NOT NULL,
  returned_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_loans_open ON loans(equipment_id) WHERE returned_at IS NULL;

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

/** Exécute fn dans une transaction ; annule tout si fn lève une erreur. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
