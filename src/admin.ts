import { createRemoteJWKSet, jwtVerify } from "jose";

type AdminContext = { email: string };

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
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });

    return typeof payload.email === "string" && payload.email.length > 0
      ? { email: payload.email.slice(0, 254) }
      : null;
  } catch (cause) {
    console.error(JSON.stringify({ event: "admin_auth_failed", cause: String(cause) }));
    return null;
  }
}

async function audit(
  env: Env,
  admin: AdminContext,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO admin_audit
      (id, admin_email, action, entity_type, entity_id, occurred_at, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      admin.email,
      action,
      entityType,
      entityId,
      new Date().toISOString(),
      JSON.stringify(details),
    )
    .run();
}

async function dashboard(env: Env, admin: AdminContext): Promise<Response> {
  const [employees, assets, signedOut, exceptions, current, transactions, vehicles] =
    await Promise.all([
      env.DB.prepare("SELECT COUNT(*) count FROM employees WHERE active = 1").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) count FROM equipment WHERE active = 1").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) count FROM equipment_state WHERE status = 'SIGNED_OUT'").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) count FROM equipment_state WHERE status IN ('DAMAGED','MISSING')").first<{ count: number }>(),
      env.DB.prepare(`
        SELECT
          e.asset_code,
          e.display_name,
          v.unit_number,
          p.employee_code,
          p.first_name || ' ' || p.last_name employee_name,
          s.updated_at signed_out_at
        FROM equipment_state s
        JOIN equipment e ON e.id = s.equipment_id
        LEFT JOIN vehicles v ON v.id = e.vehicle_id
        LEFT JOIN employees p ON p.id = s.employee_id
        WHERE s.status = 'SIGNED_OUT'
        ORDER BY s.updated_at
      `).all(),
      env.DB.prepare(`
        SELECT
          t.action,
          t.occurred_at,
          e.asset_code,
          v.unit_number,
          p.employee_code,
          p.first_name || ' ' || p.last_name employee_name
        FROM transactions t
        JOIN equipment e ON e.id = t.equipment_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        JOIN employees p ON p.id = t.employee_id
        ORDER BY t.occurred_at DESC
        LIMIT 50
      `).all(),
      env.DB.prepare("SELECT id, unit_number FROM vehicles WHERE active = 1 ORDER BY unit_number").all(),
    ]);

  return json({
    adminEmail: admin.email,
    counts: {
      employees: employees?.count ?? 0,
      assets: assets?.count ?? 0,
      signedOut: signedOut?.count ?? 0,
      exceptions: exceptions?.count ?? 0,
    },
    current: current.results,
    transactions: transactions.results,
    vehicles: vehicles.results,
  });
}

async function addEmployee(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ employeeCode?: string; firstName?: string; lastName?: string }>();
  const code = (body.employeeCode ?? "").trim();
  const first = (body.firstName ?? "").trim();
  const last = (body.lastName ?? "").trim();

  if (!/^\d{4}$/.test(code) || !first || !last) {
    return fail("Enter a four-digit employee ID, first name, and last name.");
  }

  try {
    const result = await env.DB.prepare(
      "INSERT INTO employees (employee_code, first_name, last_name) VALUES (?, ?, ?)",
    )
      .bind(code, first, last)
      .run();

    await audit(env, admin, "CREATE", "EMPLOYEE", String(result.meta.last_row_id), {
      employeeCode: code,
      firstName: first,
      lastName: last,
    });

    return json({ ok: true }, { status: 201 });
  } catch {
    return fail("Employee ID already exists or could not be added.", 409);
  }
}

async function addVehicle(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{ unitNumber?: string; description?: string }>();
  const unit = (body.unitNumber ?? "").trim();
  const description = (body.description ?? "").trim();

  if (!unit) return fail("Unit number is required.");

  try {
    const result = await env.DB.prepare(
      "INSERT INTO vehicles (unit_number, description) VALUES (?, ?)",
    )
      .bind(unit, description || null)
      .run();

    await audit(env, admin, "CREATE", "VEHICLE", String(result.meta.last_row_id), {
      unitNumber: unit,
      description,
    });

    return json({ ok: true }, { status: 201 });
  } catch {
    return fail("Unit number already exists or could not be added.", 409);
  }
}

async function addEquipment(request: Request, env: Env, admin: AdminContext): Promise<Response> {
  const body = await request.json<{
    assetCode?: string;
    assetType?: string;
    displayName?: string;
    vehicleId?: string | null;
  }>();

  const code = (body.assetCode ?? "").trim().toUpperCase();
  const type = (body.assetType ?? "").trim();
  const name = (body.displayName ?? "").trim();
  const validTypes = ["VEHICLE_KEY", "IPAD", "PORTABLE_RADIO"];

  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !validTypes.includes(type) || !name) {
    return fail("Valid asset code, equipment type, and display name are required.");
  }

  const vehicleId = body.vehicleId ? Number(body.vehicleId) : null;
  if (body.vehicleId && !Number.isInteger(vehicleId)) return fail("Invalid vehicle.");

  try {
    const insert = await env.DB.prepare(`
      INSERT INTO equipment
        (asset_code, qr_code, asset_type, display_name, vehicle_id)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(code, `EAS:${code}`, type, name, vehicleId)
      .run();

    const id = Number(insert.meta.last_row_id);
    await env.DB.prepare(`
      INSERT INTO equipment_state (equipment_id, status, updated_at)
      VALUES (?, 'AVAILABLE', CURRENT_TIMESTAMP)
    `)
      .bind(id)
      .run();

    await audit(env, admin, "CREATE", "EQUIPMENT", String(id), {
      assetCode: code,
      assetType: type,
      displayName: name,
      vehicleId,
    });

    return json({ ok: true, qrCode: `EAS:${code}` }, { status: 201 });
  } catch {
    return fail("Asset code/QR already exists or equipment could not be added.", 409);
  }
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const admin = await verifyAdmin(request, env);
  if (!admin) return fail("Admin access requires Cloudflare Access authentication.", 401);

  const path = new URL(request.url).pathname;

  try {
    if (path === "/api/admin/dashboard" && request.method === "GET") {
      return dashboard(env, admin);
    }
    if (path === "/api/admin/employees" && request.method === "POST") {
      return addEmployee(request, env, admin);
    }
    if (path === "/api/admin/vehicles" && request.method === "POST") {
      return addVehicle(request, env, admin);
    }
    if (path === "/api/admin/equipment" && request.method === "POST") {
      return addEquipment(request, env, admin);
    }

    return fail("Not found.", 404);
  } catch (cause) {
    console.error(
      JSON.stringify({ event: "admin_error", path, cause: String(cause), admin: admin.email }),
    );
    return fail("Unexpected admin error.", 500);
  }
}
