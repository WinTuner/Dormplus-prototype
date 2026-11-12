// Shared rich-menu definitions, so setup and image replacement cannot drift apart.
// Sizes: owner = LINE "large" (2500x1686, 3x2), tenant = LINE "compact" (2500x843, 1x3).

const cell = (x, y, w, h) => ({ x, y, width: w, height: h });
const liff = (liffId, tab) => `https://liff.line.me/${liffId}?tab=${tab}`;

// Tenant menu: compact, one row of three. All three cells land on the bill page, which is where
// the amount, the slip form and the paid state live (there is no receipt history yet).
function tenantMenu(liffId) {
  const w = 833;
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "ผู้เช่า",
    chatBarText: "เมนูผู้เช่า",
    areas: [0, 1, 2].map((i) => ({
      bounds: cell(i * w, 0, i === 2 ? 2500 - 2 * w : w, 843),
      action: { type: "uri", uri: liff(liffId, "bill") },
    })),
  };
}

// Owner menu: large, 3x2, in the order the LIFF page understands.
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
