-- Fictional development data only.
INSERT INTO employees (employee_code, first_name, last_name) VALUES
('1001','Alex','Morgan'),
('1002','Jordan','Taylor');

INSERT INTO vehicles (unit_number, description) VALUES
('701','Sample Unit 701'),
('702','Sample Unit 702');

INSERT INTO equipment (asset_code, qr_code, asset_type, display_name, vehicle_id) VALUES
('K701','EAS:K701','VEHICLE_KEY','Unit 701 Vehicle Key',1),
('I701A','EAS:I701A','IPAD','Unit 701 iPad 1',1),
('I701B','EAS:I701B','IPAD','Unit 701 iPad 2',1),
('R701A','EAS:R701A','PORTABLE_RADIO','Unit 701 Portable Radio 1',1),
('R701B','EAS:R701B','PORTABLE_RADIO','Unit 701 Portable Radio 2',1);

INSERT INTO equipment_state (equipment_id, status, updated_at)
SELECT id, 'AVAILABLE', CURRENT_TIMESTAMP FROM equipment;
