PRAGMA foreign_keys = ON;

CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE CHECK(length(employee_code) = 4),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_number TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT NOT NULL UNIQUE,
  qr_code TEXT NOT NULL UNIQUE,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('VEHICLE_KEY', 'IPAD', 'PORTABLE_RADIO')),
  display_name TEXT NOT NULL,
  vehicle_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  equipment_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  vehicle_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('SIGN_OUT', 'RETURN', 'ADMIN_RETURN', 'STATUS_CHANGE')),
  occurred_at TEXT NOT NULL,
  terminal_id TEXT,
  notes TEXT,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE equipment_state (
  equipment_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE', 'SIGNED_OUT', 'DAMAGED', 'MISSING')),
  employee_id INTEGER,
  last_transaction_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (last_transaction_id) REFERENCES transactions(id)
);

CREATE TABLE report_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  noon_report INTEGER NOT NULL DEFAULT 1 CHECK(noon_report IN (0, 1)),
  evening_report INTEGER NOT NULL DEFAULT 1 CHECK(evening_report IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL CHECK(report_type IN ('NOON', 'EVENING')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(delivery_status IN ('PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED'))
);

CREATE TABLE retention_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX idx_transactions_equipment ON transactions(equipment_id, occurred_at);
CREATE INDEX idx_equipment_vehicle ON equipment(vehicle_id);
CREATE INDEX idx_equipment_state_status ON equipment_state(status);
