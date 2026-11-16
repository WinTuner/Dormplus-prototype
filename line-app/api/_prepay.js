// The advance slip (`prepay:<room>`): a transfer the tenant, or the owner, recorded before the
// month's bill existed. Two writers attach it to the bill once it is there, and they race:
// /api/run (after it writes the bill) and /api/slip (after it writes the prepay). Both go through
// here so they build identical content and send the same owner card (deduped by its retry key).
const store = require("./_store");
const { saveBills, prepaidCopy, confirmKey } = require("./_bills");
const { push, confirmBubble } = require("./_line");

// May this prepay go on a bill of the room's current tenant? The tenant's own slip only while they
// are still the tenant (a stale record from a previous tenant must not pay the new one's bill).
// A slip the OWNER recorded (`byStaff`) is about the room, not a person: always usable.
const usable = (prepay, tenant) => !!prepay && (!prepay.by || !!prepay.byStaff || prepay.by === tenant);

// Clear only the record this bill consumed. A slip that arrived while the bill was being written
// has a different slipAt and must survive for the next bill (Blob has no compare-and-set).
async function clearPrepay(room, prepay) {
  const still = await store.get(`prepay:${room}`);
  if (still && still.slipAt === prepay.slipAt) await store.set(`prepay:${room}`, null);
}

// The owner's confirm card. A push error never fails the caller: the bill is already saved.
async function notifyOwner(bill) {
  const ownerId = process.env.OWNER_USER_ID;
  if (!ownerId) return;
  await push(ownerId, [confirmBubble(bill)], { retryKey: confirmKey(bill) }).catch((err) =>
    console.error("owner push failed", bill.room, err.message)
  );
}

// prepaidCopy -> save -> clear the consumed prepay -> owner card. `latest` is the caller's read of
// `bill:<room>` (saveBills does not read it again). `notify: false` lets /api/run send the card
// together with the tenant's bill push instead of before it.
async function attachPrepay({ bill, prepay, latest, notify = true }) {
  const next = prepaidCopy(bill, prepay);
  await saveBills([next], { latest });
  await clearPrepay(bill.room, prepay);
  if (notify) await notifyOwner(next);
  return next;
}

module.exports = { usable, clearPrepay, notifyOwner, attachPrepay };
