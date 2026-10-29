// Struk PDF (lebar 80mm, gaya struk belanja) - butuh: npm i jspdf
const STORE = "MEMAYU BUYUT TRUSMI";
const POWERED = "Powered by KasirKu";

const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const methodLabel = (m) =>
  m === "qris" ? "QRIS" : m === "transfer" ? "Transfer" : m === "ewallet" ? "E-Wallet" : "Tunai";
// font bawaan PDF tidak mendukung emoji / karakter khusus
const clean = (s) => String(s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "").trim();

export async function downloadReceipt(tx) {
  const { jsPDF } = await import("jspdf");

  const W = 80;          // lebar kertas (mm)
  const M = 5;           // margin
  const CW = W - M * 2;  // lebar isi
  const FS = 9;          // ukuran font normal

  const inc = tx.type === "income";
  const items = tx.items || [];
  const exItems = tx.expenseItems || [];
  const pk = tx.packaging || {};

  // ---------- susun baris struk ----------
  const rows = [];
  const center = (t, o = {}) => rows.push({ k: "c", t: clean(t), ...o });
  const lr = (l, r, o = {}) => rows.push({ k: "lr", l: clean(l), r: clean(r), ...o });
  const left = (t, o = {}) => rows.push({ k: "l", t: clean(t), ...o });
  const dash = () => rows.push({ k: "d" });
  const gap = (h = 2) => rows.push({ k: "g", h });

  center(STORE, { bold: true, size: 12 });
  center(inc ? "STRUK PEMBELIAN" : "BUKTI PENGELUARAN", { size: 8 });
  gap(1);
  dash();

  const dt = new Date(tx.createdAt).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  lr("Tanggal", dt);
  lr("No", "#" + String(tx._id || "").slice(-6).toUpperCase());
  lr("Metode", methodLabel(tx.method));
  dash();

  if (inc) {
    let itemsSum = 0;
    for (const i of items) {
      const line = (i.price || 0) * i.qty;
      itemsSum += line;
      left(i.name, { bold: true });
      lr(`${i.qty} x ${rp(i.price)}`, rp(line));
    }
    const adj = itemsSum - tx.total;
    if (adj > 0) {
      dash();
      lr("Subtotal", rp(itemsSum));
      lr("Potongan promo", "-" + rp(adj));
    }
    dash();
    lr("TOTAL", rp(tx.total), { bold: true, size: 11 });
    if (tx.method === "cash") {
      lr("Tunai", rp(tx.cashReceived));
      lr("Kembali", rp(tx.change));
    }
    if (pk.plastic > 0 || pk.cup > 0) {
      dash();
      if (pk.plastic > 0) lr("Plastik", String(pk.plastic));
      if (pk.cup > 0) lr("Cup", String(pk.cup));
    }
  } else {
    left(tx.description || "-", { bold: true });
    if (exItems.length) {
      gap(1);
      for (const c of exItems) {
        left(c.name);
        lr(`${c.qty} x ${rp(c.price)}`, rp(c.qty * c.price));
      }
    }
    if (items.length) {
      gap(1);
      left("Stok ditambah:");
      for (const i of items) lr(i.name, "+" + i.qty);
    }
    dash();
    lr("TOTAL", rp(tx.total), { bold: true, size: 11 });
  }

  if (tx.note) {
    dash();
    left("Catatan: " + tx.note);
  }

  gap(1);
  dash();
  gap(1);
  if (inc) center("Terima kasih atas kunjungan Anda");
  center(POWERED, { size: 8 });

  // ---------- gambar (dipakai 2x: ukur tinggi, lalu cetak) ----------
  const render = (doc) => {
    let y = M + 4;
    for (const r of rows) {
      if (r.k === "g") { y += r.h; continue; }
      if (r.k === "d") {
        doc.setLineDashPattern([0.6, 0.6], 0);
        doc.setLineWidth(0.2);
        doc.line(M, y - 2, W - M, y - 2);
        doc.setLineDashPattern([], 0);
        y += 1.5;
        continue;
      }
      const size = r.size || FS;
      const lh = size * 0.47;
      doc.setFont("courier", r.bold ? "bold" : "normal");
      doc.setFontSize(size);

      if (r.k === "c") {
        for (const ln of doc.splitTextToSize(r.t, CW)) {
          doc.text(ln, W / 2, y, { align: "center" });
          y += lh;
        }
      } else if (r.k === "l") {
        for (const ln of doc.splitTextToSize(r.t, CW)) {
          doc.text(ln, M, y);
          y += lh;
        }
      } else if (r.k === "lr") {
        const rw = doc.getTextWidth(r.r);
        const lines = doc.splitTextToSize(r.l, Math.max(10, CW - rw - 2));
        doc.text(lines[0] || "", M, y);
        doc.text(r.r, W - M, y, { align: "right" });
        y += lh;
        for (const ln of lines.slice(1)) {
          doc.text(ln, M, y);
          y += lh;
        }
      }
    }
    return y;
  };

  const measure = new jsPDF({ unit: "mm", format: [W, 400] });
  const endY = render(measure);
  const H = Math.max(100, Math.ceil(endY + M)); // min 100 agar orientasi tetap portrait

  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "portrait" });
  render(doc);

  const d = new Date(tx.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  doc.save(`struk-${stamp}-${String(tx._id || "").slice(-6)}.pdf`);
}