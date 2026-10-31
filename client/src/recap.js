// import { jsPDF } from "jspdf";

// const W = 80; // lebar kertas struk (mm)
// const M = 5;  // margin kiri/kanan
// const R = W - M;

// const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

// export function downloadRecapPdf({ key, lang, sales, exps, income, expense }) {
//   const en = lang === "en";
//   const tl = (id, e) => (en ? e : id);
//   const loc = en ? "en-US" : "id-ID";
//   const mLabel = (m) => (m === "transfer" ? "Transfer" : m === "ewallet" ? "E-wallet" : tl("Tunai", "Cash"));
//   const time = (d) => new Date(d).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
//   const dateLong = new Date(key + "T00:00:00").toLocaleDateString(loc, {
//     weekday: "long", day: "numeric", month: "long", year: "numeric",
//   });

//   // total per metode bayar & produk terjual
//   const byMethod = { cash: 0, transfer: 0, ewallet: 0 };
//   sales.forEach((x) => { byMethod[x.method in byMethod ? x.method : "cash"] += x.total; });
//   const sold = {};
//   sales.forEach((x) => (x.items || []).forEach((i) => { sold[i.name] = (sold[i.name] || 0) + i.qty; }));
//   const soldList = Object.entries(sold).sort((a, b) => b[1] - a[1]);

//   const render = (doc) => {
//     let y = 9;
//     const lh = (size) => size * 0.45;
//     const font = (size, bold = false, gray = false) => {
//       doc.setFont("helvetica", bold ? "bold" : "normal");
//       doc.setFontSize(size);
//       doc.setTextColor(gray ? 110 : 0);
//     };
//     const center = (txt, size = 8, bold = false, gray = false) => {
//       font(size, bold, gray);
//       doc.text(txt, W / 2, y, { align: "center" });
//       y += lh(size);
//     };
//     const row = (left, right = "", { size = 8, bold = false, gray = false } = {}) => {
//       font(size, bold, gray);
//       const rw = right ? doc.getTextWidth(right) + 3 : 0;
//       const lines = doc.splitTextToSize(String(left), R - M - rw);
//       lines.forEach((l, i) => {
//         doc.text(l, M, y);
//         if (i === 0 && right) doc.text(right, R, y, { align: "right" });
//         y += lh(size);
//       });
//     };
//     const line = () => {
//       y += 1;
//       doc.setDrawColor(150);
//       doc.setLineDashPattern([1, 1], 0);
//       doc.line(M, y, R, y);
//       doc.setLineDashPattern([], 0);
//       y += 3.5;
//     };
//     const gap = (n = 1.5) => { y += n; };

//     // ===== Header =====
//     center("Kasir Memayu", 13, true);
//     center(tl("REKAP HARIAN", "DAILY RECAP"), 9, true);
//     center(dateLong, 8, false, true);
//     line();

//     // ===== Ringkasan =====
//     row(tl("Penjualan", "Sales"), rp(income));
//     row(tl("Pengeluaran", "Expenses"), rp(expense));
//     row(tl("Laba", "Profit"), rp(income - expense), { bold: true, size: 9 });
//     row(tl("Jumlah transaksi", "Transactions"), String(sales.length), { gray: true });
//     line();

//     // ===== Per metode =====
//     center(tl("PER METODE BAYAR", "BY PAYMENT METHOD"), 8, true);
//     gap(1);
//     row(mLabel("cash"), rp(byMethod.cash));
//     row(mLabel("transfer"), rp(byMethod.transfer));
//     row(mLabel("ewallet"), rp(byMethod.ewallet));
//     line();

//     // ===== Penjualan =====
//     center(`${tl("PENJUALAN", "SALES")} (${sales.length})`, 8, true);
//     gap(1);
//     if (!sales.length) row("-", "", { gray: true });
//     sales.forEach((x) => {
//       row(`${time(x.createdAt)}  #${String(x._id).slice(-5)}  ${mLabel(x.method)}`, "", { size: 7, gray: true });
//       row((x.items || []).map((i) => `${i.name} x${i.qty}`).join(", "), rp(x.total));
//       if (x.note) row(x.note, "", { size: 7, gray: true });
//       gap(1.2);
//     });
//     row(tl("Total penjualan", "Total sales"), rp(income), { bold: true });
//     line();

//     // ===== Produk terjual =====
//     if (soldList.length) {
//       center(tl("PRODUK TERJUAL", "ITEMS SOLD"), 8, true);
//       gap(1);
//       soldList.forEach(([name, qty]) => row(name, `x${qty}`));
//       line();
//     }

//     // ===== Pengeluaran =====
//     center(`${tl("PENGELUARAN", "EXPENSES")} (${exps.length})`, 8, true);
//     gap(1);
//     if (!exps.length) row("-", "", { gray: true });
//     exps.forEach((x) => {
//       row(
//         `${time(x.createdAt)}  #${String(x._id).slice(-5)}  ${mLabel(x.method)}${x.permanent ? "  (" + tl("permanen", "permanent") + ")" : ""}`,
//         "", { size: 7, gray: true }
//       );
//       row(x.description || "-", rp(x.total));
//       if (x.note) row(x.note, "", { size: 7, gray: true });
//       gap(1.2);
//     });
//     row(tl("Total pengeluaran", "Total expenses"), rp(expense), { bold: true });
//     line();

//     // ===== Penutup =====
//     row(tl("LABA BERSIH", "NET PROFIT"), rp(income - expense), { bold: true, size: 10 });
//     gap(3);
//     center(`${tl("Dicetak", "Printed")}: ${new Date().toLocaleString(loc)}`, 7, false, true);
//     center("Kasir Memayu", 7, false, true);
//     return y;
//   };

//   // Pass 1: ukur tinggi. Pass 2: gambar di kertas dengan tinggi pas.
//   const probe = new jsPDF({ unit: "mm", format: [W, 3000] });
//   const height = render(probe);
//   const doc = new jsPDF({ unit: "mm", format: [W, Math.max(height + 6, 60)] });
//   render(doc);
//   doc.save(`rekap-${key}.pdf`);
// }


import { jsPDF } from "jspdf";

const W = 80; // lebar kertas struk (mm)
const M = 5;  // margin kiri/kanan
const R = W - M;

const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export function downloadRecapPdf({ key, lang, sales, exps, income, expense }) {
  const en = lang === "en";
  const tl = (id, e) => (en ? e : id);
  const loc = en ? "en-US" : "id-ID";
  const mLabel = (m) => (m === "transfer" ? "Transfer" : m === "ewallet" ? "E-wallet" : tl("Tunai", "Cash"));
  const time = (d) => new Date(d).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  const dateLong = new Date(key + "T00:00:00").toLocaleDateString(loc, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // total per metode bayar & produk terjual
  const byMethod = { cash: 0, transfer: 0, ewallet: 0 };
  sales.forEach((x) => { byMethod[x.method in byMethod ? x.method : "cash"] += x.total; });
  const sold = {};
  sales.forEach((x) => (x.items || []).forEach((i) => { sold[i.name] = (sold[i.name] || 0) + i.qty; }));
  const soldList = Object.entries(sold).sort((a, b) => b[1] - a[1]);

  const render = (doc) => {
    let y = 9;
    const lh = (size) => size * 0.45;
    const font = (size, bold = false, gray = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(gray ? 110 : 0);
    };
    const center = (txt, size = 8, bold = false, gray = false) => {
      font(size, bold, gray);
      doc.text(txt, W / 2, y, { align: "center" });
      y += lh(size);
    };
    const row = (left, right = "", { size = 8, bold = false, gray = false } = {}) => {
      font(size, bold, gray);
      const rw = right ? doc.getTextWidth(right) + 3 : 0;
      const lines = doc.splitTextToSize(String(left), R - M - rw);
      lines.forEach((l, i) => {
        doc.text(l, M, y);
        if (i === 0 && right) doc.text(right, R, y, { align: "right" });
        y += lh(size);
      });
    };
    const line = () => {
      y += 1;
      doc.setDrawColor(150);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(M, y, R, y);
      doc.setLineDashPattern([], 0);
      y += 3.5;
    };
    const gap = (n = 1.5) => { y += n; };

    // ===== Header =====
    center("Kasir Memayu", 13, true);
    center(tl("REKAP HARIAN", "DAILY RECAP"), 9, true);
    center(dateLong, 8, false, true);
    line();

    // ===== Ringkasan =====
    row(tl("Penjualan", "Sales"), rp(income));
    row(tl("Pengeluaran", "Expenses"), rp(expense));
    row(tl("Laba", "Profit"), rp(income - expense), { bold: true, size: 9 });
    row(tl("Jumlah transaksi", "Transactions"), String(sales.length), { gray: true });
    line();

    // ===== Per metode =====
    center(tl("PER METODE BAYAR", "BY PAYMENT METHOD"), 8, true);
    gap(1);
    row(mLabel("cash"), rp(byMethod.cash));
    row(mLabel("transfer"), rp(byMethod.transfer));
    row(mLabel("ewallet"), rp(byMethod.ewallet));
    line();

    // ===== Penjualan =====
    center(`${tl("PENJUALAN", "SALES")} (${sales.length})`, 8, true);
    gap(1);
    if (!sales.length) row("-", "", { gray: true });
    sales.forEach((x) => {
      row(`${time(x.createdAt)}  #${String(x._id).slice(-5)}  ${mLabel(x.method)}`, "", { size: 7, gray: true });
      row((x.items || []).map((i) => `${i.name} x${i.qty}`).join(", "), rp(x.total));
      if (x.note) row(x.note, "", { size: 7, gray: true });
      gap(1.2);
    });
    row(tl("Total penjualan", "Total sales"), rp(income), { bold: true });
    line();

    // ===== Produk terjual =====
    if (soldList.length) {
      center(tl("PRODUK TERJUAL", "ITEMS SOLD"), 8, true);
      gap(1);
      soldList.forEach(([name, qty]) => row(name, `x${qty}`));
      line();
    }

    // ===== Pengeluaran =====
    center(`${tl("PENGELUARAN", "EXPENSES")} (${exps.length})`, 8, true);
    gap(1);
    if (!exps.length) row("-", "", { gray: true });
    exps.forEach((x) => {
      row(
        `${time(x.createdAt)}  #${String(x._id).slice(-5)}  ${mLabel(x.method)}${x.permanent ? "  (" + tl("permanen", "permanent") + ")" : ""}`,
        "", { size: 7, gray: true }
      );
      row(x.description || "-", rp(x.total));
      if (x.note) row(x.note, "", { size: 7, gray: true });
      gap(1.2);
    });
    row(tl("Total pengeluaran", "Total expenses"), rp(expense), { bold: true });
    line();

    // ===== Penutup =====
    row(tl("LABA BERSIH", "NET PROFIT"), rp(income - expense), { bold: true, size: 10 });
    gap(3);
    center(`${tl("Dicetak", "Printed")}: ${new Date().toLocaleString(loc)}`, 7, false, true);
    center("Kasir Memayu", 7, false, true);
    return y;
  };

  // Pass 1: ukur tinggi. Pass 2: gambar di kertas dengan tinggi pas.
  const probe = new jsPDF({ unit: "mm", format: [W, 3000] });
  const height = render(probe);
  const doc = new jsPDF({ unit: "mm", format: [W, Math.max(height + 6, 60)] });
  render(doc);

  // =====================================================
  // HALAMAN DATA BACKUP (untuk fitur upload & restore)
  // =====================================================
  const backupPayload = {
    version: 1,
    key,
    generatedAt: new Date().toISOString(),
    sales,
    exps,
    income,
    expense,
  };

  doc.addPage([W, 400]); // halaman khusus data
  let y = 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(80);
  doc.text("---REKAP-DATA-START---", M, y);
  y += 5;

  const jsonStr = JSON.stringify(backupPayload);
  const lines = doc.splitTextToSize(jsonStr, W - M * 2);
  lines.forEach((line) => {
    if (y > 390) {
      doc.addPage([W, 400]);
      y = 10;
    }
    doc.text(line, M, y);
    y += 3.2;
  });

  y += 4;
  doc.text("---REKAP-DATA-END---", M, y);

  doc.save(`rekap-${key}.pdf`);
}