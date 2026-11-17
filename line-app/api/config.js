// GET /api/config — public: the LIFF id the page needs to init the SDK.
//
// The answer is the same for everyone and changes only when LIFF_ID does, so it is cacheable. This
// is the page's first request: without caching it costs a function round trip (measured ~0.75s cold)
// before liff.init() can even start.
//
// TEMPORARY: ?probe=r2 writes one key through the live adapter so the bucket can be checked from
// outside. Removed as soon as it has answered once.
const store = require("./_store");

module.exports = async (req, res) => {
  if (req.query.probe === "r2") {
    const key = `_probe-${Date.now()}`;
    res.setHeader("Cache-Control", "no-store");
    try {
      await store.set(key, { ok: true });
      const back = await store.get(key);
      return res.status(200).json({ storage: process.env.R2_BUCKET ? "r2" : "blob", key, wrote: back?.ok === true });
    } catch (err) {
      return res.status(500).json({ storage: process.env.R2_BUCKET ? "r2" : "blob", key, error: err.message });
    }
  }
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({ liffId: process.env.LIFF_ID || null });
};
