// Shared rich-menu definitions, so setup and image replacement cannot drift apart.
// Both menus are 2500x1686 (LINE "large" size).

const cell = (x, y, w, h) => ({ x, y, width: w, height: h });
const liff = (liffId, tab) => `https://liff.line.me/${liffId}?tab=${tab}`;

// Tenant menu: 2x2 picture. The first three cells open the bill page (where the slip form is),
// the last one is the dorm's contact entry.
function tenantMenu(liffId) {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "ผู้เช่า",
    chatBarText: "เมนูผู้เช่า",
    areas: [
      { bounds: cell(0, 0, 1250, 843), action: { type: "uri", uri: liff(liffId, "bill") } },
      { bounds: cell(1250, 0, 1250, 843), action: { type: "uri", uri: liff(liffId, "bill") } },
      { bounds: cell(0, 843, 1250, 843), action: { type: "uri", uri: liff(liffId, "bill") } },
      { bounds: cell(1250, 843, 1250, 843), action: { type: "message", text: "ติดต่อหอพัก" } },
    ],
  };
}

// Owner menu: 3x2 picture, in the order the LIFF page understands.
function ownerMenu(liffId) {
  const w = 833;
  const tabs = ["meter", "bill", "slips", "unpaid", "report", "rooms"];
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "เจ้าของหอ",
    chatBarText: "เมนูเจ้าของหอ",
    areas: tabs.map((tab, i) => ({
      bounds: cell((i % 3) * w, Math.floor(i / 3) * 843, i % 3 === 2 ? 2500 - 2 * w : w, 843),
      action: { type: "uri", uri: liff(liffId, tab) },
    })),
  };
}

module.exports = { tenantMenu, ownerMenu };
