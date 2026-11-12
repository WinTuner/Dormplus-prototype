// Replace the picture of a rich menu without making anyone re-link.
//
//   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... \
//   RICHMENU_OWNER_ID=richmenu-... RICHMENU_TENANT_ID=richmenu-... \
//   node scripts/set-richmenu-image.js owner new-owner.png
//   node scripts/set-richmenu-image.js tenant new-tenant.png
//
// LINE has no "replace image" call: a rich menu's picture is fixed once uploaded. So this builds a
// NEW menu with the new picture, moves everyone who had the old one onto it (batch link), keeps it
// as the default if the old one was, then deletes the old menu. The ids change, so the script
// prints the new value to put in Vercel.
const fs = require("fs");
const { tenantMenu, ownerMenu } = require("./_richmenu-defs");

const [, , which, imagePath] = process.argv;
const ENV = { owner: "RICHMENU_OWNER_ID", tenant: "RICHMENU_TENANT_ID" };
const BUILD = { owner: ownerMenu, tenant: tenantMenu };
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID;
const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";

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

function pngSize(buf) {
  const isPng = buf.length > 24 && buf.toString("ascii", 12, 16) === "IHDR";
  return isPng ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
}

(async () => {
  if (!ENV[which]) throw new Error("usage: node scripts/set-richmenu-image.js <owner|tenant> <image.png>");
  if (!TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");
  if (!LIFF_ID) throw new Error("LIFF_ID is required");
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`);

  const bytes = fs.readFileSync(imagePath);
  const size = pngSize(bytes);
  if (size && (size.width !== 2500 || size.height !== 1686)) {
    throw new Error(`wrong size ${size.width}x${size.height} — LINE needs exactly 2500x1686`);
  }
  if (bytes.length > 1024 * 1024) throw new Error(`image is ${(bytes.length / 1024 / 1024).toFixed(1)}MB — the limit is 1MB`);

  const oldId = process.env[ENV[which]] || "";
  const isDefault = (await json("GET", "/user/all/richmenu").catch(() => ({}))).richMenuId === oldId;

  const created = await json("POST", "/richmenu", BUILD[which](LIFF_ID));
  await call(API_DATA, "POST", `/richmenu/${created.richMenuId}/content`, bytes, "image/png");

  if (oldId) {
    // Move everyone linked to the old menu onto the new one (500 users per request).
    await json("POST", "/richmenu/batch", { operations: [{ type: "link", from: oldId, to: created.richMenuId }] });
    if (isDefault) await json("POST", `/user/all/richmenu/${created.richMenuId}`);
    await json("DELETE", `/richmenu/${oldId}`).catch(() => {});
  } else if (which === "tenant") {
    await json("POST", `/user/all/richmenu/${created.richMenuId}`);
  }

  console.log(`${ENV[which]}=${created.richMenuId}`);
  console.log(`${isDefault ? "default moved to the new menu" : "kept the existing default"} · old menu deleted`);
})();
