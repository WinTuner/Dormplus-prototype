// /api/qr — the room QR that tenants scan, and the redemption of that QR.
// Two halves in one function because Vercel's Hobby plan caps a deployment at 12 functions.
//
//   GET  ?room=203   (owner) -> that room's code + QR (created on first use)
//   POST ?room=203   (owner) -> change tenant: new code, old QR stops working, current tenant unbound
//   POST { code [, confirmMove] } (tenant) -> bind this LINE account to the room; a tenant who
//                    already has another room gets 409 MOVE_CONFIRM_REQUIRED until confirmMove: true
//
// The printed QR binds a room only while nobody is bound to it. Once a tenant is in, a photo of
// the door QR cannot take the room over: the owner has to press "change tenant" first.
const crypto = require("crypto");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");
const { linkRichMenu, push } = require("./_line");
const { ROOMS } = require("./_rooms");
const limit = require("./_limit");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const bindUrl = (code) => (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}?bind=${code}` : null);

const newCode = () => Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

const { qrSvg } = require("./_qr");

async function ensureCode(room, rotate) {
  const key = `room-qr:${room}`;
  const existing = await store.get(key);
  if (existing && !rotate) return existing;

  if (existing?.code) await store.set(`qr-code:${existing.code}`, null); // the old slip stops working
  const entry = { code: newCode(), createdAt: new Date().toISOString() };
  await store.set(key, entry);
  await store.set(`qr-code:${entry.code}`, room);
  return entry;
}

// Forget whoever is bound to the room, in both directions.
async function unbindRoom(room) {
  const tenant = await store.get(`room-user:${room}`);
  if (!tenant) return null;
  await store.set(`room-user:${room}`, null);
  if ((await store.get(`user-room:${tenant}`)) === room) await store.set(`user-room:${tenant}`, null);
  return tenant;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || "").trim();
  const code = String((req.body && req.body.code) || "").trim().toUpperCase();

  if (room) return roomQr(req, res, userId, room);
  if (code) return bind(req, res, userId, code);
  return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room หรือ code" } });
};

async function roomQr(req, res, userId, room) {
  if (!(await isOwner(userId))) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET or POST only" } });
  }
  if (!ROOMS.includes(room)) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบห้อง ${room}` } });
  }

  const changing = req.method === "POST";
  const unbound = changing ? await unbindRoom(room) : null;
  const entry = await ensureCode(room, changing);
  const url = bindUrl(entry.code);
  const qr = url ? qrSvg(url) : null;
  return res.status(200).json({ room, code: entry.code, url, qr, rotated: changing, unbound: !!unbound });
}

async function bind(req, res, userId, code) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }
  if (await limit.blocked("bind", userId)) return limit.tooMany(res);

  const room = await store.get(`qr-code:${code}`);
  if (!room) {
    await limit.recordFailure("bind", userId);
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "QR นี้ใช้ไม่ได้แล้ว — ขอใหม่จากเจ้าของหอ" } });
  }

  const holder = await store.get(`room-user:${room}`);
  if (holder && holder !== userId) {
    // Not a failed code: the code was valid, the room is just occupied. Counting it as a guess would
    // lock a tenant out of their own valid QR for an hour after scanning a stale door sticker.
    return res.status(409).json({
      error: { code: "ROOM_TAKEN", message: `ห้อง ${room} มีผู้เช่าผูกไว้แล้ว — ให้เจ้าของหอกด “เปลี่ยนผู้เช่า” ก่อน` },
    });
  }

  // Moving from another room: that room must stop sending this person its bills. A `?bind=` link is
  // easy to send someone, so a tenant who already has a room is asked first instead of being moved
  // by whoever sent them the link: the page shows the current room and retries with confirmMove.
  const previous = await store.get(`user-room:${userId}`);
  if (previous && previous !== room && !(req.body && req.body.confirmMove === true)) {
    return res.status(409).json({
      error: {
        code: "MOVE_CONFIRM_REQUIRED",
        message: `บัญชีนี้ผูกกับห้อง ${previous} อยู่ — ยืนยันก่อนย้ายไปห้อง ${room}`,
        current: previous,
        room,
      },
    });
  }
  if (previous && previous !== room && (await store.get(`room-user:${previous}`)) === userId) {
    await store.set(`room-user:${previous}`, null);
  }
  await store.set(`user-room:${userId}`, room);
  await store.set(`room-user:${room}`, userId);

  if (process.env.RICHMENU_TENANT_ID) {
    await linkRichMenu(userId, process.env.RICHMENU_TENANT_ID).catch((err) =>
      console.error("richmenu link failed", err.message)
    );
  }
  // The owner hears about every binding that changes something, so a wrong one is noticed the same
  // day. Re-scanning the QR of the room you already live in changes nothing and sends no notice.
  const moved = previous && previous !== room;
  if ((!holder || moved) && process.env.OWNER_USER_ID) {
    const text = moved
      ? `มีผู้เช่าย้ายจากห้อง ${previous} มาห้อง ${room} แล้ว`
      : `มีผู้เช่าผูก LINE กับห้อง ${room} แล้ว`;
    await push(process.env.OWNER_USER_ID, [{ type: "text", text }]).catch((err) =>
      console.error("owner notice failed", err.message)
    );
  }
  return res.status(200).json({ ok: true, room, previous: previous || null });
}
