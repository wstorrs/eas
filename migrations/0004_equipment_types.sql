DROP TABLE IF EXISTS equipment_new;

CREATE TABLE IF NOT EXISTS equipment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO equipment_types (code, display_name, sort_order) VALUES
  ('VEHICLE_KEY', 'Vehicle Key', 10),
  ('IPAD', 'iPad', 20),
  ('PORTABLE_RADIO', 'Portable Radio', 30);

-- Keep the original asset_type column in place because transactions and
-- equipment_state reference the equipment table. A separate configurable
-- type code avoids rebuilding that referenced table in D1.
ALTER TABLE equipment ADD COLUMN equipment_type_code TEXT;

UPDATE equipment
SET equipment_type_code = asset_type
WHERE equipment_type_code IS NULL OR equipment_type_code = '';

CREATE INDEX IF NOT EXISTS idx_equipment_type_code ON equipment(equipment_type_code);
