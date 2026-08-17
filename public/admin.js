const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function fmt(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

async function loadDashboard() {
  try {
    const data = await api("/api/admin/dashboard");
    $("adminIdentity").textContent = data.adminEmail ? `Signed in as ${data.adminEmail}` : "Protected by Cloudflare Access";
    $("employeeCount").textContent = data.counts.employees;
    $("assetCount").textContent = data.counts.assets;
    $("signedOutCount").textContent = data.counts.signedOut;
    $("exceptionCount").textContent = data.counts.exceptions;

    $("vehicleId").innerHTML = '<option value="">Unassigned</option>' + data.vehicles.map(v => `<option value="${v.id}">${v.unit_number}</option>`).join("");
    $("currentRows").innerHTML = data.current.length ? data.current.map(r => `<tr><td>${r.asset_code} - ${r.display_name}</td><td>${r.unit_number || "-"}</td><td>${r.employee_name || "-"} (${r.employee_code || "-"})</td><td>${fmt(r.signed_out_at)}</td></tr>`).join("") : '<tr><td colspan="4" class="muted">Nothing is currently signed out.</td></tr>';
    $("transactionRows").innerHTML = data.transactions.length ? data.transactions.map(r => `<tr><td>${fmt(r.occurred_at)}</td><td>${r.action}</td><td>${r.asset_code}</td><td>${r.unit_number || "-"}</td><td>${r.employee_name} (${r.employee_code})</td></tr>`).join("") : '<tr><td colspan="5" class="muted">No transactions yet.</td></tr>';
  } catch (err) {
    $("adminIdentity").textContent = err.message;
    $("adminIdentity").classList.add("danger");
  }
}

$("employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/employees", { method: "POST", body: JSON.stringify({ employeeCode: $("employeeCode").value, firstName: $("firstName").value, lastName: $("lastName").value }) });
    event.target.reset(); $("employeeMessage").textContent = "Employee added."; await loadDashboard();
  } catch (err) { $("employeeMessage").textContent = err.message; }
});

$("vehicleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/vehicles", { method: "POST", body: JSON.stringify({ unitNumber: $("unitNumber").value, description: $("vehicleDescription").value }) });
    event.target.reset(); $("vehicleMessage").textContent = "Vehicle added."; await loadDashboard();
  } catch (err) { $("vehicleMessage").textContent = err.message; }
});

$("equipmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const assetCode = $("assetCode").value.trim().toUpperCase();
    await api("/api/admin/equipment", { method: "POST", body: JSON.stringify({ assetCode, assetType: $("assetType").value, displayName: $("displayName").value, vehicleId: $("vehicleId").value || null }) });
    event.target.reset(); $("equipmentMessage").textContent = `Equipment added. QR payload: EAS:${assetCode}`; await loadDashboard();
  } catch (err) { $("equipmentMessage").textContent = err.message; }
});

loadDashboard();
