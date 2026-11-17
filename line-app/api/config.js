// GET /api/config — public: the LIFF id the page needs to init the SDK.
//
// The answer is the same for everyone and changes only when LIFF_ID does, so it is cacheable. This
// is the page's first request: without caching it costs a function round trip (measured ~0.75s cold)
// before liff.init() can even start.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({ liffId: process.env.LIFF_ID || null });
};
