PRAGMA foreign_keys = OFF;

CREATE TABLE equipment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO equipment_types (code, display_name, sort_order) VALUES
  ('VEHICLE_KEY', 'Vehicle Key', 10),
  ('IPAD', 'iPad', 20),
  ('PORTABLE_RADIO', 'Portable Radio', 30);

CREATE TABLE equipment_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT NOT NULL UNIQUE,
  qr_code TEXT NOT NULL UNIQUE,
  asset_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  vehicle_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (asset_type) REFERENCES equipment_types(code)
);

INSERT INTO equipment_new (id,asset_code,qr_code,asset_type,display_name,vehicle_id,active,created_at,updated_at)
SELECT id,asset_code,qr_code,asset_type,display_name,vehicle_id,active,created_at,updated_at FROM equipment;

DROP TABLE equipment;
ALTER TABLE equipment_new RENAME TO equipment;
CREATE INDEX idx_equipment_vehicle ON equipment(vehicle_id);
CREATE INDEX idx_equipment_type ON equipment(asset_type);

PRAGMA foreign_keys = ON;
