import express from "express";
import cors from "cors";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

let conn;
const db = async () => {
  if (!conn) conn = mongoose.connect(process.env.MONGODB_URI);
  await conn;
};

const Product = mongoose.models.Product || mongoose.model("Product", new mongoose.Schema({
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

const Tx = mongoose.models.Tx || mongoose.model("Tx", new mongoose.Schema({
  type: { type: String, enum: ["income", "expense"], required: true },
  description: String,
  items: [{
    product: mongoose.Schema.Types.ObjectId,
    name: String,
    price: Number,
    qty: Number,
    category: { type: String, enum: ["makanan", "minuman"], default: "makanan" },
  }],
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

const bad = (res, m) => res.status(400).json({ message: m });
const toCount = (v) => Math.max(0, Math.floor(Number(v) || 0));

// ==================== HELPER HITUNG PROMO ====================
function calcLineTotal(product, qty) {
  if (!product?.promo?.enabled || !product.promo.buyQty || qty < product.promo.buyQty) {
    return product.price * qty;
  }
  const fullSets = Math.floor(qty / product.promo.buyQty);
  const remainder = qty % product.promo.buyQty;
  return (fullSets * product.promo.payAmount) + (remainder * product.price);
}

app.use("/api", async (req, res, next) => {
  // Cegah cache supaya data selalu realtime
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");

  if (req.headers["x-pass"] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ message: "Password salah" });
  }
  await db();
  next();
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

  res.json(await Product.create(data));
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

  res.json(await p.save());
});

app.delete("/api/products/:id", async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

app.post("/api/close-day", async (_, res) => {
  await Product.updateMany({}, [
    { $set: { stockEnd: "$stock" } },
    { $set: { stockInitial: "$stock", sold: 0 } },
  ]);
  res.json({ ok: true });
});

// ---- Transaksi ----
app.get("/api/transactions", async (_, res) =>
  res.json(await Tx.find().sort({ createdAt: -1 }).limit(500))
);

app.post("/api/transactions", async (req, res) => {
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

    return res.json(
      await Tx.create({
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
      })
    );
  }

  if (type === "expense") {
    if (!description || !(Number(amount) > 0)) {
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
        description,
        items: lines,
        total: Number(amount),
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

  if (note != null) t.note = note;
  if (method) t.method = method;

  if (t.type === "expense") {
    if (description) t.description = description;
    if (Number(amount) > 0) t.total = Number(amount);
  }

  if (t.type === "income") {
    if (Number(amount) > 0) t.total = Number(amount);

    if (items && items[0] && t.items?.[0]) {
      if (items[0].qty) t.items[0].qty = Number(items[0].qty);
      if (items[0].category) t.items[0].category = items[0].category;
    }

    if (mix != null) t.mix = !!mix;
    if (packaging) {
      t.packaging = { plastic: toCount(packaging.plastic), cup: toCount(packaging.cup) };
    }
  }

  res.json(await t.save());
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