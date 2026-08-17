import { createRemoteJWKSet, jwtVerify } from "jose";

type AdminContext = { email: string };
type ImportEmployee = { employeeCode?: string; firstName?: string; lastName?: string };
type CleanEmployee = { employeeCode: string; firstName: string; lastName: string };
type ImportEquipment = { unitNumber?: string; assetType?: string; displayName?: string; assetCode?: string };
type CleanEquipment = { unitNumber: string; assetType: string; displayName: string; assetCode: string };

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

async function verifyAdmin(request: Request, env: Env): Promise<AdminContext | null> {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    const jwks = createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer: env.TEAM_DOMAIN, audience: env.POLICY_AUD });
    return typeof payload.email === "string" ? { email: payload.email.slice(0, 254) } : null;
  } catch {
    return null;
  }
}

async function audit(env: Env, admin: AdminContext, action: string, type: string, id: string | null, details: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO admin_audit (id,admin_email,action,entity_type,entity_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), admin.email, action, type, id, new Date().toISOString(), JSON.stringify(details)).run();
}

function cleanEmployee(row: ImportEmployee): CleanEmployee | null {
  const raw = (row.employeeCode ?? "").trim();
  const employeeCode = /^\d{1,4}$/.test(raw) ? raw.padStart(4, "0") : raw;
  const firstName = (row.firstName ?? "").trim();
  const lastName = (row.lastName ?? "").trim();
  return /^\d{4}$/.test(employeeCode) && firstName && lastName ? { employeeCode, firstName, lastName } : null;
}

function cleanEquipment(row: ImportEquipment): CleanEquipment | null {
  const unitNumber = (row.unitNumber ?? "").trim();
  const assetCode = (row.assetCode ?? "").trim().toUpperCase();
  const displayName = (row.displayName ?? "").trim();
  let assetType = (row.assetType ?? "").trim().toUpperCase().replace(/[ -]+/g, "_");
  if (assetType === "RADIO" || assetType === "PORTABLE") assetType = "PORTABLE_RADIO";
  if (assetType === "KEY" || assetType === "VEHICLEKEY") assetType = "VEHICLE_KEY";
  if (!/^[A-Z0-9_-]{2,30}$/.test(assetCode) || !displayName || !["VEHICLE_KEY", "IPAD", "PORTABLE_RADIO"].includes(assetType)) return null;
  return { unitNumber, assetType, displayName, assetCode };
}

async function dashboard(env: Env, admin: AdminContext): Promise<Response> {
  const [employees, assets, signedOut, exceptions, current, transactions, vehicles] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM employees WHERE active=1").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM equipment WHERE active=1").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM equipment_state WHERE status='SIGNED_OUT'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM equipment_state WHERE status IN ('DAMAGED','MISSING')").first<{ count: number }>(),
    env.DB.prepare("SELECT e.asset_code,e.display_name,v.unit_number,p.employee_code,p.first_name||' '||p.last_name employee_name,s.updated_at signed_out_at FROM equipment_state s JOIN equipment e ON e.id=s.equipment_id LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN employees p ON p.id=s.employee_id WHERE s.status='SIGNED_OUT' ORDER BY s.updated_at").all(),
    env.DB.prepare("SELECT t.action,t.occurred_at,e.asset_code,v.unit_number,p.employee_code,p.first_name||' '||p.last_name employee_name FROM transactions t JOIN equipment e ON e.id=t.equipment_id LEFT JOIN vehicles v ON v.id=t.vehicle_id JOIN employees p ON p.id=t.employee_id ORDER BY t.occurred_at DESC LIMIT 50").all(),
    env.DB.prepare("SELECT id,unit_number FROM vehicles WHERE active=1 ORDER BY unit_number").all(),
  ]);
  return json({ adminEmail: admin.email, counts: { employees: employees?.count ?? 0, assets: assets?.count ?? 0, signedOut: signedOut?.count ?? 0, exceptions: exceptions?.count ?? 0 }, current: current.results, transactions: transactions.results, vehicles: vehicles.results });
}

async function employeeList(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT e.id,e.employee_code,e.first_name,e.last_name,e.active,COUNT(t.id) transaction_count FROM employees e LEFT JOIN transactions t ON t.employee_id=e.id GROUP BY e.id ORDER BY e.last_name,e.first_name").all();
  return json({ employees: result.results });
}

async function addEmployee(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const employee = cleanEmployee(await request.json<ImportEmployee>());
  if (!employee) return fail("Enter a valid employee ID, first name, and last name.");
  try {
    const result = await env.DB.prepare("INSERT INTO employees (employee_code,first_name,last_name) VALUES (?,?,?)").bind(employee.employeeCode, employee.firstName, employee.lastName).run();
    await audit(env, admin, "CREATE", "EMPLOYEE", String(result.meta.last_row_id), employee);
    return json({ ok: true, employeeCode: employee.employeeCode }, { status: 201 });
  } catch {
    return fail("Employee ID already exists or could not be added.", 409);
  }
}

async function setEmployeeActive(env: Env, admin: AdminContext, id: number, active: boolean): Promise<Response> {
  const employee = await env.DB.prepare("SELECT employee_code,first_name,last_name FROM employees WHERE id=?").bind(id).first();
  if (!employee) return fail("Employee not found.", 404);
  await env.DB.prepare("UPDATE employees SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(active ? 1 : 0, id).run();
  await audit(env, admin, active ? "REACTIVATE" : "DEACTIVATE", "EMPLOYEE", String(id), employee);
  return json({ ok: true });
}

async function deleteEmployee(env: Env, admin: AdminContext, id: number): Promise<Response> {
  const employee = await env.DB.prepare("SELECT employee_code,first_name,last_name FROM employees WHERE id=?").bind(id).first();
  if (!employee) return fail("Employee not found.", 404);
  const history = await env.DB.prepare("SELECT COUNT(*) count FROM transactions WHERE employee_id=?").bind(id).first<{ count: number }>();
  const held = await env.DB.prepare("SELECT COUNT(*) count FROM equipment_state WHERE employee_id=?").bind(id).first<{ count: number }>();
  if ((history?.count ?? 0) > 0 || (held?.count ?? 0) > 0) return fail("This employee has equipment history. Deactivate instead.", 409);
  await env.DB.prepare("DELETE FROM employees WHERE id=?").bind(id).run();
  await audit(env, admin, "DELETE", "EMPLOYEE", String(id), employee);
  return json({ ok: true });
}

async function previewEmployees(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ employees?: ImportEmployee[] }>();
  const rows = Array.isArray(body.employees) ? body.employees.slice(0, 1000) : [];
  const seen = new Set<string>();
  const preview: Array<Record<string, unknown>> = [];
  for (const raw of rows) {
    const employee = cleanEmployee(raw);
    if (!employee) { preview.push({ ...raw, status: "INVALID", reason: "Employee ID must be numeric and names are required." }); continue; }
    if (seen.has(employee.employeeCode)) { preview.push({ ...employee, status: "INVALID", reason: "Duplicate employee ID in import file." }); continue; }
    seen.add(employee.employeeCode);
    const existing = await env.DB.prepare("SELECT first_name,last_name FROM employees WHERE employee_code=?").bind(employee.employeeCode).first<{ first_name: string; last_name: string }>();
    if (!existing) preview.push({ ...employee, status: "NEW" });
    else if (existing.first_name.toLowerCase() === employee.firstName.toLowerCase() && existing.last_name.toLowerCase() === employee.lastName.toLowerCase()) preview.push({ ...employee, status: "EXISTS", existingName: `${existing.first_name} ${existing.last_name}` });
    else preview.push({ ...employee, status: "CONFLICT", existingName: `${existing.first_name} ${existing.last_name}` });
  }
  return json({ preview, counts: preview.reduce((acc, row) => { const key = String(row.status).toLowerCase(); acc[key] = (acc[key] || 0) + 1; return acc; }, {} as Record<string, number>) });
}

async function importEmployees(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ employees?: ImportEmployee[] }>();
  const rows = Array.isArray(body.employees) ? body.employees.slice(0, 1000) : [];
  const unique = new Map<string, CleanEmployee>();
  for (const raw of rows) { const employee = cleanEmployee(raw); if (employee && !unique.has(employee.employeeCode)) unique.set(employee.employeeCode, employee); }
  let inserted = 0, skipped = 0;
  const statements: D1PreparedStatement[] = [];
  for (const employee of unique.values()) {
    if (await env.DB.prepare("SELECT id FROM employees WHERE employee_code=?").bind(employee.employeeCode).first()) { skipped++; continue; }
    statements.push(env.DB.prepare("INSERT INTO employees (employee_code,first_name,last_name) VALUES (?,?,?)").bind(employee.employeeCode, employee.firstName, employee.lastName));
  }
  for (let i = 0; i < statements.length; i += 50) { await env.DB.batch(statements.slice(i, i + 50)); inserted += Math.min(50, statements.length - i); }
  await audit(env, admin, "IMPORT", "EMPLOYEE", null, { inserted, skipped });
  return json({ ok: true, inserted, skipped });
}

async function equipmentList(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT e.id,e.asset_code,e.asset_type,e.display_name,e.qr_code,e.active,v.unit_number,COALESCE(s.status,'AVAILABLE') status,p.employee_code,p.first_name||' '||p.last_name employee_name,COUNT(DISTINCT t.id) transaction_count FROM equipment e LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN equipment_state s ON s.equipment_id=e.id LEFT JOIN employees p ON p.id=s.employee_id LEFT JOIN transactions t ON t.equipment_id=e.id GROUP BY e.id ORDER BY CASE WHEN v.unit_number IS NULL THEN 1 ELSE 0 END,v.unit_number,e.asset_type,e.display_name").all();
  return json({ equipment: result.results });
}

async function previewEquipment(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ equipment?: ImportEquipment[] }>();
  const rows = Array.isArray(body.equipment) ? body.equipment.slice(0, 1000) : [];
  const seen = new Set<string>();
  const preview: Array<Record<string, unknown>> = [];
  for (const raw of rows) {
    const equipment = cleanEquipment(raw);
    if (!equipment) { preview.push({ ...raw, status: "INVALID", reason: "Valid type, display name, and asset code are required. Unit Number may be blank." }); continue; }
    if (seen.has(equipment.assetCode)) { preview.push({ ...equipment, status: "INVALID", reason: "Duplicate asset code in import file." }); continue; }
    seen.add(equipment.assetCode);
    const existing = await env.DB.prepare("SELECT e.asset_type,e.display_name,v.unit_number FROM equipment e LEFT JOIN vehicles v ON v.id=e.vehicle_id WHERE e.asset_code=?").bind(equipment.assetCode).first<{ asset_type: string; display_name: string; unit_number: string | null }>();
    if (!existing) preview.push({ ...equipment, status: "NEW" });
    else if (existing.asset_type === equipment.assetType && existing.display_name.toLowerCase() === equipment.displayName.toLowerCase() && (existing.unit_number ?? "").toLowerCase() === equipment.unitNumber.toLowerCase()) preview.push({ ...equipment, status: "EXISTS", existingName: existing.display_name });
    else preview.push({ ...equipment, status: "CONFLICT", existingName: `${existing.unit_number ?? "Unassigned"} / ${existing.display_name} / ${existing.asset_type}` });
  }
  return json({ preview, counts: preview.reduce((acc, row) => { const key = String(row.status).toLowerCase(); acc[key] = (acc[key] || 0) + 1; return acc; }, {} as Record<string, number>) });
}

async function importEquipment(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ equipment?: ImportEquipment[] }>();
  const rows = Array.isArray(body.equipment) ? body.equipment.slice(0, 1000) : [];
  const unique = new Map<string, CleanEquipment>();
  for (const raw of rows) { const equipment = cleanEquipment(raw); if (equipment && !unique.has(equipment.assetCode)) unique.set(equipment.assetCode, equipment); }
  let inserted = 0, skipped = 0, vehiclesCreated = 0, unassigned = 0;
  for (const equipment of unique.values()) {
    if (await env.DB.prepare("SELECT id FROM equipment WHERE asset_code=?").bind(equipment.assetCode).first()) { skipped++; continue; }
    let vehicleId: number | null = null;
    if (equipment.unitNumber) {
      let vehicle = await env.DB.prepare("SELECT id FROM vehicles WHERE unit_number=?").bind(equipment.unitNumber).first<{ id: number }>();
      if (!vehicle) {
        const result = await env.DB.prepare("INSERT INTO vehicles (unit_number) VALUES (?)").bind(equipment.unitNumber).run();
        vehicle = { id: Number(result.meta.last_row_id) };
        vehiclesCreated++;
      }
      vehicleId = vehicle.id;
    } else {
      unassigned++;
    }
    const result = await env.DB.prepare("INSERT INTO equipment (asset_code,qr_code,asset_type,display_name,vehicle_id) VALUES (?,?,?,?,?)")
      .bind(equipment.assetCode, `EAS:${equipment.assetCode}`, equipment.assetType, equipment.displayName, vehicleId).run();
    await env.DB.prepare("INSERT INTO equipment_state (equipment_id,status,updated_at) VALUES (?,'AVAILABLE',CURRENT_TIMESTAMP)").bind(Number(result.meta.last_row_id)).run();
    inserted++;
  }
  await audit(env, admin, "IMPORT", "EQUIPMENT", null, { inserted, skipped, vehiclesCreated, unassigned, submitted: rows.length });
  return json({ ok: true, inserted, skipped, vehiclesCreated, unassigned });
}

async function setEquipmentActive(env: Env, admin: AdminContext, id: number, active: boolean): Promise<Response> {
  const equipment = await env.DB.prepare("SELECT asset_code,display_name FROM equipment WHERE id=?").bind(id).first();
  if (!equipment) return fail("Equipment not found.", 404);
  if (!active) {
    const state = await env.DB.prepare("SELECT status FROM equipment_state WHERE equipment_id=?").bind(id).first<{ status: string }>();
    if (state?.status === "SIGNED_OUT") return fail("Return this equipment before deactivating it.", 409);
  }
  await env.DB.prepare("UPDATE equipment SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(active ? 1 : 0, id).run();
  await audit(env, admin, active ? "REACTIVATE" : "DEACTIVATE", "EQUIPMENT", String(id), equipment);
  return json({ ok: true });
}

async function deleteEquipment(env: Env, admin: AdminContext, id: number): Promise<Response> {
  const equipment = await env.DB.prepare("SELECT asset_code,display_name FROM equipment WHERE id=?").bind(id).first();
  if (!equipment) return fail("Equipment not found.", 404);
  const history = await env.DB.prepare("SELECT COUNT(*) count FROM transactions WHERE equipment_id=?").bind(id).first<{ count: number }>();
  if ((history?.count ?? 0) > 0) return fail("This equipment has transaction history. Deactivate instead.", 409);
  await env.DB.prepare("DELETE FROM equipment_state WHERE equipment_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM equipment WHERE id=?").bind(id).run();
  await audit(env, admin, "DELETE", "EQUIPMENT", String(id), equipment);
  return json({ ok: true });
}

async function addVehicle(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ unitNumber?: string; description?: string }>();
  const unit = (body.unitNumber ?? "").trim();
  const description = (body.description ?? "").trim();
  if (!unit) return fail("Unit number is required.");
  try {
    const result = await env.DB.prepare("INSERT INTO vehicles (unit_number,description) VALUES (?,?)").bind(unit, description || null).run();
    await audit(env, admin, "CREATE", "VEHICLE", String(result.meta.last_row_id), { unitNumber: unit });
    return json({ ok: true }, { status: 201 });
  } catch {
    return fail("Unit number already exists or could not be added.", 409);
  }
}

async function addEquipment(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ assetCode?: string; assetType?: string; displayName?: string; vehicleId?: string | null }>();
  const assetCode = (body.assetCode ?? "").trim().toUpperCase();
  const assetType = (body.assetType ?? "").trim();
  const displayName = (body.displayName ?? "").trim();
  if (!/^[A-Z0-9_-]{2,30}$/.test(assetCode) || !["VEHICLE_KEY", "IPAD", "PORTABLE_RADIO"].includes(assetType) || !displayName) return fail("Valid asset code, equipment type, and display name are required.");
  const vehicleId = body.vehicleId ? Number(body.vehicleId) : null;
  try {
    const result = await env.DB.prepare("INSERT INTO equipment (asset_code,qr_code,asset_type,display_name,vehicle_id) VALUES (?,?,?,?,?)").bind(assetCode, `EAS:${assetCode}`, assetType, displayName, vehicleId).run();
    const id = Number(result.meta.last_row_id);
    await env.DB.prepare("INSERT INTO equipment_state (equipment_id,status,updated_at) VALUES (?,'AVAILABLE',CURRENT_TIMESTAMP)").bind(id).run();
    await audit(env, admin, "CREATE", "EQUIPMENT", String(id), { assetCode });
    return json({ ok: true, qrCode: `EAS:${assetCode}` }, { status: 201 });
  } catch {
    return fail("Asset code/QR already exists or equipment could not be added.", 409);
  }
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const admin = await verifyAdmin(request, env);
  if (!admin) return fail("Admin access requires Cloudflare Access authentication.", 401);
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/admin/dashboard" && request.method === "GET") return dashboard(env, admin);
    if (path === "/api/admin/employees" && request.method === "GET") return employeeList(env);
    if (path === "/api/admin/employees" && request.method === "POST") return addEmployee(request, env, admin);
    if (path === "/api/admin/employees/preview" && request.method === "POST") return previewEmployees(request, env);
    if (path === "/api/admin/employees/import" && request.method === "POST") return importEmployees(request, env, admin);
    let match = path.match(/^\/api\/admin\/employees\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (request.method === "DELETE") return deleteEmployee(env, admin, id);
      if (request.method === "PATCH") {
        const body = await request.json<{ active?: boolean }>();
        return typeof body.active === "boolean" ? setEmployeeActive(env, admin, id, body.active) : fail("Active status is required.");
      }
    }
    if (path === "/api/admin/equipment" && request.method === "GET") return equipmentList(env);
    if (path === "/api/admin/equipment" && request.method === "POST") return addEquipment(request, env, admin);
    if (path === "/api/admin/equipment/preview" && request.method === "POST") return previewEquipment(request, env);
    if (path === "/api/admin/equipment/import" && request.method === "POST") return importEquipment(request, env, admin);
    match = path.match(/^\/api\/admin\/equipment\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (request.method === "DELETE") return deleteEquipment(env, admin, id);
      if (request.method === "PATCH") {
        const body = await request.json<{ active?: boolean }>();
        return typeof body.active === "boolean" ? setEquipmentActive(env, admin, id, body.active) : fail("Active status is required.");
      }
    }
    if (path === "/api/admin/vehicles" && request.method === "POST") return addVehicle(request, env, admin);
    return fail("Not found.", 404);
  } catch (cause) {
    console.error(JSON.stringify({ event: "admin_error", path, cause: String(cause) }));
    return fail("Unexpected admin error.", 500);
  }
}
