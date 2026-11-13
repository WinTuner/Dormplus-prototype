// GET /api/me — who am I, which room am I bound to, and what may I do.
//   role:  "owner" | "viewer" | null   (viewer = read-only helper; null = tenant or unknown)
//   owner: role === "owner"            (kept for older pages)
//   root:  the dorm's first owner (OWNER_USER_ID): the only one who can remove other owners
const store = require("./_store");
const { requireUser, roleOf, isRoot } = require("./_auth");
const { linkRichMenu } = require("./_line");

// The tenant menu is the OA default, so only the owner needs a switch. Doing it here means the
// hand-set first owner (OWNER_USER_ID) gets the meter menu the first time they open LIFF, not
// only people who arrived through an owner QR.
async function ensureOwnerMenu(userId) {
  const menu = process.env.RICHMENU_OWNER_ID;
  if (!menu) return;
  if ((await store.get(`menu:${userId}`)) === menu) return;
  try {
    await linkRichMenu(userId, menu);
    await store.set(`menu:${userId}`, menu);
  } catch (err) {
    console.error("richmenu link failed", err.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;

  const [role, room] = await Promise.all([roleOf(userId), store.get(`user-room:${userId}`)]);
  const owner = role === "owner";
  if (owner) await ensureOwnerMenu(userId);

  return res.status(200).json({ userId, owner, role, root: isRoot(userId), room: room || null });
};
