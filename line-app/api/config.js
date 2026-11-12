// GET /api/config — public: the LIFF id the page needs to init the SDK.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ liffId: process.env.LIFF_ID || null });
};
