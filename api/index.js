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
  items: [{
    product: mongoose.Schema.Types.ObjectId,
    name: String,
    price: Number,
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
    initial: { type: Number, default: 0 },    // modal kembalian awal hari
    balance: { type: Number, default: 0 },    // sisa stok kembalian
    added: { type: Number, default: 0 },      // total tambahan hari ini
    otherUsed: { type: Number, default: 0 },  // total kembalian yang diambil dari sumber lain
    since: Date,                              // kapan modal terakhir diatur
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
      "change.since": new Date(),
    },
  });
  
  // Tambah stok kembalian
  const addFund = (amount) =>
    upsertSetting({ $inc: { "change.balance": amount, "change.added": amount } });
  // Pergerakan karena transaksi
  const moveFund = ({ balance = 0, other = 0 }) =>
    upsertSetting({ $inc: { "change.balance": balance, "change.otherUsed": other } });

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
  const { name, category, price, stockInitial = 0, promo } = req.body;
  if (!name || !(Number(price) >= 0)) return bad(res, "Nama & harga wajib diisi");

  const data = {
    name,
    category,
    price: Number(price),
    stockInitial: Number(stockInitial),
    stock: Number(stockInitial),
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

  const { name, category, price, stockInitial, promo } = req.body;

  if (name) p.name = name;
  if (category) p.category = category;
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

    const prods = await Product.find({ _id: { $in: items.map((i) => i.product) } });
    const lines = [];
    let total = 0;

    for (const i of items) {
      const p = prods.find((x) => String(x._id) === String(i.product));
      const qty = Math.floor(Number(i.qty));
      if (!p || qty < 1) return bad(res, "Item tidak valid");
      if (p.stock < qty) return bad(res, `Stok ${p.name} tidak cukup (sisa ${p.stock})`);

      total += calcLineTotal(p, qty);

      lines.push({
        product: p._id,
        name: p.name,
        price: p.price,
        qty,
        category: p.category || "makanan",
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
    const src = splitChange(paid - total, (await getFund()).balance);

    await Product.bulkWrite(
      lines.map((l) => ({
        updateOne: {
          filter: { _id: l.product },
          update: { $inc: { stock: -l.qty, sold: l.qty } },
        },
      }))
    );

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
      note,
    });

    if (src.stock || src.other) await moveFund({ balance: -src.stock, other: src.other });

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
    // ===== Ubah item per produk + sesuaikan stok =====
    const old = t.toObject().items || [];
    const ids = [...new Set([...old, ...items].map((i) => String(i.product)).filter(Boolean))];
    const prods = await Product.find({ _id: { $in: ids } });
    const byId = new Map(prods.map((p) => [String(p._id), p]));
    const oldBy = new Map(old.map((i) => [String(i.product), i]));

    const delta = new Map(); // id -> { stock, sold }
    const bump = (id, stock, sold) => {
      const d = delta.get(id) || { stock: 0, sold: 0 };
      d.stock += stock;
      d.sold += sold;
      delta.set(id, d);
    };

    // 1) batalkan efek item lama
    for (const o of old) {
      const id = String(o.product);
      if (!byId.has(id)) continue; // produk sudah dihapus
      if (income) bump(id, +o.qty, -o.qty);
      else bump(id, -o.qty, 0);
    }

    // 2) terapkan item baru
    const lines = [];
    for (const i of items) {
      const id = String(i.product);
      const qty = Math.floor(Number(i.qty));
      if (!(qty >= 1)) return bad(res, "Jumlah item tidak valid");
      const p = byId.get(id);
      const prev = oldBy.get(id);
      if (!p && !prev) return bad(res, "Produk tidak ditemukan");

      if (p) {
        if (income) bump(id, -qty, +qty);
        else bump(id, +qty, 0);
      }
      lines.push({
        product: p ? p._id : prev.product,
        name: p ? p.name : prev.name,
        price: income ? (prev ? prev.price : p.price) : 0, // harga lama dipertahankan
        qty,
        category: p ? p.category : prev.category,
        unit: income ? "" : toUnit(i.unit, prev?.unit || "pcs"), // satuan belanja dipertahankan
      });
    }

    // 3) cek stok tidak boleh minus
    for (const [id, d] of delta) {
      const p = byId.get(id);
      if (p.stock + d.stock < 0) {
        return bad(res, `Stok ${p.name} tidak cukup untuk perubahan ini (sisa ${p.stock})`);
      }
    }

    const ops = [...delta]
      .filter(([, d]) => d.stock || d.sold)
      .map(([id, d]) => ({
        updateOne: { filter: { _id: id }, update: { $inc: { stock: d.stock, sold: d.sold } } },
      }));
    if (ops.length) await Product.bulkWrite(ops);

    t.items = lines;

    if (income) {
      const subtotal = lines.reduce(
        (s, l) => s + calcLineTotal({ price: l.price, promo: byId.get(String(l.product))?.promo }, l.qty),
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
    const fund = await getFund();
    const oldSrc = { stock: t.changeSource?.stock || 0, other: t.changeSource?.other || 0 };
    const legacy = oldSrc.stock + oldSrc.other !== Math.max(0, oldChange); // transaksi sebelum fitur ini
    if (fundApplies(t, fund) && !legacy) {
      const newSrc = splitChange(t.method === "cash" ? t.change : 0, fund.balance + oldSrc.stock);
      t.set("changeSource.stock", newSrc.stock);
      t.set("changeSource.other", newSrc.other);
      fundDelta = {
        balance: oldSrc.stock - newSrc.stock,
        other: newSrc.other - oldSrc.other,
      };
    }
  }

  const saved = await t.save();
  if (fundDelta && (fundDelta.balance || fundDelta.other)) await moveFund(fundDelta);
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

app.delete("/api/transactions/:id", async (req, res) => {
  const t = await Tx.findById(req.params.id);
  if (!t) return res.json({ ok: true });

  const shortId = String(t._id).slice(-5).toUpperCase();
  const sign = t.type === "income" ? 1 : -1;

  if (t.items.length) {
    await Product.bulkWrite(
      t.items.map((i) => ({
        updateOne: {
          filter: { _id: i.product },
          update: {
            $inc: {
              stock: sign * i.qty,
              sold: t.type === "income" ? -i.qty : 0,
            },
          },
        },
      }))
    );
  }

  await t.deleteOne();

  // kembalikan stok kembalian yang terpakai transaksi ini
  if (t.type === "income" && (t.changeSource?.stock || t.changeSource?.other)) {
    const fund = await getFund();
    if (fundApplies(t, fund)) {
      await moveFund({ balance: t.changeSource.stock || 0, other: -(t.changeSource.other || 0) });
    }
  }

  const label =
    t.type === "income"
      ? `Hapus transaksi · ID ${shortId} · Rp ${Number(t.total).toLocaleString("id-ID")}`
      : `Hapus pengeluaran · ID ${shortId} · Rp ${Number(t.total).toLocaleString("id-ID")}`;

  await logActivity(req, "delete_transaction", label, {
    txId: t._id,
    shortId,
    type: t.type,
    total: t.total,
  });

  res.json({ ok: true });
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