import express from "express";
import cors from "cors";
import mongoose from "mongoose";

const app = express();
app.set("etag", false);
app.use(cors());
app.use(express.json());

let conn;
const db = async () => {
  if (!conn) conn = mongoose.connect(process.env.MONGODB_URI);
  await conn;
};

const toKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// Selalu pakai schema TERBARU (hindari model lama yang ter-cache saat hot-reload / warm instance)
const registerModel = (name, schema) => {
  if (mongoose.models[name]) mongoose.deleteModel(name);
  return mongoose.model(name, schema);
};

const Product = registerModel("Product", new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ["makanan", "minuman"], default: "makanan" },
  price: { type: Number, required: true, min: 0 },
  stockInitial: { type: Number, default: 0 },
  priceRaw: { type: Number, min: 0, default: null }, // harga tanpa seduh (minuman)
  stock: { type: Number, default: 0 },
  stockEnd: { type: Number, default: null },
  sold: { type: Number, default: 0 },

  // ===== PROMO =====
  promo: {
    enabled: { type: Boolean, default: false },
    buyQty: { type: Number, min: 2 },
    payAmount: { type: Number, min: 0 },
  },
}, { timestamps: true }));

const Tx = registerModel("Tx", new mongoose.Schema({
  type: { type: String, enum: ["income", "expense"], required: true },
  description: String,
  cashIn: { type: Number, default: 0 },   // uang tunai yang masuk ke saldo dari transaksi ini
  items: [{
    product: mongoose.Schema.Types.ObjectId,
    name: String,
    price: Number,
    raw: { type: Boolean, default: false },     // dijual tanpa seduh
    custom: { type: Boolean, default: false },  // item kustom (sedotan, cup, dll), tidak memengaruhi stok
    qty: Number,
    category: { type: String, enum: ["makanan", "minuman"], default: "makanan" },
    unit: { type: String, default: "" },               // satuan pembelian stok (pcs, bal, kg, ...)
  }],
  // (Lama) item belanja custom - tidak dibuat lagi, dipertahankan agar riwayat lama tetap tampil
  expenseItems: [{
    _id: false,
    name: String,
    qty: Number,
    price: Number,
  }],
  buyQty: Number,                                    // jumlah belanja (opsional, tanpa harus pilih produk)
  buyUnit: { type: String, default: "" },            // satuan belanja (pcs, bal, kg, ...)
  total: Number,
  permanent: { type: Boolean, default: false },      // pengeluaran permanen: dihitung setiap hari
  subtotal: Number,                                  // total normal sebelum custom
  isCustom: { type: Boolean, default: false },       // true kalau total diisi manual
  mix: { type: Boolean, default: false },            // pesanan campur makanan + minuman
  packaging: {                                       // plastik & cup
    plastic: { type: Number, default: 0, min: 0 },
    cup: { type: Number, default: 0, min: 0 },
  },
  method: {
    type: String,
    enum: ["cash", "qris", "transfer", "ewallet"],
    default: "cash",
  },
  cashReceived: Number,
  change: Number,
  changeSource: {                                    // asal uang kembalian
    stock: { type: Number, default: 0 },             // dari stok kembalian
    other: { type: Number, default: 0 },             // dari sumber lain (stok kurang)
  },
  note: { type: String, default: "" },
}, { timestamps: true }));

const Setting = registerModel("Setting", new mongoose.Schema({
  key: { type: String, unique: true },
  closed: { type: Boolean, default: false },
  closedAt: Date,
  // ===== MANAJEMEN KEMBALIAN =====
  change: {
    initial: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    added: { type: Number, default: 0 },
    otherUsed: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },   // ← baru: total penjualan tunai sejak modal diatur
    since: Date,
  },
}, { timestamps: true }));

// ===== LOG AKTIVITAS =====
const ActivityLog = registerModel("ActivityLog", new mongoose.Schema({
  action: {
    type: String,
    enum: [
      "login",
      "logout",
      "create_product",
      "edit_product",
      "delete_product",
      "create_payment",
      "edit_transaction",
      "reset_history",
      "delete_transaction",
      "change_fund"
    ],
    required: true,
  },
  summary: { type: String, required: true },
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true }));

const logActivity = async (req, action, summary, meta = {}) => {
  try {
    await ActivityLog.create({
      action,
      summary,
      meta: {
        ...meta,
        account: req?.authLabel || null,
        password: req?.authPass || null, // hapus baris ini kalau tidak ingin password di log non-login
      },
    });
  } catch (e) {
    console.error("logActivity failed:", e.message);
  }
};

const getClosed = async () => !!(await Setting.findOne({ key: "shop" }))?.closed;
const setClosed = (closed) =>
  Setting.findOneAndUpdate(
    { key: "shop" },
    { closed, closedAt: closed ? new Date() : null },
    { upsert: true, new: true }
  );

  // ==================== MANAJEMEN KEMBALIAN ====================
const getFund = async () => {
  const c = (await Setting.findOne({ key: "shop" }).lean())?.change || {};
  return {
    initial: c.initial || 0,
    balance: c.balance || 0,
    added: c.added || 0,
    otherUsed: c.otherUsed || 0,
    sales: c.sales || 0,
    since: c.since || null,
  };
};

const upsertSetting = (update) =>
  Setting.findOneAndUpdate({ key: "shop" }, update, { upsert: true, new: true });

// Atur ulang (awal hari)

const resetFund = (amount) =>
  upsertSetting({
    $set: {
      "change.initial": amount,
      "change.balance": amount,
      "change.added": 0,
      "change.otherUsed": 0,
      "change.sales": 0,
      "change.since": new Date(),
    },
  });
  
  // Tambah stok kembalian
  const addFund = (amount) =>
    upsertSetting({ $inc: { "change.balance": amount, "change.added": amount } });
  
  // Pergerakan karena transaksi
  const moveFund = ({ balance = 0, other = 0, sales = 0 }) =>
    upsertSetting({
      $inc: { "change.balance": balance, "change.otherUsed": other, "change.sales": sales },
    });

  // Bagi kembalian: stok dulu, kekurangan dari sumber lain
  const splitChange = (change, available) => {
    const need = Math.max(0, Number(change) || 0);
    const stock = Math.min(Math.max(0, available), need);
    return { stock, other: need - stock };
  };
  // Transaksi hanya memengaruhi stok kalau dibuat setelah modal terakhir diatur
  const fundApplies = (tx, fund) =>
    !fund.since || new Date(tx.createdAt) >= new Date(fund.since);

const bad = (res, m) => res.status(400).json({ message: m });
const toCount = (v) => Math.max(0, Math.floor(Number(v) || 0));

// Satuan yang diizinkan untuk pembelian stok
const UNITS = ["pcs", "bal", "pack", "unit", "kg", "gram", "renteng", "liter"];
const toUnit = (u, fallback = "pcs") => (UNITS.includes(u) ? u : fallback);

// ==================== HELPER HITUNG PROMO ====================
function calcLineTotal(product, qty) {
  if (!product?.promo?.enabled || !product.promo.buyQty || qty < product.promo.buyQty) {
    return product.price * qty;
  }
  const fullSets = Math.floor(qty / product.promo.buyQty);
  const remainder = qty % product.promo.buyQty;
  return (fullSets * product.promo.payAmount) + (remainder * product.price);
}

// Password yang diizinkan (3 akun)
const ALLOWED_PASSWORDS = ["123456", "123123", "121212", "111111"];

// Label opsional biar log lebih enak dibaca
const PASSWORD_LABEL = {
  "123456": "Akun 1 - huda",
  "123123": "Akun 2 - sofyan",
  "121212": "Akun 3 - Fauzy",
  "111111": "Akun 4 - Fazri",
};

app.use("/api", async (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("X-Fund-Logic", "v2-cashin");
  res.set("X-Packaging-Schema", String(!!Tx.schema.path("packaging.plastic")));

  const pass = req.headers["x-pass"] || "";
  if (!ALLOWED_PASSWORDS.includes(pass)) {
    return res.status(401).json({ message: "Password salah" });
  }

  // simpan di request supaya endpoint lain bisa pakai
  req.authPass = pass;
  req.authLabel = PASSWORD_LABEL[pass] || pass;

  await db();
  next();
});

const RESET_PASSWORD = process.env.RESET_PASSWORD || "RESETNEW";

app.post("/api/reset-history", async (req, res) => {
  const pw = String(req.body?.password || "");
  if (pw !== RESET_PASSWORD) {
    await logActivity(req, "reset_history", "Reset riwayat gagal · password salah", { success: false });
    return res.status(403).json({ message: "Password reset salah" });
  }
  const { deletedCount } = await Tx.deleteMany({});
  await logActivity(req, "reset_history", `Reset riwayat · ${deletedCount} transaksi`, {
    success: true,
    deletedCount,
  });
  res.json({ ok: true, deletedCount });
});

// ---- Login (catat aktivitas) ----
app.post("/api/login", async (req, res) => {
  const pass = req.authPass;
  const label = req.authLabel;
  
  await logActivity(req, "login", `Login berhasil · ${label}`, {
    password: pass,
    account: label,
  });

  res.json({ ok: true, account: label });
});

app.get("/api/logs", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const logs = await ActivityLog.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json(logs);
});

// ---- Status toko ----
app.get("/api/status", async (_, res) => res.json({ closed: await getClosed() }));

app.post("/api/open-day", async (req, res) => {
  await setClosed(false);
  const v = req.body?.changeFund;
  if (v !== undefined && v !== null && v !== "" && Number(v) >= 0) {
    const amount = Math.floor(Number(v));
    await resetFund(amount);
    await logActivity(req, "change_fund", `Modal kembalian buka toko · Rp ${amount.toLocaleString("id-ID")}`, {
      mode: "set",
      amount,
    });
  }
  res.json({ ok: true, closed: false, fund: await getFund() });
});

// ---- Manajemen kembalian ----
app.get("/api/change-fund", async (_, res) => res.json(await getFund()));

app.post("/api/change-fund", async (req, res) => {
  const mode = req.body?.mode === "set" ? "set" : "add";
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount)) return bad(res, "Nominal tidak valid");

  if (mode === "set") {
    if (amount < 0) return bad(res, "Nominal tidak boleh minus");
    await resetFund(amount);
    await logActivity(req, "change_fund", `Atur modal kembalian · Rp ${amount.toLocaleString("id-ID")}`, { mode, amount });
  } else {
    if (amount <= 0) return bad(res, "Nominal tambahan harus lebih dari 0");
    await addFund(amount);
    await logActivity(req, "change_fund", `Tambah uang kembalian · Rp ${amount.toLocaleString("id-ID")}`, { mode, amount });
  }
  res.json(await getFund());
});

// ---- Produk ----
app.get("/api/products", async (_, res) => res.json(await Product.find().sort({ name: 1 })));

app.post("/api/products", async (req, res) => {
  const { name, category, price, stockInitial = 0, promo, priceRaw } = req.body;
  
  if (!name || !(Number(price) >= 0)) return bad(res, "Nama & harga wajib diisi");

    const data = {
      name,
      category,
      price: Number(price),
      stockInitial: Number(stockInitial),
      stock: Number(stockInitial),
      priceRaw:
        category === "minuman" && priceRaw !== "" && priceRaw != null && Number(priceRaw) >= 0
          ? Number(priceRaw)
          : null,
    };

  if (promo) {
    data.promo = {
      enabled: !!promo.enabled,
      buyQty: promo.enabled ? Number(promo.buyQty) : undefined,
      payAmount: promo.enabled ? Number(promo.payAmount) : undefined,
    };
  }

  const created = await Product.create(data);
  await logActivity(req, "create_product", `Tambah produk: ${created.name}`, {
    productId: created._id,
    name: created.name,
    price: created.price,
    category: created.category,
  });
  res.json(created);
});

app.put("/api/products/:id", async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ message: "Produk tidak ditemukan" });

  const { name, category, price, stockInitial, promo, priceRaw } = req.body;

  if (name) p.name = name;
  if (category) p.category = category;
  if (priceRaw !== undefined) {
    p.priceRaw =
      p.category === "minuman" && priceRaw !== "" && priceRaw !== null && Number(priceRaw) >= 0
        ? Number(priceRaw) : null;
  }
  if (price != null) p.price = Number(price);

  if (stockInitial != null) {
    p.stock += Number(stockInitial) - p.stockInitial;
    p.stockInitial = Number(stockInitial);
  }

  if (promo) {
    p.promo = {
      enabled: !!promo.enabled,
      buyQty: promo.enabled ? Number(promo.buyQty) : undefined,
      payAmount: promo.enabled ? Number(promo.payAmount) : undefined,
    };
  }

  const saved = await p.save();
  await logActivity(req, "edit_product", `Edit produk: ${saved.name}`, {
    productId: saved._id,
    name: saved.name,
    // price: saved.price,
  });
  res.json(saved);
});

app.delete("/api/products/:id", async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.json({ ok: true });

  const name = p.name;
  const shortId = String(p._id).slice(-5).toUpperCase();
  await Product.findByIdAndDelete(req.params.id);

  await logActivity(req, "delete_product", `Hapus produk: ${name} · ID ${shortId}`, {
    productId: p._id,
    shortId,
    name,
  });

  res.json({ ok: true });
});

app.post("/api/close-day", async (_, res) => {
  // Kalau sudah tutup, jangan hitung ulang stok akhir
  if (!(await getClosed())) {
    await Product.updateMany({}, [
      { $set: { stockEnd: "$stock" } },
      { $set: { stockInitial: "$stock", sold: 0 } },
    ]);
  }
  await setClosed(true);
  res.json({ ok: true, closed: true });
});

// ---- Transaksi ----
app.get("/api/transactions", async (_, res) =>
  res.json(await Tx.find().sort({ createdAt: -1 }).limit(500))
);

app.post("/api/transactions", async (req, res) => {
  // Toko tutup → tidak boleh ada transaksi baru sampai dibuka lagi
  if (await getClosed()) {
    return res.status(403).json({ message: "Toko sedang tutup. Buka kembali untuk membuat transaksi baru." });
  }

  const {
    type,
    items = [],
    method = "cash",
    cashReceived,
    note = "",
    description = "",
    amount,
    mix = false,
    packaging = {},
    customTotal,
    buyQty,
    buyUnit,
    permanent 
  } = req.body;

  if (type === "income") {
    if (!items.length) return bad(res, "Keranjang kosong");

    const prods = await Product.find({
      _id: { $in: items.filter((i) => !i.custom).map((i) => i.product) },
    });
    const lines = [];
    const used = new Map(); // total qty per produk (biasa + tanpa seduh) untuk cek stok
    let total = 0;

    for (const i of items) {
      const qty = Math.floor(Number(i.qty));

      if (i.custom) {
        const name = String(i.name || "").trim();
        const price = Number(i.price);
        if (!name || !(price >= 0) || qty < 1) return bad(res, "Item kustom tidak valid");
        total += price * qty;
        lines.push({ name, price, qty, category: "makanan", custom: true });
        continue;
      }

      const p = prods.find((x) => String(x._id) === String(i.product));
      if (!p || qty < 1) return bad(res, "Item tidak valid");
      const raw = !!i.raw;
      if (raw && !(p.category === "minuman" && p.priceRaw != null)) {
        return bad(res, `${p.name} tidak punya harga tanpa seduh`);
      }
      const id = String(p._id);
      const need = (used.get(id) || 0) + qty;
      if (p.stock < need) return bad(res, `Stok ${p.name} tidak cukup (sisa ${p.stock})`);
      used.set(id, need);

      total += raw ? p.priceRaw * qty : calcLineTotal(p, qty);
      lines.push({
        product: p._id, name: p.name, price: raw ? p.priceRaw : p.price,
        qty, category: p.category || "makanan", raw,
      });
    }

    // ===== Nominal custom =====
    const subtotal = total;
    const hasCustom =
      customTotal !== undefined && customTotal !== null && customTotal !== "" && Number(customTotal) >= 0;
    if (hasCustom) total = Number(customTotal);

    const paid = method === "qris" ? total : Number(cashReceived);
    if (!(paid >= total)) return bad(res, "Uang diterima kurang dari total");
    // ===== Sumber kembalian: stok dulu, kekurangan dari sumber lain =====
    const cashIn = method === "cash" ? paid : 0;          // uang tunai masuk laci
    const fund = await getFund();
    // kembalian diambil dari saldo SEBELUM uang pembeli ini masuk
    const src = splitChange(paid - total, fund.balance);

    const stockLines = lines.filter((l) => l.product);
    if (stockLines.length) {
      await Product.bulkWrite(
        stockLines.map((l) => ({
          updateOne: { filter: { _id: l.product }, update: { $inc: { stock: -l.qty, sold: l.qty } } },
        }))
      );
    }

    const tx = await Tx.create({
      type,
      items: lines,
      total,
      subtotal,
      isCustom: hasCustom && total !== subtotal,
      mix: !!mix,
      packaging: { plastic: toCount(packaging.plastic), cup: toCount(packaging.cup) },
      method,
      cashReceived: paid,
      change: paid - total,
      changeSource: src,
      cashIn,
      note,
    });

    console.log("[FUND]", { method, paid, total, cashIn, src, saldoSebelum: fund.balance });
    if (cashIn || src.stock || src.other) {
      await moveFund({ balance: cashIn - src.stock, other: src.other, sales: cashIn ? total : 0 });
    }

    // ===== LOG AKTIVITAS =====
    const shortId = String(tx._id).slice(-5).toUpperCase();
    const rpId = (n) => `Rp ${Number(n).toLocaleString("id-ID")}`;
    await logActivity(
      req,
      "create_payment",
      `Kasir · ${shortId} · ${rpId(tx.total)}` + (src.other > 0 ? ` · +${rpId(src.other)} lain` : ""),
      {
        txId: tx._id,
        shortId,
        total: tx.total,
        method: tx.method,
        changeStock: src.stock,
        changeOther: src.other,
      }
    );

    return res.json(tx);
  }

  if (type === "expense") {
    const finalDesc = String(description || "").trim();
    const finalAmount = Number(amount);

    if (!finalDesc || !(finalAmount > 0)) {
      return bad(res, "Keterangan & nominal wajib diisi");
    }

    const lines = [];
    for (const i of items) {
      const p = await Product.findById(i.product);
      const qty = Math.floor(Number(i.qty));
      if (!p || qty < 1) return bad(res, "Item tidak valid");
      lines.push({
        product: p._id,
        name: p.name,
        price: 0,
        qty,
        category: p.category || "makanan",
        unit: toUnit(i.unit),
      });
    }
    if (lines.length) {
      await Product.bulkWrite(
        lines.map((l) => ({
          updateOne: {
            filter: { _id: l.product },
            update: { $inc: { stock: l.qty } },
          },
        }))
      );
    }
    return res.json(
      await Tx.create({
        type,
        description: finalDesc,
        items: lines,
        buyQty: Number(buyQty) > 0 ? Number(buyQty) : undefined,
        buyUnit: toUnit(buyUnit),
        total: finalAmount,
        permanent: !!permanent,
        note,
        method: method || "cash",
      })
    );
  }

  bad(res, "Tipe transaksi tidak valid");
});

app.put("/api/transactions/:id", async (req, res) => {
  const t = await Tx.findById(req.params.id);
  if (!t) return res.status(404).json({ message: "Tidak ditemukan" });
  const oldChange = t.change || 0;
  let fundDelta = null;

  const { note, description, amount, method, items, mix, packaging, permanent } = req.body;
  const income = t.type === "income";
  const hasAmount = amount !== undefined && amount !== null && amount !== "" && Number(amount) >= 0;

  if (note != null) t.note = note;
  if (method) t.method = method;
  if (!income && description) t.description = description;
  if (!income && permanent !== undefined) t.permanent = !!permanent;

  if (Array.isArray(items)) {
    const old = t.toObject().items || [];
    const hasP = (i) => !i.custom && i.product;
    const kv = (i) => String(i.product) + (i.raw ? ":r" : ":n");
    const ids = [...new Set([...old, ...items].filter(hasP).map((i) => String(i.product)))];
    const prods = await Product.find({ _id: { $in: ids } });
    const byId = new Map(prods.map((p) => [String(p._id), p]));
    const oldBy = new Map(old.filter(hasP).map((i) => [kv(i), i]));

    const delta = new Map();
    const bump = (id, stock, sold) => {
      const d = delta.get(id) || { stock: 0, sold: 0 };
      d.stock += stock; d.sold += sold;
      delta.set(id, d);
    };

    // 1) batalkan efek item lama (item kustom tidak punya stok)
    for (const o of old) {
      if (!hasP(o)) continue;
      const id = String(o.product);
      if (!byId.has(id)) continue;
      if (income) bump(id, +o.qty, -o.qty); else bump(id, -o.qty, 0);
    }

    // 2) terapkan item baru
    const lines = [];
    for (const i of items) {
      const qty = Math.floor(Number(i.qty));
      if (!(qty >= 1)) return bad(res, "Jumlah item tidak valid");

      if (i.custom) {
        const price = Number(i.price);
        if (!String(i.name || "").trim() || !(price >= 0)) return bad(res, "Item kustom tidak valid");
        lines.push({ name: String(i.name).trim(), price, qty, category: "makanan", custom: true });
        continue;
      }

      const id = String(i.product);
      const raw = !!i.raw;
      const p = byId.get(id);
      const prev = oldBy.get(id + (raw ? ":r" : ":n"));
      if (!p && !prev) return bad(res, "Produk tidak ditemukan");
      if (raw && !prev && !(p && p.priceRaw != null)) return bad(res, "Produk tidak punya harga tanpa seduh");

      if (p) { if (income) bump(id, -qty, +qty); else bump(id, +qty, 0); }
      lines.push({
        product: p ? p._id : prev.product,
        name: p ? p.name : prev.name,
        price: income ? (prev ? prev.price : raw ? p.priceRaw : p.price) : 0,
        qty,
        category: p ? p.category : prev.category,
        unit: income ? "" : toUnit(i.unit, prev?.unit || "pcs"),
        raw,
      });
    }

    // 3) stok tidak boleh minus
    for (const [id, d] of delta) {
      const p = byId.get(id);
      if (p.stock + d.stock < 0) return bad(res, `Stok ${p.name} tidak cukup untuk perubahan ini (sisa ${p.stock})`);
    }
    const ops = [...delta].filter(([, d]) => d.stock || d.sold).map(([id, d]) => ({
      updateOne: { filter: { _id: id }, update: { $inc: { stock: d.stock, sold: d.sold } } },
    }));
    if (ops.length) await Product.bulkWrite(ops);

    t.items = lines;

    if (income) {
      const subtotal = lines.reduce(
        (s, l) =>
          s + (l.raw || l.custom
            ? l.price * l.qty
            : calcLineTotal({ price: l.price, promo: byId.get(String(l.product))?.promo }, l.qty)),
        0
      );
      t.subtotal = subtotal;
      t.total = hasAmount ? Number(amount) : subtotal;
      t.isCustom = t.total !== subtotal;
    } else if (Number(amount) > 0) {
      t.total = Number(amount);
    }
  } else if (hasAmount && (income || Number(amount) > 0)) {
    t.total = Number(amount);
  }

  if (income) {
    if (mix != null) t.mix = !!mix;
    if (packaging) {
      t.set("packaging.plastic", toCount(packaging.plastic));
      t.set("packaging.cup", toCount(packaging.cup));
    }
    // sesuaikan uang diterima & kembalian dengan total baru
    if (!(t.cashReceived >= t.total)) t.cashReceived = t.total;
    t.change = t.cashReceived - t.total;
    // ===== sesuaikan stok kembalian =====
        // ===== sesuaikan saldo kembalian =====
    const fund = await getFund();
    const oldSrc = { stock: t.changeSource?.stock || 0, other: t.changeSource?.other || 0 };
    const oldCashIn = t.cashIn || 0;
    const legacy = oldSrc.stock + oldSrc.other !== Math.max(0, oldChange); // transaksi sebelum fitur kembalian
    if (fundApplies(t, fund) && !legacy) {
      const effectOf = (cashIn, change, src) => ({
        balance: cashIn - src.stock,
        other: src.other,
        sales: cashIn > 0 ? cashIn - change : 0,
      });
      const oldEff = effectOf(oldCashIn, oldChange, oldSrc);
      const before = fund.balance - oldEff.balance;            // saldo sebelum transaksi ini
      // transaksi lama (cashIn = 0) tetap tidak menambah saldo, supaya tidak berubah diam-diam
      const newCashIn = oldCashIn > 0 && t.method === "cash" ? t.cashReceived : 0;
      const newSrc = splitChange(t.method === "cash" ? t.change : 0, before);
      const newEff = effectOf(newCashIn, t.change, newSrc);

      t.set("changeSource.stock", newSrc.stock);
      t.set("changeSource.other", newSrc.other);
      t.cashIn = newCashIn;
      fundDelta = {
        balance: newEff.balance - oldEff.balance,
        other: newEff.other - oldEff.other,
        sales: newEff.sales - oldEff.sales,
      };
    }
  }

  const saved = await t.save();
  if (fundDelta && (fundDelta.balance || fundDelta.other || fundDelta.sales)) await moveFund(fundDelta);
  const shortId = String(saved._id).slice(-5).toUpperCase();
  const label = income
    ? `Edit transaksi · ID ${shortId}`
    : `Edit pengeluaran · Rp ${saved.total.toLocaleString("id-ID")}`;
  await logActivity(req, "edit_transaction", label, {
    txId: saved._id,
    shortId,
    type: saved.type,
    total: saved.total,
  });
  res.json(saved);
});

const REFUND_MODES = ["none", "stock", "full"];
const toMode = (m, fallback = "none") => (REFUND_MODES.includes(m) ? m : fallback);
const MODE_LABEL = { none: "tanpa refund", stock: "refund produk", full: "refund produk + uang" };

// mode: "none" = hapus data saja | "stock" = balikkan stok | "full" = balikkan stok + saldo kembalian
const removeTx = async (t, mode = "none") => {
  if (mode === "stock" || mode === "full") {
    const sign = t.type === "income" ? 1 : -1;
    const stockItems = (t.items || []).filter((i) => i.product);
    if (stockItems.length) {
      await Product.bulkWrite(
        stockItems.map((i) => ({
          updateOne: {
            filter: { _id: i.product },
            update: { $inc: { stock: sign * i.qty, sold: t.type === "income" ? -i.qty : 0 } },
          },
        }))
      );
    }
  }

  await t.deleteOne();

  if (mode === "full" && t.type === "income") {
    const fund = await getFund();
    if (fundApplies(t, fund)) {
      const cashIn = t.cashIn || 0;
      const eff = {
        balance: cashIn - (t.changeSource?.stock || 0),
        other: t.changeSource?.other || 0,
        sales: cashIn > 0 ? cashIn - (t.change || 0) : 0,
      };
      if (eff.balance || eff.other || eff.sales) {
        await moveFund({ balance: -eff.balance, other: -eff.other, sales: -eff.sales });
      }
    }
  }
};

const validIds = (arr) =>
  (Array.isArray(arr) ? arr : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);

app.delete("/api/transactions/:id", async (req, res) => {
  const t = await Tx.findById(req.params.id);
  if (!t) return res.json({ ok: true });

  const mode = toMode(req.body?.mode, "full");   // default sama seperti perilaku lama
  const shortId = String(t._id).slice(-5).toUpperCase();
  const label =
    (t.type === "income"
      ? `Hapus transaksi · ID ${shortId} · Rp ${Number(t.total).toLocaleString("id-ID")}`
      : `Hapus pengeluaran · ID ${shortId} · Rp ${Number(t.total).toLocaleString("id-ID")}`) +
    ` · ${MODE_LABEL[mode]}`;

  await removeTx(t, mode);

  await logActivity(req, "delete_transaction", label, { txId: t._id, shortId, type: t.type, total: t.total, mode });
  res.json({ ok: true });
});

// Hapus beberapa transaksi pilihan
app.post("/api/transactions/bulk-delete", async (req, res) => {
  const ids = validIds(req.body?.ids);
  if (!ids.length) return bad(res, "Pilih minimal 1 transaksi");
  const mode = toMode(req.body?.mode);

  const list = await Tx.find({ _id: { $in: ids } });
  for (const t of list) await removeTx(t, mode);

  await logActivity(req, "delete_transaction", `Hapus ${list.length} transaksi (pilihan) · ${MODE_LABEL[mode]}`, {
    count: list.length,
    mode,
  });
  res.json({ ok: true, deletedCount: list.length, ids: list.map((t) => String(t._id)) });
});

// Hapus semua transaksi pada satu tanggal (rentang waktu dikirim dari klien supaya zona waktu benar)
app.post("/api/transactions/delete-by-date", async (req, res) => {
  const from = new Date(req.body?.from);
  const to = new Date(req.body?.to);
  if (isNaN(from) || isNaN(to) || to < from) return bad(res, "Tanggal tidak valid");
  if (to - from > 36 * 3600 * 1000) return bad(res, "Rentang maksimal 1 hari");
  const mode = toMode(req.body?.mode);

  const list = await Tx.find({ createdAt: { $gte: from, $lte: to } });
  for (const t of list) await removeTx(t, mode);

  await logActivity(req, "delete_transaction", `Hapus ${list.length} transaksi tanggal ${toKey(from)} · ${MODE_LABEL[mode]}`, {
    count: list.length,
    mode,
    from,
    to,
  });
  res.json({ ok: true, deletedCount: list.length, ids: list.map((t) => String(t._id)) });
});

app.post("/api/products/bulk-delete", async (req, res) => {
  const ids = validIds(req.body?.ids);
  if (!ids.length) return bad(res, "Pilih minimal 1 produk");

  const list = await Product.find({ _id: { $in: ids } });
  await Product.deleteMany({ _id: { $in: list.map((p) => p._id) } });

  await logActivity(req, "delete_product", `Hapus ${list.length} produk: ${list.map((p) => p.name).join(", ").slice(0, 200)}`, {
    count: list.length,
  });
  res.json({ ok: true, deletedCount: list.length, ids: list.map((p) => String(p._id)) });
});

// di file server (setelah endpoint transaksi yang sudah ada)

app.post("/api/import-transactions", async (req, res) => {
  try {
    const { transactions = [], key } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return bad(res, "Tidak ada transaksi untuk diimpor");
    }

    const created = [];

    for (const raw of transactions) {
      const doc = {
        type: raw.type,
        description: raw.description || "",
        items: (raw.items || []).map((i) => ({
            product: i.product || undefined,
            name: i.name,
            price: Number(i.price) || 0,
            qty: Number(i.qty) || 1,
            category: i.category || "makanan",
            unit: i.unit || "",
            raw: !!i.raw,
            custom: !!i.custom,
          })),
        expenseItems: raw.expenseItems || [],
        buyQty: raw.buyQty,
        buyUnit: raw.buyUnit || "",
        total: Number(raw.total) || 0,
        permanent: !!raw.permanent,
        subtotal: raw.subtotal,
        isCustom: !!raw.isCustom,
        mix: !!raw.mix,
        packaging: {
          plastic: Number(raw?.packaging?.plastic) || 0,
          cup: Number(raw?.packaging?.cup) || 0,
        },
        method: raw.method || "cash",
        cashReceived: raw.cashReceived,
        change: raw.change,
        changeSource: raw.changeSource || { stock: 0, other: 0 },
        note: raw.note || "",
        // pakai tanggal asli kalau ada, kalau tidak pakai tanggal rekap
        createdAt: raw.createdAt
          ? new Date(raw.createdAt)
          : new Date((key || toKey(new Date())) + "T12:00:00"),
      };

      // Mode restore → hanya insert ke riwayat, stok & sold tidak disentuh
      const tx = await Tx.create(doc);
      created.push(tx);
    }

    await logActivity(
      req,
      "create_payment",
      `Restore rekap · ${created.length} transaksi · ${key || ""}`,
      {
        count: created.length,
        key,
        restore: true,
      }
    );

    res.json({ ok: true, imported: created.length });
  } catch (e) {
    console.error("import-transactions error:", e);
    res.status(500).json({ message: e.message || "Gagal import transaksi" });
  }
});

// ---- Logout (catat aktivitas) ----
app.post("/api/logout", async (req, res) => {
  const label = req.authLabel;
  await logActivity(req, "logout", `Logout · ${label}`, {
    account: label,
    password: req.authPass,
  });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

export default app;