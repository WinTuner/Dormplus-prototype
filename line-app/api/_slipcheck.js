// Automatic slip check against SlipVerify (free community API, api.nearbyshop.xyz).
// Optional: without SLIP_VERIFY_TOKEN the owner simply confirms by hand as before.
//
// Never throws — a verifier outage must not stop a tenant from attaching a slip.
const ENDPOINT = process.env.SLIP_VERIFY_URL || "https://api.nearbyshop.xyz/slipVerify/v1";
const TIMEOUT_MS = 8000;

// v1 answers in more than one shape across deployments, so accept several signals.
function normalize(body) {
  if (!body || typeof body !== "object") return { ok: null, reason: "empty-response" };
  const data = body.data && typeof body.data === "object" ? body.data : body;

  const amount = Number(data.amount ?? data.transAmount ?? data.paidAmount ?? NaN);
  const ref = data.transRef || data.transactionRef || data.ref || null;
  const flag =
    body.success === true ||
    data.success === true ||
    data.status === "success" ||
    data.valid === true ||
    data.verified === true ||
    data.statusCode === "0000";

  const explicitNo =
    body.success === false || data.valid === false || data.verified === false || data.status === "not_found";

  if (explicitNo) return { ok: false, amount: Number.isFinite(amount) ? amount : null, ref, raw: body };
  if (flag) return { ok: true, amount: Number.isFinite(amount) ? amount : null, ref, raw: body };
  return { ok: null, reason: "unrecognised-response", amount: null, ref, raw: body };
}

async function verifySlip({ image, mime, amount }) {
  const token = process.env.SLIP_VERIFY_TOKEN;
  if (!token) return { ok: null, reason: "not-configured" };
  if (!image) return { ok: null, reason: "no-image" };

  try {
    const bytes = Buffer.from(image, "base64");
    const form = new FormData();
    form.append("qr_img", new Blob([bytes], { type: mime || "image/jpeg" }), "slip.jpg");
    if (amount != null) form.append("amount", String(amount));

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) return { ok: null, reason: `http-${res.status}`, detail: text.slice(0, 200) };

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: null, reason: "not-json", detail: text.slice(0, 200) };
    }
    const out = normalize(body);
    return { ...out, checkedAt: new Date().toISOString(), provider: "slipverify" };
  } catch (err) {
    return { ok: null, reason: err.name === "TimeoutError" ? "timeout" : "network", detail: String(err.message).slice(0, 160) };
  }
}

module.exports = { verifySlip };
