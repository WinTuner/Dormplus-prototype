// Meter reading through Gemini — one photo in, the digits on the dial out.
//
// The answer is a suggestion for the owner, never a bill: the page fills the unit fields and the
// owner still has to read them and tap save. `ok: null` means "cannot tell" (no key, timeout, a
// photo with no readable digits) so the owner types the numbers the way they always have.
//
// The dial shows a running total while the bill needs this month's use, so the reader only reports
// the dial; the page subtracts last month's dial (stored on `meter:<room>.dial`).
const TIMEOUT_MS = 15_000;
const MODEL = "gemini-2.5-flash";
const MAX_READING = 10_000_000;

const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const PROMPT = [
  "ภาพนี้คือหน้าปัดมิเตอร์น้ำหรือไฟของห้องพักในหอพักไทย",
  "อ่านเฉพาะตัวเลขบนหน้าปัด (เลขสะสม) — ห้ามคำนวณส่วนต่าง ห้ามเดาตัวเลขที่มองไม่เห็น",
  "water = เลขบนมิเตอร์น้ำ (ไม่มีมิเตอร์น้ำในภาพ → null)",
  "elec = เลขบนมิเตอร์ไฟ (ไม่มีมิเตอร์ไฟในภาพ → null)",
  "ถ้าตัวเลขไม่คมชัดพอ (เบลอ แสงสะท้อน เห็นไม่ครบ) ให้ตัวนั้นเป็น null",
  "confidence = high เมื่ออ่านได้ครบทุกหลักอย่างชัดเจน, low เมื่อต้องเดาหรือภาพไม่ดี",
  "note = สั้น ๆ ว่าอ่านจากส่วนไหนของภาพ หรืออ่านไม่ได้เพราะอะไร",
].join("\n");

// Forcing JSON means a malformed reply is caught here instead of being parsed out of prose.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    water: { type: "NUMBER", nullable: true },
    elec: { type: "NUMBER", nullable: true },
    confidence: { type: "STRING", enum: ["high", "low"] },
    note: { type: "STRING" },
  },
  required: ["confidence"],
  propertyOrdering: ["water", "elec", "confidence", "note"],
};

const reading = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < MAX_READING ? v : null);

// The model's JSON, kept only when it holds at least one number we would accept.
function parse(text) {
  let obj;
  try {
    obj = JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const water = reading(obj.water);
  const elec = reading(obj.elec);
  if (water === null && elec === null) return null;
  return {
    water,
    elec,
    confidence: obj.confidence === "high" ? "high" : "low",
    note: typeof obj.note === "string" ? obj.note.slice(0, 200) : "",
  };
}

// `fetchImpl` is how the tests run this without a network; production passes nothing.
function createReader({ key, model = MODEL, fetchImpl = fetch }) {
  return async function readMeter({ data, mime }) {
    if (!key) return { ok: null, reason: "not_configured" };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(ENDPOINT(model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
        signal: abort.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (body && body.error && body.error.message) || `HTTP ${res.status}`;
        return { ok: null, reason: `อ่านไม่ได้ (${msg})` };
      }
      const text = ((body.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
      const out = parse(text);
      return out ? { ok: true, ...out } : { ok: null, reason: "อ่านไม่ได้ (ไม่เห็นตัวเลขบนมิเตอร์)" };
    } catch (err) {
      const reason = abort.signal.aborted ? "อ่านไม่ได้ (หมดเวลา)" : `อ่านไม่ได้ (${err.message})`;
      return { ok: null, reason };
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  readMeter: (arg) => createReader({ key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || MODEL })(arg),
  createReader,
};
