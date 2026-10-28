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
}, { timestamps: true }));

const Tx = mongoose.models.Tx || mongoose.model("Tx", new mongoose.Schema({
  type: { type: String, enum: ["income", "expense"], required: true },
  description: String,
    items: [{
    product: mongoose.Schema.Types.ObjectId,
    name: String,
    price: Number,
    qty: Number,
    category: { type: String, enum: ["makanan", "minuman"], default: "makanan" }  // ← tambahkan ini
  }],
  total: Number,
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

app.use("/api", async (req, res, next) => {
  if (req.headers["x-pass"] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ message: "Password salah" });
  }
  await db();
  next();
});

// ---- Produk ----
app.get("/api/products", async (_, res) => res.json(await Product.find().sort({ name: 1 })));

app.post("/api/products", async (req, res) => {
  const { name, category, price, stockInitial = 0 } = req.body;
  if (!name || !(Number(price) >= 0)) return bad(res, "Nama & harga wajib diisi");
  res.json(await Product.create({
    name,
    category,
    price: Number(price),
    stockInitial: Number(stockInitial),
    stock: Number(stockInitial),
  }));
});

app.put("/api/products/:id", async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ message: "Produk tidak ditemukan" });
  const { name, category, price, stockInitial } = req.body;
  if (name) p.name = name;
  if (category) p.category = category;
  if (price != null) p.price = Number(price);
  if (stockInitial != null) {
    p.stock += Number(stockInitial) - p.stockInitial;
    p.stockInitial = Number(stockInitial);
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
  } = req.body;

  if (type === "income") {
    if (!items.length) return bad(res, "Keranjang kosong");
    const prods = await Product.find({ _id: { $in: items.map((i) => i.product) } });
    const lines = [];
    for (const i of items) {
      const p = prods.find((x) => String(x._id) === String(i.product));
      const qty = Math.floor(Number(i.qty));
      if (!p || qty < 1) return bad(res, "Item tidak valid");
      if (p.stock < qty) return bad(res, `Stok ${p.name} tidak cukup (sisa ${p.stock})`);
      lines.push({
        product: p._id,
        name: p.name,
        price: p.price,
        qty,
        category: p.category || "makanan",   // ← simpan category
      });
    }
    const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
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
        category: p.category || "makanan",   // ← simpan category
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
        method: method || "cash", // tunai / transfer / ewallet
      })
    );
  }

  bad(res, "Tipe transaksi tidak valid");
});

app.put("/api/transactions/:id", async (req, res) => {
  const t = await Tx.findById(req.params.id);
  if (!t) return res.status(404).json({ message: "Tidak ditemukan" });
  const { note, description, amount, method } = req.body;
  if (note != null) t.note = note;
  if (method) t.method = method;
  if (t.type === "expense") {
    if (description) t.description = description;
    if (Number(amount) > 0) t.total = Number(amount);
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