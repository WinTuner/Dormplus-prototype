const { test: base, expect } = require("@playwright/test");

// Stand-in for https://static.line-scdn.net/liff/edge/2/sdk.js. The "ID token" is just the LINE
// userId the test picked: the fake LINE verify endpoint in server.js accepts any token starting
// with "U" as that user. Every liff.* method bill.html calls is here (init, isLoggedIn, login,
// getIDToken, getFriendship, requestFriendship).
const LIFF_STUB = `
(() => {
  const user = () => window.__LIFF_USER__ || "Uowner";
  window.liff = {
    init: async () => {},
    isLoggedIn: () => true,
    isInClient: () => true,
    login: () => {},
    getIDToken: () => user(),
    getProfile: async () => ({ userId: user(), displayName: "name-" + user() }),
    getFriendship: async () => ({ friendFlag: true }),
    requestFriendship: async () => {},
    closeWindow: () => {},
    getContext: () => ({ type: "utou", userId: user() }),
  };
})();
`;

const post = (request, path, data) => request.post(path, { data });

const test = base.extend({
  // Fail any test that logs a console error or throws in the page. Nothing is excluded: the page
  // is fully offline (LIFF SDK, fonts and favicon are all served locally), so any error is real.
  // One known-benign exception: GET /api/bill?room=... answers 404 BY DESIGN for a room that has no
  // bill yet (the page reads that as "ยังไม่มีบิลรอบนี้"), and Chromium logs every failed fetch as
  // a "Failed to load resource" console error. Only that exact 404 is ignored.
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const noBill = /Failed to load resource.*404/.test(m.text()) && /\/api\/bill\?room=\d+$/.test(m.location().url);
      if (!noBill) errors.push(`console.error: ${m.text()} (${m.location().url})`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    expect(errors, "page console errors / uncaught exceptions").toEqual([]);
  }, { auto: true }],

  // Offline page: LIFF SDK stub, empty webfont CSS.
  page: async ({ page }, use) => {
    await page.route("https://static.line-scdn.net/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: LIFF_STUB }));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await use(page);
  },

  // Backend control. Auto: every test starts from an empty dorm.
  app: [async ({ page, request }, use) => {
    await post(request, "/__test/reset", {});
    const app = {
      seed: async (s) => {
        const r = await post(request, "/__test/seed", typeof s === "string" ? { scenario: s } : s);
        expect(r.ok(), await r.text()).toBeTruthy();
      },
      slipok: (body) => post(request, "/__test/slipok", body),
      // The owner taps "ยืนยันการชำระ" on the LINE card.
      confirm: async (room, period) => {
        const r = await post(request, "/__test/confirm", { room, period });
        expect(r.ok()).toBeTruthy();
      },
      state: async (...keys) => {
        const q = keys.map((k) => `key=${encodeURIComponent(k)}`).join("&");
        return (await request.get(`/__test/state?${q}`)).json();
      },
      // Messages LINE accepted for one user, flattened to a JSON string for easy matching.
      pushesTo: async (user) => (await app.state()).pushed.filter((p) => p.to === user),
      // Open the LIFF page as this LINE user.
      open: async (userId, query = "") => {
        await page.addInitScript((u) => { window.__LIFF_USER__ = u; }, userId);
        await page.goto(`/${query}`);
      },
      asOwner: (query) => app.open("Uowner", query),
      asTenant: (userId, query) => app.open(userId, query),
    };
    await use(app);
  }, { auto: true }],
});

module.exports = { test, expect };
