// /api/owner — everything about who may use the owner screens lives here, because Vercel's Hobby
// plan allows only 12 serverless functions per deployment.
//
//   GET                (owner) -> who has owner/helper access
//   POST               (owner) -> mint a one-time code + QR      (was /api/owner-invite)
//   POST { code }      (anyone)-> redeem that code               (was /api/owner-accept)
//   DELETE { userId }  (root)  -> take that person's access away
//
// "root" is the dorm's first owner, the userId set by hand in OWNER_USER_ID. Only root can invite
// another full owner or remove anyone; an owner who was invited can only invite read-only helpers.
// Without that, one invited owner could keep adding owners and nobody could take them out again.
const crypto = require("crypto");
const store = require("./_store");
const { requireUser, isOwner, isRoot, roleOf } = require("./_auth");
const { linkRichMenu, unlinkRichMenu, push, displayName } = require("./_line");
const limit = require("./_limit");
const { mapLimit } = require("./_async");

const { qrSvg } = require("./_qr");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const TTL_MS = 10 * 60 * 1000;
const NAME_CONCURRENCY = 6;

const newCode = (length) =>
  Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

const liffUrl = (code) => (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}?owner=${code}` : null);

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return fail(res, 405, "METHOD_NOT_ALLOWED", "GET, POST or DELETE only");
  }

  const userId = await requireUser(req, res);
  if (!userId) return;

  if (req.method === "GET") return members(res, userId);
  if (req.method === "DELETE") return revoke(req, res, userId);
  const code = String((req.body && req.body.code) || "").trim().toUpperCase();
  return code ? accept(req, res, userId, code) : invite(req, res, userId);
};

// Everyone who can open the owner screens. Only root sees the LINE userIds, because only root can
// act on them (remove someone).
async function members(res, userId) {
  if (!(await isOwner(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");
  const root = isRoot(userId);

  const keys = await store.keysWith("owner:");
  const found = await mapLimit(keys, NAME_CONCURRENCY, async (key) => {
    const id = key.slice("owner:".length);
    const [record, name] = await Promise.all([store.get(key), displayName(id)]);
    if (!record) return null; // removed
    return { id, name, role: record.role === "viewer" ? "viewer" : "owner", addedAt: record.addedAt || null };
  });

  const rootId = process.env.OWNER_USER_ID || null;
  const people = [
    ...(rootId ? [{ id: rootId, name: await displayName(rootId), role: "owner", root: true, addedAt: null }] : []),
    ...found.filter((p) => p && p.id !== rootId),
  ].map((p) => ({
    ...(root ? { userId: p.id } : {}),
    name: p.name,
    role: p.role,
    root: !!p.root,
    you: p.id === userId,
    addedAt: p.addedAt,
  }));

  return res.status(200).json({ root, members: people });
}

// Root takes someone's owner/helper access away. Their invite codes stop working too, because
// accept() checks that whoever minted a code still has the right to.
async function revoke(req, res, userId) {
  if (!isRoot(userId)) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอคนแรกถอนสิทธิ์ได้");

  const target = String((req.body && req.body.userId) || "").trim();
  if (!/^U[0-9A-Za-z]{1,64}$/.test(target)) return fail(res, 400, "VALIDATION", "userId ไม่ถูกต้อง");
  if (isRoot(target)) return fail(res, 409, "INVALID_STATE", "ถอนสิทธิ์เจ้าของหอคนแรกไม่ได้");

  const key = `owner:${target}`;
  const record = await store.get(key);
  if (!record) return fail(res, 404, "NOT_FOUND", "บัญชีนี้ไม่มีสิทธิ์เจ้าของหรือผู้ช่วยอยู่แล้ว");

  // `menu:` is /api/me's note that the owner menu is linked; drop it with the menu itself.
  await Promise.all([store.set(key, null), store.set(`menu:${target}`, null)]);
  // Back to the OA's default (tenant) menu. Access is already gone whatever LINE answers here.
  await unlinkRichMenu(target).catch((err) => console.error("richmenu unlink failed", err.message));
  await push(target, [{ type: "text", text: "สิทธิ์เจ้าของหอ/ผู้ช่วยของบัญชีนี้ถูกถอนแล้ว" }]).catch((err) =>
    console.error("revoke notice failed", err.message)
  );
  return res.status(200).json({ ok: true, removed: record.role === "viewer" ? "viewer" : "owner" });
}

// An owner mints a code for a co-owner (root only) or a read-only helper.
async function invite(req, res, userId) {
  if (!(await isOwner(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");

  const asked = req.body && req.body.role;
  const role = asked === "viewer" ? "viewer" : "owner";
  if (role === "owner" && !isRoot(userId)) {
    return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอคนแรกเชิญเจ้าของเพิ่มได้ — เชิญผู้ช่วย (ดูอย่างเดียว) ได้");
  }

  const code = newCode(8);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await store.set(`owner-invite:${code}`, { createdBy: userId, role, createdAt: new Date().toISOString(), expiresAt });

  const url = liffUrl(code);
  const qr = url ? qrSvg(url) : null;
  return res.status(200).json({ code, url, qr, role, expiresAt });
}

// Someone opened the QR and redeemed the code.
async function accept(req, res, userId, code) {
  // Without a hand-set first owner there is nobody who could have minted a legitimate code.
  if (!process.env.OWNER_USER_ID) {
    return fail(res, 409, "INVALID_STATE", "ยังไม่ได้ตั้ง OWNER_USER_ID ของหอ");
  }

  if (await limit.blocked("owner", userId)) return limit.tooMany(res);

  const key = `owner-invite:${code}`;
  const found = await store.get(key);
  if (!found) {
    await limit.recordFailure("owner", userId);
    return fail(res, 404, "NOT_FOUND", "รหัสไม่ถูกต้อง");
  }
  const role = found.role === "viewer" ? "viewer" : "owner";
  // A code is only as good as its maker's access: a removed owner's codes die with it, and an owner
  // code minted before only root could mint them is not honoured.
  const makerOk = role === "owner" ? isRoot(found.createdBy) : await isOwner(found.createdBy);
  if (found.usedAt || new Date(found.expiresAt).getTime() < Date.now() || !makerOk) {
    await limit.recordFailure("owner", userId);
    return fail(res, 410, "INVITE_EXPIRED", "รหัสหมดอายุหรือถูกใช้แล้ว — ขอใหม่จากเจ้าของหอ");
  }

  const current = await roleOf(userId);
  // Already an owner, or already the helper this code would make them: nothing to do.
  if (current === "owner" || current === role) return res.status(200).json({ owner: current === "owner", role: current, already: true });

  await store.set(`owner:${userId}`, { addedAt: new Date().toISOString(), addedBy: found.createdBy, role });
  await store.set(key, { ...found, usedAt: new Date().toISOString(), usedBy: userId });

  if (process.env.RICHMENU_OWNER_ID) {
    await linkRichMenu(userId, process.env.RICHMENU_OWNER_ID).catch((err) =>
      console.error("richmenu link failed", err.message)
    );
  }
  // The first owner always hears that someone new got owner screens.
  const name = await displayName(userId);
  await push(process.env.OWNER_USER_ID, [
    {
      type: "text",
      text: `มี${role === "viewer" ? "ผู้ช่วย (ดูอย่างเดียว)" : "เจ้าของหอ"}คนใหม่${name ? ` (${name})` : ""}เข้าระบบด้วยรหัสเชิญแล้ว — ถอนสิทธิ์ได้ที่หน้า "เจ้าของและผู้ช่วย"`,
    },
  ]).catch((err) => console.error("owner notice failed", err.message));
  return res.status(200).json({ owner: role === "owner", role });
}
