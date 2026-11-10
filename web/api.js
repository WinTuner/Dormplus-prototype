/* DomPlus — API client (contract: docs/API.md) */
const API = (() => {
  const base = ""; // same origin; set to https://api.domplus.app/v1 in production

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || res.statusText);
      err.code = data?.error?.code || "UNKNOWN";
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    rooms: (period) => call("GET", "/v1/rooms" + (period ? "?period=" + period : "")),
    saveReading: (roomId, payload) => call("PUT", "/v1/rooms/" + roomId + "/reading", payload),
    runBilling: () => call("POST", "/v1/billing/run", {}),
    invoices: (status) => call("GET", "/v1/invoices" + (status ? "?status=" + status : "")),
    slip: (invoiceId, slipUrl) => call("POST", "/v1/invoices/" + invoiceId + "/slip", { slip_url: slipUrl }),
    confirm: (invoiceId) => call("POST", "/v1/invoices/" + invoiceId + "/confirm", {}),
    summary: () => call("GET", "/v1/reports/summary"),
  };
})();

const fmt = (n) => (n || 0).toLocaleString("th-TH");
