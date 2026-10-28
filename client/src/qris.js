// Ubah QRIS statis (string hasil scan QR toko) menjadi QRIS dinamis dengan nominal.
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
    c &= 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}

export function dynamicQris(staticStr, amount) {
  const q = staticStr.trim().slice(0, -4).replace("010211", "010212");
  const [a, b] = q.split("5802ID");
  const amt = String(Math.round(amount));
  const out = a + "54" + String(amt.length).padStart(2, "0") + amt + "5802ID" + b;
  return out + crc16(out);
}
