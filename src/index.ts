type EmployeeRow = {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
};

type EquipmentRow = {
  id: number;
  asset_code: string;
  qr_code: string;
  asset_type: string;
  display_name: string;
  unit_number: string | null;
  status: string;
  holder_name: string | null;
};

type TransactionAction = "SIGN_OUT" | "RETURN";
type ReportType = "NOON" | "EVENING";

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

function normalizeAssetCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized.startsWith("EAS:") ? normalized.slice(4) : normalized;
}

async function getEmployee(env: Env, code: string): Promise<EmployeeRow | null> {
  return env.DB.prepare(
    "SELECT id, employee_code, first_name, last_name FROM employees WHERE employee_code = ? AND active = 1",
  )
    .bind(code)
    .first<EmployeeRow>();
}

async function employeeLookup(request: Request, env: Env): Promise<Response> {
  const code = (new URL(request.url).searchParams.get("code") ?? "").trim();
  if (!/^\d{4}$/.test(code)) return error("Employee ID must be exactly four digits.");

  const employee = await getEmployee(env, code);
  if (!employee) return error("Employee not found or inactive.", 404);

  return json({
    employeeCode: employee.employee_code,
    name: `${employee.first_name} ${employee.last_name}`,
  });
}

async function equipmentList(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      e.id,
      e.asset_code,
      e.qr_code,
      e.asset_type,
      e.display_name,
      v.unit_number,
      s.status,
      CASE WHEN h.id IS NULL THEN NULL ELSE h.first_name || ' ' || h.last_name END holder_name
    FROM equipment e
    LEFT JOIN vehicles v ON v.id = e.vehicle_id
    JOIN equipment_state s ON s.equipment_id = e.id
    LEFT JOIN employees h ON h.id = s.employee_id
    WHERE e.active = 1
    ORDER BY COALESCE(v.unit_number, ''), e.asset_type, e.display_name
  `).all<EquipmentRow>();

  return json({ equipment: result.results });
}

async function processTransaction(
  request: Request,
  env: Env,
  action: TransactionAction,
): Promise<Response> {
  let body: {
    employeeCode?: string;
    assets?: Array<{ code?: string }>;
    terminalId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }

  const employeeCode = (body.employeeCode ?? "").trim();
  if (!/^\d{4}$/.test(employeeCode)) return error("Employee ID must be exactly four digits.");

  const employee = await getEmployee(env, employeeCode);
  if (!employee) return error("Employee not found or inactive.", 404);

  const assetCodes = [
    ...new Set(
      (Array.isArray(body.assets) ? body.assets : [])
        .map((item) => normalizeAssetCode(item.code ?? ""))
        .filter(Boolean),
    ),
  ];

  if (!assetCodes.length) return error("Select and verify at least one equipment item.");
  if (assetCodes.length > 10) return error("Too many equipment items in one transaction.");

  const placeholders = assetCodes.map(() => "?").join(",");
  const lookup = await env.DB.prepare(`
    SELECT e.id, e.asset_code, e.vehicle_id, s.status
    FROM equipment e
    JOIN equipment_state s ON s.equipment_id = e.id
    WHERE e.active = 1 AND e.asset_code IN (${placeholders})
  `)
    .bind(...assetCodes)
    .all<{ id: number; asset_code: string; vehicle_id: number | null; status: string }>();

  if (lookup.results.length !== assetCodes.length) {
    return error("One or more equipment codes were not recognized.", 404);
  }

  for (const asset of lookup.results) {
    if (action === "SIGN_OUT" && asset.status !== "AVAILABLE") {
      return error(`${asset.asset_code} is not currently available.`, 409);
    }
    if (action === "RETURN" && asset.status !== "SIGNED_OUT") {
      return error(`${asset.asset_code} is not currently signed out.`, 409);
    }
  }

  const now = new Date().toISOString();
  const terminalId = (body.terminalId ?? "").slice(0, 80) || null;
  const statements: D1PreparedStatement[] = [];
  const completed: Array<{ assetCode: string; transactionId: string }> = [];

  for (const asset of lookup.results) {
    const id = crypto.randomUUID();
    statements.push(
      env.DB.prepare(`
        INSERT INTO transactions
          (id, equipment_id, employee_id, vehicle_id, action, occurred_at, terminal_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, asset.id, employee.id, asset.vehicle_id, action, now, terminalId),
    );
    statements.push(
      env.DB.prepare(`
        UPDATE equipment_state
        SET status = ?, employee_id = ?, last_transaction_id = ?, updated_at = ?
        WHERE equipment_id = ?
      `).bind(
        action === "SIGN_OUT" ? "SIGNED_OUT" : "AVAILABLE",
        action === "SIGN_OUT" ? employee.id : null,
        id,
        now,
        asset.id,
      ),
    );
    completed.push({ assetCode: asset.asset_code, transactionId: id });
  }

  await env.DB.batch(statements);

  return json({
    ok: true,
    action,
    employee: `${employee.first_name} ${employee.last_name}`,
    occurredAt: now,
    items: completed,
  });
}

async function current(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      e.asset_code,
      e.display_name,
      e.asset_type,
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
  `).all();

  return json({ signedOut: result.results });
}

function reportType(date: Date, timeZone: string): ReportType | null {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;

  return hour === "12" ? "NOON" : hour === "20" ? "EVENING" : null;
}

async function reportPeriodStart(env: Env, type: ReportType, end: string): Promise<string> {
  const previous = await env.DB.prepare(`
    SELECT period_end
    FROM reports
    WHERE period_end < ?
    ORDER BY period_end DESC
    LIMIT 1
  `)
    .bind(end)
    .first<{ period_end: string }>();

  if (previous?.period_end) return previous.period_end;

  const fallbackHours = type === "NOON" ? 16 : 8;
  return new Date(new Date(end).getTime() - fallbackHours * 60 * 60 * 1000).toISOString();
}

async function generateReport(env: Env, type: ReportType, at: Date): Promise<void> {
  const end = at.toISOString();
  const start = await reportPeriodStart(env, type, end);

  const currentRows = await env.DB.prepare(`
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
  `).all();

  const activity = await env.DB.prepare(`
    SELECT
      t.id,
      t.action,
      t.occurred_at,
      e.asset_code,
      e.display_name,
      v.unit_number,
      p.employee_code,
      p.first_name || ' ' || p.last_name employee_name
    FROM transactions t
    JOIN equipment e ON e.id = t.equipment_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    JOIN employees p ON p.id = t.employee_id
    WHERE t.occurred_at > ? AND t.occurred_at <= ?
    ORDER BY t.occurred_at
  `)
    .bind(start, end)
    .all();

  await env.DB.prepare(`
    INSERT INTO reports
      (id, report_type, period_start, period_end, generated_at, payload_json, delivery_status)
    VALUES (?, ?, ?, ?, ?, ?, 'NOT_CONFIGURED')
  `)
    .bind(
      crypto.randomUUID(),
      type,
      start,
      end,
      end,
      JSON.stringify({ current: currentRows.results, activity: activity.results }),
    )
    .run();
}

async function purge(env: Env, now: Date): Promise<void> {
  const parsed = Number.parseInt(env.RETENTION_DAYS || "180", 10);
  const days = Number.isFinite(parsed) && parsed >= 30 ? parsed : 180;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

  await env.DB.prepare(`
    DELETE FROM transactions
    WHERE occurred_at < ?
      AND id NOT IN (
        SELECT transaction_id FROM retention_holds WHERE released_at IS NULL
      )
      AND id NOT IN (
        SELECT last_transaction_id FROM equipment_state WHERE last_transaction_id IS NOT NULL
      )
  `)
    .bind(cutoff)
    .run();

  await env.DB.prepare("DELETE FROM reports WHERE generated_at < ?").bind(cutoff).run();
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "eas" });
      }
      if (url.pathname === "/api/employees/lookup" && request.method === "GET") {
        return employeeLookup(request, env);
      }
      if (url.pathname === "/api/equipment" && request.method === "GET") {
        return equipmentList(env);
      }
      if (url.pathname === "/api/current" && request.method === "GET") {
        return current(env);
      }
      if (url.pathname === "/api/signout" && request.method === "POST") {
        return processTransaction(request, env, "SIGN_OUT");
      }
      if (url.pathname === "/api/return" && request.method === "POST") {
        return processTransaction(request, env, "RETURN");
      }
      if (url.pathname.startsWith("/api/")) return error("Not found.", 404);

      return env.ASSETS.fetch(request);
    } catch (cause) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, cause: String(cause) }));
      return error("Unexpected server error.", 500);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    const now = new Date();
    const type = reportType(now, env.APP_TIME_ZONE || "America/New_York");

    if (type) ctx.waitUntil(generateReport(env, type, now));
    ctx.waitUntil(purge(env, now));
  },
} satisfies ExportedHandler<Env>;
