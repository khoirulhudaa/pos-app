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
  note: { type: String, default: "" },
}, { timestamps: true }));

// Status toko (buka / tutup) - satu dokumen saja
const Setting = registerModel("Setting", new mongoose.Schema({
  key: { type: String, unique: true },
  closed: { type: Boolean, default: false },
  closedAt: Date,
}, { timestamps: true }));

// ===== LOG AKTIVITAS =====
const ActivityLog = registerModel("ActivityLog", new mongoose.Schema({
  action: {
    type: String,
    enum: ["login", "create_product", "edit_product", "create_payment", "edit_transaction"],
    required: true,
  },
  summary: { type: String, required: true },   // teks singkat untuk ditampilkan
  meta: { type: mongoose.Schema.Types.Mixed }, // detail opsional (nama produk, total, dll)
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
const ALLOWED_PASSWORDS = ["123456", "123123", "121212"];

// Label opsional biar log lebih enak dibaca
const PASSWORD_LABEL = {
  "123456": "Akun 1 (Huda)",
  "123123": "Akun 2 (Sofyan)",
  "121212": "Akun 3 (Fauzy)",
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

app.post("/api/open-day", async (_, res) => {
  await setClosed(false);
  res.json({ ok: true, closed: false });
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
    price: saved.price,
  });
  res.json(saved);
});

app.delete("/api/products/:id", async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
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
      note,
    });

    // ===== LOG AKTIVITAS =====
    const itemNames = lines.map((l) => `${l.name}×${l.qty}`).join(", ");
    await logActivity(
      req,
      "create_payment",
      `Pembayaran: ${itemNames} · Rp ${Number(tx.total).toLocaleString("id-ID")}`,
      {
        txId: tx._id,
        total: tx.total,
        method: tx.method,
        items: itemNames,
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

  const { note, description, amount, method, items, mix, packaging } = req.body;
  const income = t.type === "income";
  const hasAmount = amount !== undefined && amount !== null && amount !== "" && Number(amount) >= 0;

  if (note != null) t.note = note;
  if (method) t.method = method;
  if (!income && description) t.description = description;

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
  }

  const saved = await t.save();
  const label = income
    ? `Edit transaksi penjualan · Rp ${saved.total.toLocaleString("id-ID")}`
    : `Edit pengeluaran: ${saved.description || "-"} · Rp ${saved.total.toLocaleString("id-ID")}`;
  await logActivity(req, "edit_transaction", label, {
    txId: saved._id,
    type: saved.type,
    total: saved.total,
  });
  res.json(saved);
});

app.delete("/api/transactions/:id", async (req, res) => {
  const t = await Tx.findById(req.params.id);
  if (!t) return res.json({ ok: true });
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
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

export default app;