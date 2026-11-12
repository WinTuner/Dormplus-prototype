// GET /api/me — who am I, which room am I bound to, am I the owner.
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;

  return res.status(200).json({
    userId,
    owner: isOwner(userId),
    room: (await store.get(`user-room:${userId}`)) || null,
  });
};
