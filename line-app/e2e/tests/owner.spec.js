const { test, expect } = require("../fixtures");

const thisPeriod = () => new Date().toISOString().slice(0, 7);
// Previous calendar month as YYYY-MM (the bills of an earlier round).
const lastPeriod = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
// window.prompt / confirm are how the page asks for a reason and for the final "are you sure".
const answerDialogs = (page, reason) =>
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(reason) : d.accept()));

test("owner home shows the dorm and its room list", async ({ page, app }) => {
  await app.seed("owner-dorm");
  await app.asOwner();

  await expect(page.getByText("จดมิเตอร์รอบนี้")).toBeVisible();
  await expect(page.getByText("รอตรวจสลิป", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^จดมิเตอร์ต่อ/ }).click();

  await expect(page.getByRole("button", { name: "ทั้งหมด 12" })).toBeVisible();
  for (const room of ["201", "202", "203", "212"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^ห้อง ${room}`) })).toBeVisible();
  }
  // the seeded bills belong to the current month, so the round being prepared is the next one: no meter is read yet
  await expect(page.getByRole("button", { name: "ยังไม่จด 12" })).toBeVisible();
});

test("owner confirms a pending slip: bill paid, tenant gets the receipt", async ({ page, app }) => {
  await app.seed({ bind: { Utenant202: "202" }, bills: [{ room: "202", status: "pending" }] });
  await app.asOwner("?tab=slips");
  await expect(page.getByText("ห้อง 202", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "สลิป" })).toBeVisible();

  // The confirm button lives on the LINE card, so the test taps it the way LINE would.
  await app.confirm("202", thisPeriod());

  await page.reload();
  await expect(page.getByText("ไม่มีสลิปที่รอตรวจ")).toBeVisible();
  const { store } = await app.state("bill:202");
  expect(store["bill:202"].status).toBe("paid");

  const toTenant = await app.pushesTo("Utenant202");
  expect(toTenant).toHaveLength(1);
  expect(JSON.stringify(toTenant[0].messages)).toContain("R" + thisPeriod().replace("-", "") + "-202");

  // and the tenant's own page now says paid, with the receipt
  await app.asTenant("Utenant202");
  await expect(page.getByText("ชำระแล้ว", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "ดูใบเสร็จ" })).toBeVisible();
});

test("owner rejects a pending slip: bill goes back to unpaid", async ({ page, app }) => {
  await app.seed({ bind: { Utenant202: "202" }, bills: [{ room: "202", status: "pending" }] });
  answerDialogs(page, "สลิปไม่ชัด");
  await app.asOwner("?tab=slips");

  await page.getByRole("button", { name: "สลิปไม่ถูกต้อง (ตีกลับ)" }).click();

  await expect(page.getByText("ตีกลับสลิปห้อง 202 แล้ว — แจ้งผู้เช่าให้แนบใหม่")).toBeVisible();
  await expect(page.getByText("ไม่มีสลิปที่รอตรวจ")).toBeVisible();
  const { store } = await app.state("bill:202");
  expect(store["bill:202"].status).toBe("unpaid");
  expect((await app.pushesTo("Utenant202")).length).toBeGreaterThan(0); // the tenant is told
});

test("owner overdue list shows the room that is late", async ({ page, app }) => {
  await app.seed({
    bills: [
      { room: "204", period: lastPeriod(), status: "unpaid", due: "-20d", total: 4450 },
      { room: "205", status: "unpaid", due: "+10d" }, // not late yet
    ],
  });
  await app.asOwner("?tab=unpaid");

  const card = page.locator(".roomcard", { hasText: "ห้อง 204" });
  await expect(card).toContainText("ค้าง 1 งวด · รวม 4,450 บาท · เลย 20 วัน");
  await expect(page.locator(".roomcard", { hasText: "ห้อง 205" })).toHaveCount(0);
  await expect(page.getByText("ยังไม่ถึงกำหนดอีก 1 ห้อง (205)")).toBeVisible();
});

test("owner income card sums what was paid this month", async ({ page, app }) => {
  await app.seed({
    bills: [
      { room: "203", status: "paid", total: 4450 },
      { room: "204", status: "paid", total: 5000 },
      { room: "205", status: "unpaid" }, // not income
    ],
  });
  await app.asOwner("?tab=report");

  const card = page.locator("#incomeCard");
  await expect(card).toContainText("รับเงินเดือนนี้");
  await expect(card).toContainText("9,450 บาท");
  await expect(card).toContainText("2 รายการ");
});

test("owner refund: a cancelled paid bill shows up and marking it refunded clears it", async ({ page, app }) => {
  await app.seed({ voided: [{ room: "202", refundDue: 4450, voidReason: "ผู้เช่าย้ายออก", receiptNo: "R-void-202" }] });
  answerDialogs(page);
  await app.asOwner();

  await expect(page.getByText("ต้องคืนเงินผู้เช่า 1 รายการ · รวม 4,450 บาท")).toBeVisible();
  await expect(page.getByRole("button", { name: /^ห้อง 202 .*ยกเลิกบิล · 4,450 บาท/ })).toBeVisible();
  await page.getByRole("button", { name: "คืนเงินแล้ว" }).click();

  await expect(page.getByText("บันทึกว่าคืนเงินห้อง 202 แล้ว")).toBeVisible();
  await expect(page.getByText(/ต้องคืนเงินผู้เช่า/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("รอบบิล")).toBeVisible(); // home is back...
  await expect(page.getByText(/ต้องคืนเงินผู้เช่า/)).toHaveCount(0); // ...and the refund stays cleared
});

test("owner refund: an overpaid bill shows up and marking it refunded clears it", async ({ page, app }) => {
  await app.seed({ overpaid: [{ room: "203", total: 4450, refundDue: 550 }] });
  answerDialogs(page);
  await app.asOwner();

  await expect(page.getByText("ต้องคืนเงินผู้เช่า 1 รายการ · รวม 550 บาท")).toBeVisible();
  await expect(page.getByRole("button", { name: /^ห้อง 203 .*โอนเกิน · 550 บาท/ })).toBeVisible();
  await page.getByRole("button", { name: "คืนเงินแล้ว" }).click();

  await expect(page.getByText("บันทึกว่าคืนเงินห้อง 203 แล้ว")).toBeVisible();
  await expect(page.getByText(/ต้องคืนเงินผู้เช่า/)).toHaveCount(0);
  const { store } = await app.state("bill:203");
  expect(store["bill:203"].refundedAt).toBeTruthy();
});

test("owner settings: auto-confirm checkbox saves and survives a reload", async ({ page, app }) => {
  await app.asOwner();
  await page.getByRole("button", { name: /^ตั้งค่าหอ/ }).click();

  const auto = page.getByRole("checkbox", { name: "ปิดบิลอัตโนมัติเมื่อสลิปตรวจผ่าน" });
  await expect(auto).not.toBeChecked();
  await auto.check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการตั้งค่าหอแล้ว")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /^ตั้งค่าหอ/ }).click();
  await expect(page.getByRole("checkbox", { name: "ปิดบิลอัตโนมัติเมื่อสลิปตรวจผ่าน" })).toBeChecked();
  const { store } = await app.state("dorm");
  expect(store.dorm.autoConfirm).toBe(true);
});
