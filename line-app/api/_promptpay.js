// PromptPay QR payload (EMVCo Merchant-Presented Mode, Thai profile).
//
// The tenant scans this with any Thai banking app; the amount is fixed by the bill. Getting one byte
// wrong produces a QR that no app will read, so the structure is asserted in smoke-handlers.js
// (tags, lengths, and the CRC16 of "123456789" = 0x29B1, the standard check value).
const APP_ID = "A000000677010111"; // PromptPay on the Thai QR network

function tlv(tag, value) {
  const body = String(value);
  return `${tag}${String(body.length).padStart(2, "0")}${body}`;
}

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, over everything before the checksum.
function crc16(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Accepts 0812345678 / 66812345678 / 0066812345678, a 13-digit national ID, or a 15-digit e-wallet.
// Returns the value PromptPay expects in tag 29, or null when the input cannot be one of them.
function normalizeId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return { tag: "01", value: `0066${digits.slice(1)}` };
  if (digits.length === 11 && digits.startsWith("66")) return { tag: "01", value: `00${digits}` };
  if (digits.length === 13 && digits.startsWith("0066")) return { tag: "01", value: digits };
  if (digits.length === 13) return { tag: "02", value: digits };
  if (digits.length === 15) return { tag: "03", value: digits };
  return null;
}

// The payload string for one bill, or null when no usable PromptPay id is configured.
function payloadFor(id, amount) {
  const account = normalizeId(id);
  const baht = Number(amount);
  if (!account || !Number.isFinite(baht) || baht <= 0) return null;

  const merchant = tlv("00", APP_ID) + tlv(account.tag, account.value);
  const body =
    tlv("00", "01") + // payload format indicator
    tlv("01", "12") + // dynamic: this QR carries an amount
    tlv("29", merchant) +
    tlv("53", "764") + // THB
    tlv("54", baht.toFixed(2)) +
    tlv("58", "TH");
  const withChecksumTag = `${body}6304`;
  return `${withChecksumTag}${crc16(withChecksumTag)}`;
}

module.exports = { payloadFor, normalizeId, crc16 };
