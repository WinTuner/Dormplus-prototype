// One-off setup: create the owner and tenant rich menus from the repo's PNGs.
//
//   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... node scripts/setup-richmenu.js [owner.png] [tenant.png]
//
// Prints the two menu ids. Put them in Vercel as RICHMENU_OWNER_ID / RICHMENU_TENANT_ID so the
// app can link the right menu per user (see api/_line.js linkRichMenu).
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID;
const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot"; // image upload lives on the data host

const ownerImage = process.argv[2] || path.join(__dirname, "../../docs/richmenu-owner.png");
const tenantImage = process.argv[3] || path.join(__dirname, "../../docs/richmenu-tenant.png");

const call = async (base, method, url, body, contentType) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

const json = (method, url, body) =>
  call(API, method, url, body === undefined ? undefined : JSON.stringify(body), body === undefined ? undefined : "application/json");

const cell = (x, y, w, h) => ({ x, y, width: w, height: h });
const liff = (tab) => `https://liff.line.me/${LIFF_ID}?tab=${tab}`;

// Tenant menu: the 2x2 image (2500x1686). The first three cells open the bill page (where the
// slip form lives), the last one is the dorm's contact entry.
function tenantMenu() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "ผู้เช่า",
    chatBarText: "เมนูผู้เช่า",
    areas: [
      { bounds: cell(0, 0, 1250, 843), action: { type: "uri", uri: liff("bill") } },
      { bounds: cell(1250, 0, 1250, 843), action: { type: "uri", uri: liff("bill") } },
      { bounds: cell(0, 843, 1250, 843), action: { type: "uri", uri: liff("bill") } },
      { bounds: cell(1250, 843, 1250, 843), action: { type: "message", text: "ติดต่อหอพัก" } },
    ],
  };
}

// Owner menu: the 3x2 image (2500x1686). Order follows the tabs the LIFF page understands.
function ownerMenu() {
  const w = 833;
  const tabs = ["meter", "bill", "slips", "unpaid", "report", "rooms"];
  const areas = tabs.map((tab, i) => ({
    bounds: cell((i % 3) * w, Math.floor(i / 3) * 843, i % 3 === 2 ? 2500 - 2 * w : w, 843),
    action: { type: "uri", uri: liff(tab) },
  }));
  return { size: { width: 2500, height: 1686 }, selected: true, name: "เจ้าของหอ", chatBarText: "เมนูเจ้าของหอ", areas };
}

async function createWithImage(menu, imagePath) {
  const created = await json("POST", "/richmenu", menu);
  await call(API_DATA, "POST", `/richmenu/${created.richMenuId}/content`, fs.readFileSync(imagePath), "image/png");
  return created.richMenuId;
}

(async () => {
  if (!TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");
  if (!LIFF_ID) throw new Error("LIFF_ID is required");
  for (const p of [ownerImage, tenantImage]) {
    if (!fs.existsSync(p)) throw new Error(`image not found: ${p}`);
  }

  // Re-runs should not pile up menus: drop whatever is there first.
  const existing = await json("GET", "/richmenu/list");
  for (const m of existing.richmenus || []) await json("DELETE", `/richmenu/${m.richMenuId}`);

  const ownerId = await createWithImage(ownerMenu(), ownerImage);
  const tenantId = await createWithImage(tenantMenu(), tenantImage);
  await json("POST", `/user/all/richmenu/${tenantId}`);

  console.log("RICHMENU_OWNER_ID=" + ownerId);
  console.log("RICHMENU_TENANT_ID=" + tenantId);
  console.log("default menu = tenant menu");
})();
