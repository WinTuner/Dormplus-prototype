const { test, expect } = require("../fixtures");
const path = require("path");

const SLIP = path.join(__dirname, "..", "fixtures", "slip.png");

test("tenant sees the current bill: amount, period, status", async ({ page, app }) => {
  const period = new Date().toISOString().slice(0, 7);
  await app.seed({ bind: { Utenant201: "201" }, bills: [{ room: "201", period, total: 4450 }] });
  await app.asTenant("Utenant201");

  await expect(page.getByText("ยอดที่ต้องชำระ")).toBeVisible();
  await expect(page.getByText("4,450").first()).toBeVisible();
  await expect(page.getByText("ยังไม่ชำระ")).toBeVisible();
  await expect(page.getByText("ห้อง 201 · รอบบิล")).toBeVisible();
  await expect(page.getByText("ค่าเช่า", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "แนบสลิป" })).toBeVisible();
});

test("tenant attaches a slip: bill goes pending and the owner gets a LINE card", async ({ page, app }) => {
  await app.seed("tenant-unpaid");
  await app.asTenant("Utenant201");

  await page.getByRole("button", { name: "แนบสลิป" }).click();
  const send = page.getByRole("button", { name: "ส่งสลิป" });
  await expect(send).toBeDisabled(); // no photo yet
  await page.locator("#file").setInputFiles(SLIP);
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByText("แจ้งชำระแล้ว — รอเจ้าของหอยืนยัน")).toBeVisible();
  await expect(page.getByText("รอตรวจสอบ").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "ส่งสลิปใหม่" })).toBeVisible();

  const toOwner = await app.pushesTo("Uowner");
  expect(toOwner).toHaveLength(1);
  expect(JSON.stringify(toOwner[0].messages)).toContain("action=confirm");
  const { store } = await app.state("bill:201");
  expect(store["bill:201"].status).toBe("pending");
  expect(store["bill:201"].slipPath).toMatch(/^slips\/201-/);
});

test("tenant with no bill yet can still send an advance slip", async ({ page, app }) => {
  await app.seed({ bind: { Utenant201: "201" } });
  await app.asTenant("Utenant201");
  await expect(page.getByText("ยังไม่มีบิลรอบนี้")).toBeVisible();
  await page.getByRole("button", { name: "โอนก่อน / แนบสลิป" }).click();
  await page.locator("#file").setInputFiles(SLIP);
  await page.getByRole("button", { name: "ส่งสลิป" }).click();
  await expect(page.getByText("ส่งสลิปแล้ว — จะผูกกับบิลรอบถัดไปเมื่อเจ้าของออกบิล")).toBeVisible();
  await expect(page.getByText("ส่งสลิปโอนก่อนแล้ว")).toBeVisible();
});
