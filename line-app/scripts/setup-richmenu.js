// Create both rich menus from PNGs, publish the tenant one as default.
//
//   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... node scripts/setup-richmenu.js [owner.png] [tenant.png]
//
// Prints the ids for RICHMENU_OWNER_ID / RICHMENU_TENANT_ID. To change the picture later use
// scripts/set-richmenu-image.js, which swaps menus without making users re-link.
const fs = require("fs");
const path = require("path");
const { tenantMenu, ownerMenu } = require("./_richmenu-defs");

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

  // Re-runs must not pile up menus.
  const existing = await json("GET", "/richmenu/list");
  for (const m of existing.richmenus || []) await json("DELETE", `/richmenu/${m.richMenuId}`);

  const ownerId = await createWithImage(ownerMenu(LIFF_ID), ownerImage);
  const tenantId = await createWithImage(tenantMenu(LIFF_ID), tenantImage);
  await json("POST", `/user/all/richmenu/${tenantId}`);

  console.log("RICHMENU_OWNER_ID=" + ownerId);
  console.log("RICHMENU_TENANT_ID=" + tenantId);
  console.log("default menu = tenant menu");
})();
