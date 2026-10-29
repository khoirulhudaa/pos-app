import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const methodLabel = (m) =>
  m === "qris" ? "QRIS" : m === "transfer" ? "Transfer" : m === "ewallet" ? "E-Wallet" : "Tunai";

// ==================== HELPER HITUNG PROMO ====================
function calcLineTotal(product, qty) {
  if (!product.promo?.enabled || !product.promo.buyQty || qty < product.promo.buyQty) {
    return product.price * qty;
  }
  const fullSets = Math.floor(qty / product.promo.buyQty);
  const remainder = qty % product.promo.buyQty;
  return fullSets * product.promo.payAmount + remainder * product.price;
}

// ---------- Ikon (SVG inline, tanpa library tambahan) ----------
const P = {
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  cart: "M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  down: "M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6",
  up: "M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  plus: "M12 5v14 M5 12h14",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  check: "M20 6L9 17l-5-5",
  trash: "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  edit: "M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  x: "M18 6L6 18 M6 6l12 12",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35",
};
const Ic = ({ n, s = 20 }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={P[n]} />
  </svg>
);

async function req(path, method = "GET", body) {
  const url = "/api" + path + (method === "GET" ? (path.includes("?") ? "&" : "?") + "_=" + Date.now() : "");
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", "x-pass": localStorage.getItem("pos_pass") || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || "Terjadi kesalahan"), { status: r.status });
  return d;
}

// ---------- Konfirmasi pakai react-hot-toast ----------
const confirmToast = ({ title, desc, okText = "Ya", danger = false, onOk }) =>
  toast(
    (t) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 220 }}>
        <b>{title}</b>
        {desc && <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>{desc}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={() => toast.dismiss(t.id)}
            style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "#e2e8f0", fontWeight: 600, fontSize: 13, color: "black" }}
          >
            Batal
          </button>
          <button
            onClick={() => {
              toast.dismiss(t.id);
              onOk();
            }}
            style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: danger ? "#e5484d" : "#0a66c2", color: "white", fontWeight: 600, fontSize: 13 }}
          >
            {okText}
          </button>
        </div>
      </div>
    ),
    { duration: 10000, position: "top-center" }
  );

// ---------- Komponen umum ----------
const Top = ({ title, sub, right }) => (
  <div className="top">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    {right}
  </div>
);

const Modal = ({ title, onClose, children }) => (
  <div className="modal-wrap" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-h"><h3>{title}</h3><button className="icon-btn dark" onClick={onClose}><Ic n="x" /></button></div>
      {children}
    </div>
  </div>
);

function Login({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setShowInstall(false);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setShowInstall(false);
    setDeferredPrompt(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    localStorage.setItem("pos_pass", pw);
    try {
      await req("/products");
      onOk();
    } catch (x) {
      localStorage.removeItem("pos_pass");
      setErr(x.message);
    }
  };

  return (
    <div className="login">
      <div className="login-bg" />

      <div className="login-content">
        <div className="login-top">
          <div className="logo">
            <img src="/icon-192.png" alt="icon" style={{ width: "100%", transform: "scale(1.1)" }} />
          </div>
          <h1>KasirKu</h1>
          <p>Catat penjualan, stok, dan keuangan toko dengan mudah</p>
        </div>

        <form className="login-card" onSubmit={submit}>
          <label>Password</label>
          <input
            type="password"
            placeholder="Masukkan password toko"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          {err && <p className="err small">{err}</p>}
          <button className="btn gold" type="submit">
            Masuk ke Kasir
          </button>
        </form>

        {showInstall && (
          <div className="install-box">
            <button className="btn gold install-btn" onClick={installApp}>
              Install
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Ikon kategori produk (gambar di folder public) ----------
function CatIcon({ c, s = 24 }) {
  const [failed, setFailed] = useState(false);
  const drink = c === "minuman";
  if (failed) return <span style={{ fontSize: s * 0.85 }}>{drink ? "🥤" : "🍜"}</span>;
  return (
    <img
      src={drink ? "/drink.png" : "/food.png"}
      alt={drink ? "Minuman" : "Makanan"}
      onError={() => setFailed(true)}
      style={{ width: s, height: s, objectFit: "contain", verticalAlign: "middle", flexShrink: 0, transform: drink ? "rotate(20deg)" : undefined }}
    />
  );
}

// Mix = diceklis mix, ATAU isinya campur makanan + minuman
const isMix = (t) =>
  !!t.mix || new Set((t.items || []).map((i) => i.category)).size > 1;

// ---------- Ikon transaksi (mix pakai /mix.png) ----------
function TxIcon({ t }) {
  const [failed, setFailed] = useState(false);
  const mixed = isMix(t);
  const src = mixed ? "/mix.png" : "/drink.png";
  if (failed) return <span style={{ fontSize: 20 }}>{mixed ? "" : "🍜"}</span>;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: 24, height: 24, objectFit: "contain", transform: "rotate(20deg)" }}
    />
  );
}

function TxRow({ t, children, onClick }) {
  const inc = t.type === "income";
  const pk = t.packaging || {};
  return (
    <div className={"card tx" + (onClick ? " clickable" : "")} onClick={onClick}>
      <div className="tx-main">
        <span className={`tx-ic ${inc ? "in" : "outc"}${isMix(t) ? " mix" : ""}`}>
          <TxIcon key={isMix(t) ? "m" : "n"} t={t} />
        </span>
        <div className="grow">
          <b className="tx-t">
            {inc ? (t.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ") : t.description}
          </b>
          <small className="muted">
            {new Date(t.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {(inc || t.method) && `, ${methodLabel(t.method)}`}
          </small>
          {inc && (isMix(t) || pk.plastic > 0 || pk.cup > 0) && (
            <div className="tags">
              {isMix(t) && <span className="mix-chip">Mix</span>}
              {pk.plastic > 0 && <span className="pk-chip plastic">🛍️ P×{pk.plastic}</span>}
              {pk.cup > 0 && <span className="pk-chip cup">🥤 C×{pk.cup}</span>}
            </div>
          )}
        </div>
        <b className={inc ? "ok" : "err"}>
          {inc ? "+" : "−"}
          {rp(t.total)}
        </b>
      </div>
      {children}
    </div>
  );
}

// ---------- Beranda ----------
function Beranda({ txs, products, go, closeDay, askLogout, openDetail, settings = {} }) {
  const { hideLaba = false, hidePengeluaran = false } = settings;

  const today = new Date().toDateString();
  const tt = txs.filter((t) => new Date(t.createdAt).toDateString() === today);
  const inc = tt.filter((t) => t.type === "income").reduce((s, t) => s + t.total, 0);
  const exp = tt.filter((t) => t.type === "expense").reduce((s, t) => s + t.total, 0);
  const low = products.filter((p) => p.stock < 5);
  const h = new Date().getHours();
  const greet = h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
  const menu = [
    { img: "/kasir2.png", label: "Kasir", fn: () => go("kasir") },
    { img: "/produk.png", label: "Produk", fn: () => go("produk") },
    { img: "/keranjang.png", label: "Belanja", fn: () => go("keluar") },
    { img: "/riwayat.png", label: "Riwayat", fn: () => go("riwayat") },
    { img: "/tutup.png", label: "Tutup", fn: closeDay },
  ];

  let filteredTxs = [...txs];
  if (settings.filterJenis !== "all") filteredTxs = filteredTxs.filter((t) => t.type === settings.filterJenis);
  if (settings.filterKategori !== "all") {
    filteredTxs = filteredTxs.filter((t) => t.items?.some((i) => i.category === settings.filterKategori));
  }
  const displayTxs = filteredTxs.slice(0, settings.maxRiwayatBeranda);

  const money = (value) => (settings.hideNominal ? "••••••" : rp(value));

  return (
    <>
      <div className="hero">
        <div className="hero-row">
          <div className="avatar">K</div>
          <div className="grow">
            <small>{greet},</small>
            <b>Pemilik Toko</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ borderRadius: "9999px" }} className="icon-btn" onClick={() => go("setting")} title="Pengaturan">
              <Ic n="settings" />
            </button>
            <button style={{ borderRadius: "9999px" }} className="icon-btn" onClick={askLogout} title="Keluar">
              <Ic n="logout" />
            </button>
          </div>
        </div>
        <div className="balance">
          <span>Laba hari ini</span>
          <strong>{hideLaba ? "••••••" : money(inc - exp)}</strong>
          <div className="bal-row">
            <div><small>Pemasukan</small><b className="ok">{money(inc)}</b></div>
            <div><small>Pengeluaran</small><b className="err">{hidePengeluaran ? "••••••" : money(exp)}</b></div>
            <div><small>Transaksi</small><b>{tt.length}</b></div>
          </div>
        </div>
      </div>

      <div className="page pull">
        <div className="menu">
          {menu.map((m) => (
            <button key={m.label} onClick={m.fn}>
              <span className="mi"><img src={m.img} alt={m.label} /></span>
              {m.label}
            </button>
          ))}
        </div>

        {low.length > 0 && (
          <div className="card warn">
            <div className="warn-h"><Ic n="alert" s={18} /> Stok menipis</div>
            {low.slice(0, 5).map((p) => (
              <div className="li" key={p._id}><span><CatIcon c={p.category} s={18} /> {p.name}</span><b className="err">sisa {p.stock}</b></div>
            ))}
          </div>
        )}

        <div className="sec-h"><h3>Transaksi terbaru</h3><button className="link" onClick={() => go("riwayat")}>Lihat semua</button></div>
        {displayTxs.map((t) => (
          <TxRow key={t._id} t={t} onClick={() => openDetail(t)} />
        ))}
        {!txs.length && <p className="muted center">Belum ada transaksi.</p>}
      </div>
    </>
  );
}

function Setting({ settings, setSettings, go }) {
  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const [srv, setSrv] = useState("cek");
  useEffect(() => {
    fetch("/api/products", { cache: "no-store", headers: { "x-pass": localStorage.getItem("pos_pass") || "" } })
      .then((r) => setSrv(r.headers.get("x-packaging-schema") === "true" ? "ok" : "lama"))
      .catch(() => setSrv("gagal"));
  }, []);

  return (
    <>
      <Top
        title="Pengaturan"
        sub="Atur tampilan & privasi aplikasi"
        right={<button className="icon-btn dark" onClick={() => go("home")}><Ic n="x" /></button>}
      />

      <div className="page pull">
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Privasi Nominal</h3>

          <label className="switch-row">
            <span>Sembunyikan semua nominal</span>
            <input type="checkbox" checked={settings.hideNominal} onChange={(e) => update("hideNominal", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>Sembunyikan Pengeluaran</span>
            <input type="checkbox" checked={settings.hidePengeluaran} onChange={(e) => update("hidePengeluaran", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>Sembunyikan Laba</span>
            <input type="checkbox" checked={settings.hideLaba} onChange={(e) => update("hideLaba", e.target.checked)} />
          </label>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 16 }}>Tampilan Beranda</h3>

          <label>Jumlah maksimal transaksi di Beranda</label>
          <select value={settings.maxRiwayatBeranda} onChange={(e) => update("maxRiwayatBeranda", Number(e.target.value))}>
            <option value={3}>3 transaksi</option>
            <option value={5}>5 transaksi</option>
            <option value={8}>8 transaksi</option>
            <option value={10}>10 transaksi</option>
            <option value={15}>15 transaksi</option>
          </select>

          <label style={{ marginTop: 16 }}>Tampilkan jenis transaksi</label>
          <select value={settings.filterJenis} onChange={(e) => update("filterJenis", e.target.value)}>
            <option value="all">Semua (Masuk + Keluar)</option>
            <option value="income">Hanya Pemasukan</option>
            <option value="expense">Hanya Pengeluaran</option>
          </select>

          <label style={{ marginTop: 16 }}>Filter kategori produk</label>
          <select value={settings.filterKategori} onChange={(e) => update("filterKategori", e.target.value)}>
            <option value="all">Semua kategori</option>
            <option value="makanan">Hanya Makanan</option>
            <option value="minuman">Hanya Minuman</option>
          </select>
        </div>

        <p className="muted center" style={{ marginTop: 24, fontSize: 13 }}>
          Pengaturan disimpan otomatis di perangkat ini
        </p>

        <p className="center" style={{ fontSize: 13, marginTop: 8 }}>
          Server: {srv === "ok" ? "✅ versi terbaru" : srv === "lama" ? "❌ versi lama, deploy ulang server.js" : srv === "gagal" ? "⚠️ tidak terhubung" : "mengecek..."}
        </p>
      </div>
    </>
  );
}

// ---------- Kasir ----------
function Kasir({ products, reload, patchTx }) {
  const [cart, setCart] = useState({});
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [done, setDone] = useState(null);

  // opsi baru
  const [mix, setMix] = useState(false);
  const [plastic, setPlastic] = useState(0);
  const [cup, setCup] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const shown = products.filter((p) => (cat === "all" || p.category === cat) && (p.name || "").toLowerCase().includes(q.toLowerCase()));
  const lines = products.filter((p) => cart[p._id]);
  const subtotal = lines.reduce((s, p) => s + calcLineTotal(p, cart[p._id]), 0);
  const total = custom && customVal !== "" ? Math.max(0, Number(customVal)) : subtotal;
  const count = lines.reduce((s, p) => s + cart[p._id], 0);
  const change = Number(cash || 0) - total;
  const canPay = lines.length && cash !== "" && change >= 0 && (!custom || customVal !== "");

  const add = (p, d) => setCart((c) => {
    const n = { ...c };
    const v = Math.max(0, Math.min(p.stock, (c[p._id] || 0) + d));
    if (v) n[p._id] = v; else delete n[p._id];
    return n;
  });

  const resetForm = () => {
    setCart({}); setCash(""); setNote(""); setOpen(false);
    setMix(false); setPlastic(0); setCup(0); setCustom(false); setCustomVal("");
  };

  const pay = async () => {
    setBusy(true);
    try {
      const items = lines.map((p) => ({ product: p._id, qty: cart[p._id] }));
      const paid = Number(cash);
      const saved = await req("/transactions", "POST", {
        type: "income",
        items,
        method: "cash",
        cashReceived: paid,
        note,
        mix,
        packaging: { plastic, cup },
        customTotal: custom && customVal !== "" ? Number(customVal) : undefined,
      });
      if ((saved.packaging?.plastic ?? 0) !== plastic || (saved.packaging?.cup ?? 0) !== cup) {
        toast.error("Server belum menyimpan plastik/cup. Deploy ulang server.js terbaru.", { duration: 8000 });
      }
      patchTx(saved); // langsung muncul di riwayat/beranda
      setDone({ total, paid, change: paid - total });
      resetForm();
      await reload();
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const Counter = ({ label, value, set }) => (
    <div className="opt">
      <span>{label}</span>
      <div className="qty">
        <button type="button" onClick={() => set(Math.max(0, value - 1))}>−</button>
        <span>{value}</span>
        <button type="button" onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );

  return (
    <div className="kasir">
      <div>
        <div className="search"><Ic n="search" s={18} /><input placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="pills">
          {[["all", "Semua"], ["makanan", "Makanan"], ["minuman", "Minuman"]].map(([k, l]) => (
            <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>
          ))}
        </div>
        <div className="products">
          {shown.map((p) => {
            const qty = cart[p._id] || 0;
            const level = p.stock < 1 ? "empty" : p.stock < 5 ? "low" : "good";
            return (
              <div key={p._id} className={"prod" + (qty ? " active" : "") + (p.stock < 1 ? " out" : "")}>
                <div style={{
                  background: p.promo?.enabled ? "linear-gradient(135deg, #fbb02d, #f59e0b)" : "#e5e7eb",
                  color: p.promo?.enabled ? "#00264d" : "#6b7280",
                  fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 20, marginTop: 6,
                  display: "inline-block", letterSpacing: "-0.2px",
                }}>
                  {p.promo?.enabled ? `${p.promo.buyQty} / ${rp(p.promo.payAmount)}` : "Harga normal"}
                </div>

                <div className="prod-name">
                  <b>{p.name}</b>
                  <span className={"stock " + level}>{p.stock < 1 ? "Habis" : `Stok ${p.stock}`}</span>
                </div>
                <div className="stepper">
                  <button onClick={() => add(p, -1)} disabled={qty < 1}>
                    <span style={{ position: "relative", top: -3.2 }}>−</span>
                  </button>
                  <span>{qty}</span>
                  <button onClick={() => add(p, 1)} disabled={qty >= p.stock}>
                    <span style={{ position: "relative", top: -3.2 }}>+</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {!shown.length && <p className="muted center">{products.length ? "Produk tidak ditemukan" : "Belum ada produk. Tambahkan di menu Produk."}</p>}
      </div>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className={"cart-panel" + (open ? " open" : "")}>
        <div className="modal-h"><h3>Keranjang</h3><button className="icon-btn dark sheet-x" onClick={() => setOpen(false)}><Ic n="x" /></button></div>
        {lines.map((p) => {
          const qty = cart[p._id];
          const lineTotal = calcLineTotal(p, qty);
          const normalTotal = p.price * qty;
          const hasPromo = p.promo?.enabled && qty >= p.promo.buyQty;

          return (
            <div className="row" key={p._id}>
              <div className="grow">
                <b>{p.name}</b>
                <br />
                <small className="muted">
                  {rp(p.price)} × {qty}
                  {hasPromo && <span style={{ color: "var(--ok)", fontWeight: 700 }}> → Promo</span>}
                </small>
              </div>
              <div className="qty">
                <button onClick={() => add(p, -1)}>−</button>
                <span>{qty}</span>
                <button onClick={() => add(p, 1)}>+</button>
              </div>
              <b className="w" style={{ color: hasPromo ? "var(--ok)" : undefined }}>
                {rp(lineTotal)}
                {hasPromo && normalTotal !== lineTotal && (
                  <small style={{ display: "block", fontSize: 11, color: "var(--muted)", textDecoration: "line-through" }}>
                    {rp(normalTotal)}
                  </small>
                )}
              </b>
            </div>
          );
        })}
        {!lines.length && <p className="muted center">Pilih produk untuk memulai</p>}

        {/* ===== Opsi pesanan ===== */}
        <label className="switch-row" style={{ marginTop: 10 }}>
          <span> Pesanan Mix (makanan + minuman)</span>
          <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
        </label>

        <div className="opt-grid">
          <Counter label="🛍️ Plastik" value={plastic} set={setPlastic} />
          <Counter label="🥤 Cup" value={cup} set={setCup} />
        </div>

        <label className="switch-row">
          <span>✏️ Nominal custom</span>
          <input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setCustomVal(""); }} />
        </label>
        {custom && (
          <div className="custom-box">
            <label style={{ marginTop: 0 }}>Total custom (Rp)</label>
            <input
              type="number"
              inputMode="numeric"
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value)}
              placeholder={String(subtotal)}
            />
            <small className="muted">Total normal: {rp(subtotal)}</small>
          </div>
        )}

        <div className="total">
          <span>Total</span>
          <b>
            {rp(total)}
            {custom && customVal !== "" && total !== subtotal && (
              <small style={{ display: "block", fontSize: 12, color: "var(--muted)", textDecoration: "line-through", fontWeight: 600, textAlign: "right" }}>
                {rp(subtotal)}
              </small>
            )}
          </b>
        </div>

        <label>Uang diterima</label>
        <input type="number" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
        <div className="chips">
          <button onClick={() => setCash(total)}>Uang pas</button>
          {[20000, 50000, 100000].map((n) => <button key={n} onClick={() => setCash(n)}>{n / 1000}rb</button>)}
        </div>
        <div className={"change " + (cash !== "" && change < 0 ? "bad" : "")}>
          <span>{cash !== "" && change < 0 ? "Kurang" : "Kembalian"}</span>
          <b>{cash === "" ? "-" : rp(Math.abs(change))}</b>
        </div>

        <input placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn gold" disabled={!canPay || busy} onClick={pay}>
          {busy ? "Memproses..." : "Bayar sekarang"}
        </button>
      </div>

      {count > 0 && !open && (
        <button className="cbar" onClick={() => setOpen(true)}>
          <span className="cbar-l"><Ic n="cart" s={18} /> {count} item</span>
          <b>{rp(total)}</b>
          <span className="cbar-r">Bayar ›</span>
        </button>
      )}

      {done && (
        <div className="modal-wrap center-m">
          <div className="modal success">
            <div className="ok-ic"><Ic n="check" s={34} /></div>
            <h3>Pembayaran Berhasil</h3>
            <strong>{rp(done.total)}</strong>
            <div className="rcp">
              <div><span>Diterima</span><b>{rp(done.paid)}</b></div>
              <div><span>Kembalian</span><b className="ok">{rp(done.change)}</b></div>
            </div>
            <button className="btn gold" onClick={() => setDone(null)}>Selesai</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Produk ----------
function Produk({ products, reload, closeDay, patchProduct, removeProduct }) {
  const empty = {
    name: "", category: "makanan", price: "", stockInitial: "",
    promoEnabled: false, promoBuyQty: "", promoPayAmount: "",
  };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const close = () => { setShow(false); setEditId(null); setF(empty); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: f.name,
        category: f.category,
        price: Number(f.price),
        stockInitial: Number(f.stockInitial),
        promo: {
          enabled: !!f.promoEnabled,
          buyQty: f.promoEnabled ? Number(f.promoBuyQty) : undefined,
          payAmount: f.promoEnabled ? Number(f.promoPayAmount) : undefined,
        },
      };

      const saved = await (editId ? req(`/products/${editId}`, "PUT", payload) : req("/products", "POST", payload));
      patchProduct(saved); // langsung tampil tanpa menunggu reload
      close();
      toast.success(editId ? "Produk diperbarui" : "Produk ditambahkan");
      reload();
    } catch (x) {
      toast.error(x.message);
    }
  };

  const edit = (p) => {
    setEditId(p._id);
    setF({
      name: p.name,
      category: p.category,
      price: p.price,
      stockInitial: p.stockInitial,
      promoEnabled: p.promo?.enabled || false,
      promoBuyQty: p.promo?.buyQty || "",
      promoPayAmount: p.promo?.payAmount || "",
    });
    setShow(true);
  };
  const del = async (p) => {
    if (!confirm(`Hapus ${p.name}?`)) return;
    try {
      await req(`/products/${p._id}`, "DELETE");
      removeProduct(p._id);
      reload();
    } catch (x) {
      toast.error(x.message);
    }
  };

  return (
    <>
      <div className="row-actions">
        <button className="btn ghost" style={{ backgroundColor: "white" }} onClick={() => setShow(true)}><Ic n="plus" s={18} /> Tambah produk</button>
        <button className="btn ghost" onClick={closeDay}><Ic n="moon" s={18} /> Tutup hari</button>
      </div>

      <div className="plist">
        {products.map((p) => (
          <div className="card pc" key={p._id}>
            <div className="pc-h">
              <span className="pe"><CatIcon c={p.category} s={28} /></span>
              <div className="grow"><b>{p.name}</b><br /><small className="chip">{p.category}</small></div>
              <b className="price">{rp(p.price)}</b>
            </div>
            <div className="stats4">
              <div><small>Stok awal</small><b>{p.stockInitial}</b></div>
              <div><small>Terjual</small><b>{p.sold}</b></div>
              <div className="hl"><small>Sekarang</small><b>{p.stock}</b></div>
              <div><small>Stok akhir</small><b>{p.stockEnd ?? "-"}</b></div>
            </div>
            <div className="pc-a">
              <button onClick={() => edit(p)}><Ic n="edit" s={15} /> Edit</button>
              <button className="d" onClick={() => del(p)}><Ic n="trash" s={15} /> Hapus</button>
            </div>
          </div>
        ))}
      </div>
      {!products.length && <p className="muted center">Belum ada produk.</p>}

      {show && (
        <Modal title={editId ? "Edit produk" : "Tambah produk"} onClose={close}>
          <form onSubmit={submit}>
            <label>Nama produk</label>
            <input placeholder="Mis. Nasi Goreng" value={f.name} onChange={set("name")} required />
            <label>Kategori</label>
            <select value={f.category} onChange={set("category")}><option value="makanan">Makanan</option><option value="minuman">Minuman</option></select>
            <label>Harga</label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.price} onChange={set("price")} required />
            <label>Stok awal</label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.stockInitial} onChange={set("stockInitial")} required />

            <label style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={f.promoEnabled}
                onChange={(e) => setF({ ...f, promoEnabled: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              Aktifkan Promo
            </label>

            {f.promoEnabled && (
              <div style={{ background: "var(--ty)", borderRadius: 14, padding: "12px 14px", marginTop: 8, border: "1px solid rgba(251,176,45,.4)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ marginTop: 0 }}>Beli berapa</label>
                    <input type="number" inputMode="numeric" placeholder="4" value={f.promoBuyQty} onChange={set("promoBuyQty")} required={f.promoEnabled} min={2} />
                  </div>
                  <div>
                    <label style={{ marginTop: 0 }}>Bayar (Rp)</label>
                    <input type="number" inputMode="numeric" placeholder="10000" value={f.promoPayAmount} onChange={set("promoPayAmount")} required={f.promoEnabled} />
                  </div>
                </div>
                <small style={{ color: "var(--warnt)", display: "block", marginTop: 6 }}>
                  Contoh: Beli 4 bayar 10.000 → sisa dihitung harga normal
                </small>
              </div>
            )}
            <button className="btn gold">{editId ? "Simpan perubahan" : "Tambah produk"}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Pengeluaran ----------
function Pengeluaran({ products, reload, patchTx }) {
  const blank = { description: "", amount: "", product: "", qty: "", note: "", method: "cash" };
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      const items = f.product && f.qty ? [{ product: f.product, qty: Number(f.qty) }] : [];
      const saved = await req("/transactions", "POST", {
        type: "expense",
        description: f.description,
        amount: Number(f.amount),
        items,
        note: f.note,
        method: f.method,
      });
      patchTx(saved);
      setF(blank);
      reload();
      toast.success("Pengeluaran tercatat");
    } catch (x) {
      toast.error(x.message);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <label>Keterangan</label>
      <input placeholder="Mis. Belanja bahan" value={f.description} onChange={set("description")} required />

      <label>Nominal</label>
      <input type="number" inputMode="numeric" placeholder="0" value={f.amount} onChange={set("amount")} required />

      <label>Metode pembayaran</label>
      <select value={f.method} onChange={set("method")}>
        <option value="cash">Tunai</option>
        <option value="transfer">Transfer</option>
        <option value="ewallet">E-Wallet</option>
      </select>

      <label>Tambah stok produk (opsional)</label>
      <select value={f.product} onChange={set("product")}>
        <option value="">Tidak menambah stok</option>
        {products.map((p) => (
          <option key={p._id} value={p._id}>{p.name}</option>
        ))}
      </select>

      {f.product && (
        <>
          <label>Jumlah stok dibeli</label>
          <input type="number" inputMode="numeric" value={f.qty} onChange={set("qty")} required />
        </>
      )}

      <label>Catatan</label>
      <input placeholder="Opsional" value={f.note} onChange={set("note")} />

      <button className="btn gold">Simpan pengeluaran</button>
    </form>
  );
}

// ---------- Modal edit transaksi (dipakai Riwayat & Detail) ----------
function TxEditModal({ tx, products, onClose, onSaved }) {
  const inc = tx.type === "income";
  const [items, setItems] = useState(() =>
    (tx.items || []).map((i) => ({
      product: String(i.product),
      name: i.name,
      price: i.price || 0,
      category: i.category,
      qty: i.qty,
    }))
  );
  const [itemsChanged, setItemsChanged] = useState(false);
  const [nominalTouched, setNominalTouched] = useState(false);
  const [f, setF] = useState({
    nominal: tx.total,
    note: tx.note || "",
    description: tx.description || "",
    mix: !!tx.mix,
    plastic: tx.packaging?.plastic || 0,
    cup: tx.packaging?.cup || 0,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const prodOf = (id) => products.find((p) => p._id === id);
  const computed = items.reduce(
    (sum, it) => sum + calcLineTotal({ price: it.price, promo: prodOf(it.product)?.promo }, Number(it.qty) || 0),
    0
  );
  // Penjualan: total ikut dihitung ulang dari item, kecuali nominal diubah manual
  const nominal = !inc || nominalTouched ? f.nominal : itemsChanged ? computed : tx.total;

  const updateItem = (idx, patch) => {
    setItems((l) => l.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setItemsChanged(true);
  };
  const changeProduct = (idx, id) => {
    const p = prodOf(id);
    if (p) updateItem(idx, { product: p._id, name: p.name, price: p.price, category: p.category });
  };
  const removeItem = (idx) => {
    setItems((l) => l.filter((_, i) => i !== idx));
    setItemsChanged(true);
  };
  const addItem = () => {
    const p = products[0];
    if (!p) return toast.error("Belum ada produk");
    setItems((l) => [...l, { product: p._id, name: p.name, price: p.price, category: p.category, qty: 1 }]);
    setItemsChanged(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (inc && !items.length) return toast.error("Minimal 1 item");
    if (items.some((i) => !(Number(i.qty) >= 1))) return toast.error("Jumlah tiap item minimal 1");
    try {
      const body = {
        note: f.note,
        amount: Number(nominal),
        items: items.map((i) => ({ product: i.product, qty: Number(i.qty) })),
      };
      if (!inc) {
        body.description = f.description;
      } else {
        body.mix = f.mix;
        body.packaging = { plastic: Number(f.plastic) || 0, cup: Number(f.cup) || 0 };
      }
      const saved = await req(`/transactions/${tx._id}`, "PUT", body);
      if (inc) {
        const sp = saved.packaging?.plastic ?? 0, sc = saved.packaging?.cup ?? 0;
        if (sp !== body.packaging.plastic || sc !== body.packaging.cup) {
          toast.error("Server belum menyimpan plastik/cup. Deploy ulang server.js terbaru.", { duration: 8000 });
        }
      }
      onSaved(saved);
      toast.success("Transaksi berhasil diubah");
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Modal title="Edit Transaksi" onClose={onClose}>
      <form onSubmit={submit}>
        {!inc && (
          <>
            <label>Keterangan</label>
            <input value={f.description} onChange={set("description")} required />
          </>
        )}

        <label>{inc ? "Item / produk dibeli" : "Stok produk ditambah"}</label>
        {items.map((it, idx) => (
          <div className="edit-item" key={idx}>
            <select value={it.product} onChange={(e) => changeProduct(idx, e.target.value)}>
              {!prodOf(it.product) && <option value={it.product}>{it.name} (dihapus)</option>}
              {products.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={it.qty}
              onChange={(e) => updateItem(idx, { qty: e.target.value })}
              aria-label="Jumlah"
            />
            <button type="button" className="icon-btn dark" onClick={() => removeItem(idx)} title="Hapus item">
              <Ic n="trash" s={16} />
            </button>
          </div>
        ))}
        {!items.length && <p className="muted small">Belum ada item.</p>}
        <button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={addItem}>
          <Ic n="plus" s={16} /> Tambah item
        </button>
        {inc && <small className="muted" style={{ display: "block", marginTop: 8 }}>Total dari item: {rp(computed)}</small>}

        {inc && (
          <>
            <label className="switch-row" style={{ marginTop: 8 }}>
              <span> Pesanan Mix</span>
              <input type="checkbox" checked={f.mix} onChange={(e) => setF({ ...f, mix: e.target.checked })} />
            </label>

            <div className="opt-grid">
              <div className="opt"><span>🛍️ Plastik</span><input type="number" inputMode="numeric" min="0" value={f.plastic} onChange={set("plastic")} /></div>
              <div className="opt"><span>🥤 Cup</span><input type="number" inputMode="numeric" min="0" value={f.cup} onChange={set("cup")} /></div>
            </div>
          </>
        )}

        <label>Nominal total</label>
        <input
          type="number"
          inputMode="numeric"
          value={nominal}
          onChange={(e) => { setNominalTouched(true); setF({ ...f, nominal: e.target.value }); }}
          required
        />

        <label>Catatan</label>
        <input placeholder="Opsional" value={f.note} onChange={set("note")} />

        <button className="btn gold" type="submit">Simpan Perubahan</button>
      </form>
    </Modal>
  );
}

// ---------- Riwayat ----------
function Riwayat({ txs, onEdit, onDelete, openDetail }) {
  const [range, setRange] = useState("today");
  const today = new Date().toDateString();
  const list = range === "all" ? txs : txs.filter((t) => new Date(t.createdAt).toDateString() === today);
  const inc = list.filter((t) => t.type === "income").reduce((s, t) => s + t.total, 0);
  const exp = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.total, 0);

  return (
    <>
      <div className="seg">
        <button className={range === "today" ? "on" : ""} onClick={() => setRange("today")}>Hari ini</button>
        <button className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>Semua</button>
      </div>
      <div className="sum3">
        <div className="card"><small>Pemasukan</small><b className="ok">{rp(inc)}</b></div>
        <div className="card"><small>Pengeluaran</small><b className="err">{rp(exp)}</b></div>
        <div className="card"><small>Laba</small><b>{rp(inc - exp)}</b></div>
      </div>
      {list.map((t) => (
        <TxRow key={t._id} t={t} onClick={() => openDetail(t)}>
          {(t.note || (t.type === "income" && t.method === "cash")) && (
            <small className="muted tx-sub">
              {t.type === "income" && t.method === "cash" && `Diterima ${rp(t.cashReceived)} · Kembali ${rp(t.change)}`}
              {t.note && ` · ${t.note}`}
            </small>
          )}
          <div className="pc-a" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onEdit(t)}><Ic n="edit" s={15} /> Edit</button>
            <button className="d" onClick={() => onDelete(t)}><Ic n="trash" s={15} /> Hapus</button>
          </div>
        </TxRow>
      ))}
      {!list.length && <p className="muted center">Belum ada transaksi.</p>}
    </>
  );
}

// ---------- Detail transaksi ----------
function Detail({ tx, back, onEdit, onDelete }) {
  const closeBtn = (
    <button className="icon-btn dark" onClick={back}><Ic n="x" /></button>
  );

  if (!tx) {
    return (
      <>
        <Top title="Detail Transaksi" sub="Rincian lengkap transaksi" right={closeBtn} />
        <div className="page pull"><div className="card center muted">Transaksi tidak ditemukan.</div></div>
      </>
    );
  }

  const inc = tx.type === "income";
  const items = tx.items || [];
  const itemsSum = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  const adj = inc ? itemsSum - tx.total : 0;
  const pk = tx.packaging || {};

  return (
    <>
      <Top title="Detail Transaksi" sub="Rincian lengkap transaksi" right={closeBtn} />
      <div className="page pull">
        <div className="card dt-hero">
          <span className={`tx-ic ${inc ? "in" : "outc"}${isMix(tx) ? " mix" : ""}`} style={{ width: 54, height: 54, margin: "0 auto 8px" }}>
            <TxIcon key={isMix(tx) ? "m" : "n"} t={tx} />
          </span>
          <small className="muted">{inc ? "Pemasukan" : "Pengeluaran"}{isMix(tx) ? " · Mix" : ""}</small>
          <strong className={inc ? "ok" : "err"}>{inc ? "+" : "−"}{rp(tx.total)}</strong>
          <small className="muted">
            {new Date(tx.createdAt).toLocaleString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </small>
        </div>

        {!inc && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Keterangan</h3>
            <p>{tx.description}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{inc ? "Item pesanan" : "Stok ditambah"}</h3>
            {items.map((i, idx) => (
              <div className="li" key={idx}>
                <span>
                  <CatIcon c={i.category} s={18} /> {i.name}
                  <small className="muted"> {inc ? `${rp(i.price)} × ${i.qty}` : `+${i.qty}`}</small>
                </span>
                {inc && <b>{rp(i.price * i.qty)}</b>}
              </div>
            ))}
            {inc && adj > 0 && (
              <div className="li"><span className="muted">Potongan promo / nominal custom</span><b className="ok">−{rp(adj)}</b></div>
            )}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Pembayaran</h3>
          <div className="li"><span className="muted">Metode</span><b>{methodLabel(tx.method)}</b></div>
          <div className="li"><span className="muted">Total</span><b>{rp(tx.total)}</b></div>
          {inc && tx.method === "cash" && (
            <>
              <div className="li"><span className="muted">Diterima</span><b>{rp(tx.cashReceived)}</b></div>
              <div className="li"><span className="muted">Kembalian</span><b className="ok">{rp(tx.change)}</b></div>
            </>
          )}
        </div>

        {inc && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Tambahan</h3>
            <div className="li"><span className="muted">Pesanan mix</span><b>{isMix(tx) ? "Ya" : "Tidak"}</b></div>
            <div className="li"><span className="muted">🛍️ Plastik</span><b>{pk.plastic || 0}</b></div>
            <div className="li"><span className="muted">🥤 Cup</span><b>{pk.cup || 0}</b></div>
          </div>
        )}

        {tx.note && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Catatan</h3>
            <p>{tx.note}</p>
          </div>
        )}

        <div className="row-actions">
          <button className="btn ghost" onClick={() => onEdit(tx)}><Ic n="edit" s={16} /> Edit</button>
          <button className="btn ghost" style={{ color: "var(--err)" }} onClick={() => onDelete(tx, back)}><Ic n="trash" s={16} /> Hapus</button>
        </div>
      </div>
    </>
  );
}

// ---------- App ----------
const upsert = (list, item) => {
  const i = list.findIndex((x) => x._id === item._id);
  if (i < 0) return [item, ...list];
  const n = [...list];
  n[i] = item;
  return n;
};

const DEFAULT_SETTINGS = {
  hideNominal: false,
  hidePengeluaran: false,
  hideLaba: false,
  maxRiwayatBeranda: 5,
  filterJenis: "all",
  filterKategori: "all",
};

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("pos_pass"));
  const [tab, setTab] = useState("home");
  const [backTab, setBackTab] = useState("riwayat");
  const [detailId, setDetailId] = useState(null);
  const [products, setProducts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [showLogout, setShowLogout] = useState(false);
  const [editTx, setEditTx] = useState(null);

  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem("pos_settings")) || {}) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    localStorage.setItem("pos_settings", JSON.stringify(settings));
  }, [settings]);

  const logout = () => { localStorage.removeItem("pos_pass"); setShowLogout(false); setAuthed(false); setTab("home"); };
  const lastChange = useRef(0);
  const touch = () => { lastChange.current = Date.now(); };

  const reload = async () => {
    const startedAt = Date.now();
    try {
      const [p, t] = await Promise.all([req("/products"), req("/transactions")]);
      if (startedAt < lastChange.current) return; // data lama, sudah ada perubahan yang lebih baru
      setProducts(Array.isArray(p) ? p.filter((x) => x && x.name) : []);
      setTxs(Array.isArray(t) ? t : []);
    } catch (e) {
      if (e.status === 401) logout();
      else toast.error(e.message);
    }
  };

  const patchTx = (t) => { touch(); setTxs((l) => upsert(l, t)); };
  const patchProduct = (p) => { touch(); setProducts((l) => upsert(l, p).sort((a, b) => a.name.localeCompare(b.name))); };
  const removeProduct = (id) => { touch(); setProducts((l) => l.filter((x) => x._id !== id)); };

  // Reload tiap kali pindah halaman / setelah login
  useEffect(() => {
    if (authed) reload();
  }, [authed, tab]);

  const openDetail = (t) => {
    setBackTab(tab === "detail" ? backTab : tab);
    setDetailId(t._id);
    setTab("detail");
  };

  const deleteTx = (t, after) =>
    confirmToast({
      title: "Hapus transaksi?",
      desc: "Stok akan dikembalikan.",
      okText: "Ya, Hapus",
      danger: true,
      onOk: async () => {
        try {
          await req(`/transactions/${t._id}`, "DELETE");
          touch(); setTxs((l) => l.filter((x) => x._id !== t._id));
          toast.success("Transaksi dihapus");
          after?.();
          await reload();
        } catch (e) {
          toast.error(e.message);
        }
      },
    });

  const closeDay = () =>
    confirmToast({
      title: "Tutup hari sekarang?",
      desc: "Stok sekarang akan disimpan sebagai Stok Akhir dan menjadi Stok Awal besok.",
      okText: "Ya, Tutup",
      onOk: async () => {
        try {
          await req("/close-day", "POST");
          await reload();
          toast.success("Hari berhasil ditutup");
        } catch (e) {
          toast.error(e.message);
        }
      },
    });

  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const titles = {
    kasir: ["Kasir", "Pilih produk & terima pembayaran"],
    produk: ["Produk", "Kelola menu & stok"],
    keluar: ["Pengeluaran", "Catat biaya & belanja stok"],
    riwayat: ["Riwayat", "Semua transaksi tokomu"],
  };
  const nav = [
    { key: "home", label: "Beranda", img: "/beranda.png" },
    { key: "produk", label: "Produk", img: "/produk.png" },
    { key: "kasir", label: "Kasir", img: "/kasir2.png" },
    { key: "keluar", label: "Belanja", img: "/keranjang.png" },
    { key: "riwayat", label: "Riwayat", img: "/riwayat.png" },
  ];
  const activeKey = tab === "detail" ? backTab : tab;
  const detailTx = txs.find((t) => t._id === detailId);

  return (
    <div className="app">
      {tab === "home" ? (
        <Beranda txs={txs} products={products} go={setTab} closeDay={closeDay} askLogout={() => setShowLogout(true)} openDetail={openDetail} settings={settings} />
      ) : tab === "setting" ? (
        <Setting settings={settings} setSettings={setSettings} go={setTab} />
      ) : tab === "detail" ? (
        <Detail tx={detailTx} back={() => setTab(backTab)} onEdit={setEditTx} onDelete={deleteTx} />
      ) : (
        <>
          <Top title={titles[tab][0]} sub={titles[tab][1]} />
          <div className="page pull">
            {tab === "kasir" && <Kasir products={products} reload={reload} patchTx={patchTx} />}
            {tab === "produk" && <Produk products={products} reload={reload} closeDay={closeDay} patchProduct={patchProduct} removeProduct={removeProduct} />}
            {tab === "keluar" && <Pengeluaran products={products} reload={reload} patchTx={patchTx} />}
            {tab === "riwayat" && <Riwayat txs={txs} onEdit={setEditTx} onDelete={deleteTx} openDetail={openDetail} />}
          </div>
        </>
      )}

      <nav className="nav">
        {nav.map((n) => (
          <button
            key={n.key}
            className={(activeKey === n.key ? "on " : "") + (n.key === "kasir" ? "mid" : "")}
            onClick={() => setTab(n.key)}
          >
            <span className="ni">
              <img src={n.img} alt={n.label} style={{ width: n.key === "kasir" ? 30 : 24, height: n.key === "kasir" ? 30 : 24, objectFit: "contain" }} />
            </span>
            <small>{n.label}</small>
          </button>
        ))}
      </nav>

      {editTx && (
        <TxEditModal
          key={editTx._id}
          tx={editTx}
          products={products}
          onClose={() => setEditTx(null)}
          onSaved={(saved) => { patchTx(saved); reload(); }}
        />
      )}

      {showLogout && (
        <div className="modal-wrap center-m" onClick={() => setShowLogout(false)}>
          <div className="modal success" onClick={(e) => e.stopPropagation()}>
            <div className="logout-ic"><Ic n="logout" s={30} /></div>
            <h3>Keluar dari aplikasi?</h3>
            <p className="muted small">Kamu perlu memasukkan password lagi untuk masuk kembali.</p>
            <div className="row-actions" style={{ marginTop: 18 }}>
              <button className="btn ghost" onClick={() => setShowLogout(false)}>Batal</button>
              <button className="btn gold" style={{ background: "var(--err)" }} onClick={logout}>Ya, Keluar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}