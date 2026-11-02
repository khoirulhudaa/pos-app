import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { downloadReceipt } from "./receipt";
import { LangCtx, makeT, useT } from "./I18n";
import { extractTextFromPdf } from "./pdfHelper";
import "./extra.css";
import HourlyChartNew from "./Hourlychart";
import { downloadRecapPdf } from "./recap";

// Tanggal lokal "YYYY-MM-DD" (dipakai filter kalender)
const toKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// Pengeluaran permanen: dihitung setiap hari sejak tanggal dibuat
const dayStart = (key) => new Date(key + "T00:00:00");
const daysBetween = (fromKey, toKeyStr) => Math.round((dayStart(toKeyStr) - dayStart(fromKey)) / 86400000) + 1;

// Total pengeluaran satu hari (biasa + permanen yang sudah berjalan)
const expenseOn = (txs, key) => {
  let normal = 0, perm = 0;
  txs.forEach((x) => {
    if (x.type !== "expense") return;
    const k = toKey(x.createdAt);
    if (x.permanent) { if (k <= key) perm += x.total; }
    else if (k === key) normal += x.total;
  });
  return { total: normal + perm, perm };
};

// Total pengeluaran seluruh waktu (permanen dikali jumlah hari berjalan)
const expenseAll = (txs) => {
  const today = toKey(new Date());
  let normal = 0, perm = 0;
  txs.forEach((x) => {
    if (x.type !== "expense") return;
    if (x.permanent) perm += x.total * Math.max(1, daysBetween(toKey(x.createdAt), today));
    else normal += x.total;
  });
  return { total: normal + perm, perm };
};

const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const methodLabel = (m, t) =>
  m === "qris" ? t("qris") : m === "transfer" ? t("transfer") : m === "ewallet" ? t("ewallet") : t("cash");

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
  monitor: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8 21h8 M12 17v4 M3 3l18 18",
  view1: "M4 5h16v14H4z",
  view2: "M4 5h7v14H4z M13 5h7v14h-7z",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  send: "M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z", 
  up: "M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  plus: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 12h8 M12 8v8",
  repeat: "M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  check: "M20 6L9 17l-5-5",
  trash: "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  edit: "M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  x: "M18 6L6 18 M6 6l12 12",
  sparkles: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z M20 3v4 M22 5h-4 M4 17v2 M5 18H3",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35",
  calendar: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
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
  if (!r.ok) throw Object.assign(new Error(d.message || "Error"), { status: r.status });
  return d;
}

// ---------- Konfirmasi pakai react-hot-toast ----------
const confirmToast = ({ title, desc, okText = "OK", cancelText = "Cancel", danger = false, onOk }) =>
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
            {cancelText}
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

// Tampilan terkunci saat toko tutup
const Locked = ({ openDay, text }) => {
  const { t } = useT();
  return (
    <div className="card locked">
      <img src="/close2.png" alt={t("closedTitle")} />
      <h3>{t("closedTitle")}</h3>
      <p className="muted small">{text}</p>
      <button className="btn gold" onClick={openDay}>{t("reopenShop")}</button>
    </div>
  );
};

const Modal = ({ title, onClose, children }) => (
  <div className="modal-wrap" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-h"><h3>{title}</h3><button className="icon-btn dark" onClick={onClose}><Ic n="x" /></button></div>
      {children}
    </div>
  </div>
);

// Pilihan refund saat menghapus transaksi (pilih salah satu)
function RefundPicker({ value, onChange }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const opts = [
    ["stock", tl("Refund produk", "Refund products"), ""],
    ["full", tl("Refund produk + uang", "Refund products + money"), ""],
    ["none", tl("Hapus data saja", "Delete data only"), ""],
  ];
  return (
    <div className="refund-list">
      {opts.map(([k, label, hint]) => (
        <label key={k} className={"refund-opt" + (value === k ? " on" : "")}>
          <input type="radio" name="refund-mode" checked={value === k} onChange={() => onChange(k)} />
          <div><b>{label}</b><small>{hint}</small></div>
        </label>
      ))}
    </div>
  );
}

// Konfirmasi di tengah layar (tampilan sama seperti modal logout)
function ConfirmModal({ icon = "trash", title, desc, okText, cancelText, onOk, onClose, refund = null }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(refund?.defaultMode || "none");
  const ok = async () => {
    if (busy) return;
    setBusy(true);
    await onOk(mode);
    onClose();
  };
  return (
    <div className="modal-wrap center-m" onClick={onClose}>
      <div className="modal success" onClick={(e) => e.stopPropagation()}>
        <div className="logout-ic"><Ic n={icon} s={30} /></div>
        <div style={{ height: 8 }} />
        <h3>{title}</h3>
        {desc && <p className="muted small">{desc}</p>}
        {refund && <RefundPicker value={mode} onChange={setMode} />}
        <div className="row-actions-2" style={{ marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>{cancelText}</button>
          <button className="btn gold" style={{ background: "var(--err)" }} disabled={busy} onClick={ok}>{okText}</button>
        </div>
      </div>
    </div>
  );
}

// Tampilan kosong (menggantikan teks polos)
function EmptyState({ img, icon = "list", title, desc, actionText, onAction }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="empty-state">
      <div className="empty-ic">
        {img && !failed ? <img src={img} alt="" onError={() => setFailed(true)} /> : <Ic n={icon} s={34} />}
      </div>
      <h4>{title}</h4>
      {desc && <p>{desc}</p>}
    </div>
  );
}

// Modal reset riwayat (wajib password)
function ResetHistoryModal({ onClose, onDone }) {
  const { t, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await req("/reset-history", "POST", { password: pw });
      toast.success(tl(`${r.deletedCount} transaksi dihapus`, `${r.deletedCount} transactions deleted`));
      onDone();
      onClose();
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  };

  return (
    <div className="modal-wrap center-m" onClick={onClose}>
      <div className="modal success" style={{ paddingTop: 32 }} onClick={(e) => e.stopPropagation()}>
        <div className="logout-ic"><Ic n="trash" s={30} /></div>
        <h3>{tl("Reset Semua Riwayat?", "Reset All History?")}</h3>
        <p className="muted small" style={{marginBottom: 16}}>
          {tl(
            "Semua transaksi akan dihapus permanen",
            "All transaction will be deleted"
          )}
        </p>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder={tl("Password reset", "Reset password")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            required
          />
          {err && <p className="err small">{err}</p>}
          <div className="row-actions-2" style={{ marginTop: 5 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn gold" style={{ background: "var(--err)" }} disabled={busy || !pw}>
              {busy ? "..." : tl("Reset", "Reset")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Login({ onOk }) {
  const { t } = useT();
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
      await req("/products");          // cek password valid
      await req("/login", "POST");     // catat log login (password ikut ke header x-pass)
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
          <h1>Kasir Memayu</h1>
          <p>{t("loginTagline")}</p>
        </div>

        <form className="login-card" onSubmit={submit}>
          <label>{t("password")}</label>
          <input
            type="password"
            placeholder={t("passwordPh")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          {err && <p className="err small">{err}</p>}
          <button className="btn gold" type="submit">
            {t("loginBtn")}
          </button>
        </form>

        {showInstall && (
          <div className="install-box">
            <button className="btn gold install-btn" onClick={installApp}>
              {t("install")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityLogPage({ go }) {
  const { t, locale, lang } = useT();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await req("/logs?limit=150");
        if (alive) setLogs(Array.isArray(data) ? data : []);
      } catch (e) {
        toast.error(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const actionLabel = (a) => {
    const map = {
      login: t("logLogin"),
      logout: t("logLogout") || "Logout",
      create_product: t("logCreateProduct"),
      edit_product: t("logEditProduct"),
      change_fund: lang === "en" ? "Change" : "Kembalian",
      reset_history: "Reset",
      delete_product: t("logDeleteProduct") || "Hapus produk",
      create_payment: t("logCreatePayment"),
      edit_transaction: t("logEditTx"),
      delete_transaction: t("logDeleteTx") || "Hapus transaksi",
    };
    return map[a] || a;
  };

  const actionColor = (a) => {
    if (a === "login") return "var(--muted)";
    if (a === "create_product" || a === "create_payment") return "var(--ok)";
    if (a === "edit_product" || a === "edit_transaction") return "#0a66c2";
    if (a === "reset_history") return "var(--err)";
    if (a === "change_fund") return "#f59e0b";
    return "var(--muted)";
  };

  return (
    <>
      <Top
        title={t("activityLog")}
        sub={t("activityLogSub")}
        right={<button className="icon-btn dark" onClick={() => go("setting")}><Ic n="x" /></button>}
      />
      <div className="page pull">
        {loading && <p className="muted center">...</p>}
        {!loading && !logs.length && <p className="muted center" style={{marginTop: 120}}>{t("noLogs")}</p>}
        {logs.map((log) => (
          <div className="card tx" key={log._id}>
            <div className="tx-main">
              <span
                className="tx-ic"
                style={{
                  background: actionColor(log.action) + "22",
                  color: actionColor(log.action),
                  fontSize: 11,
                  fontWeight: 700,
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {actionLabel(log.action).slice(0, 3).toUpperCase()}
              </span>
              <div className="grow">
                <b className="tx-t">{log.summary}</b>
                <small className="muted">
                  {new Date(log.createdAt).toLocaleString(locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                  {log.meta?.password && (
                    <> · <b>{log.meta.password}</b></>
                  )}
                  {log.meta?.account && !log.meta?.password && (
                    <> · {log.meta.account}</>
                  )}
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
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
      style={{ width: s, height: s, objectFit: "contain", verticalAlign: "middle", flexShrink: 0 }}
    />
  );
}

// Mix = diceklis mix, ATAU isinya campur makanan + minuman
const isMix = (t) =>
  !!t.mix || new Set((t.items || []).filter((i) => !i.custom).map((i) => i.category)).size > 1;

// ---------- Ikon transaksi (mix pakai /mix.png) ----------
function TxIcon({ t }) {
  const [failed, setFailed] = useState(false);
  const mixed = isMix(t);
  const other = t.type === "expense" && (t.expenseItems || []).length > 0 && !mixed; // belanja custom (lama)
  // Pengeluaran non-belanja: tanpa produk, tanpa jumlah belanja, tanpa item belanja custom
  const nonShop =
    t.type === "expense" &&
    !(t.items || []).length &&
    !(t.buyQty > 0) &&
    !(t.expenseItems || []).length;
  const src = nonShop ? "/candy.png" : mixed ? "/mix.png" : other ? "/other.png" : "/drink.png";
  if (failed) return <span style={{ fontSize: 20 }}>{nonShop ? "🍬" : mixed ? "" : "🍜"}</span>;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: 24, height: 24, objectFit: "contain", transform: other || nonShop ? undefined : "rotate(20deg)" }}
    />
  );
}

function TxRow({ t, children, onClick }) {
  const { t: tr, locale, lang } = useT();
  const inc = t.type === "income";
  const pk = t.packaging || {};
  return (
    <div className={"card tx" + (onClick ? " clickable" : "")} onClick={onClick}>
      <div className="tx-main">
        <span className={`tx-ic ${inc ? "in" : "outc"}${isMix(t) ? " mix" : ""}`}>
          <TxIcon key={isMix(t) ? "m" : "n"} t={t} />
        </span>
        <div className="grow">
          <div className="tx-name">
            <b className="tx-t">
              {inc ? (t.items || []).map((i) => `${i.name}${i.raw ? ` (${lang === "en" ? "not brewed" : "tanpa seduh"})` : ""} ×${i.qty}`).join(", ") : t.description}
            </b>
            {!inc && t.permanent && (
              <span className="perm-ic" title={lang === "en" ? "Permanent expense" : "Pengeluaran permanen"}>
                <Ic n="repeat" s={11} />
              </span>
            )}
          </div>
          <small className="muted">
            {new Date(t.createdAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {(inc || t.method) && `, ${methodLabel(t.method, tr)}`}
            {t._id && (
              <span>
                {", "}
                {String(t._id).slice(-5)}
              </span>
            )}
          </small>
          {inc && (isMix(t) || pk.plastic > 0 || pk.cup > 0) ? (
            <div className="tags">
              {isMix(t) && <span className="mix-chip">{tr("mixTag")}</span>}
              {pk.plastic > 0 && <span className="pk-chip plastic">🛍️ P×{pk.plastic}</span>}
              {pk.cup > 0 && <span className="pk-chip cup">🥤 C×{pk.cup}</span>}
            </div>
          ) : (
            <div className="tags">
              <span className="mix-chip">{tr("normalTag")}</span>
              <span className="pk-chip plastic">🛍️ {0}</span>
              <span className="pk-chip cup">🥤 {0}</span>
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

// ---------- Daftar stok menipis (ramping) ----------
const LOW_LIMIT = 5;

// Nomor HP Indonesia -> format wa.me (08xx -> 628xx)
const waNumber = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d;
};
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

// Rekomendasi penjual untuk satu produk yang stoknya menipis
function SupplierReco({ product, suppliers = [], go }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const list = suppliers.filter((s) => (s.products || []).includes(product._id));
  const msg = (s) =>
    tl(
      `Halo ${s.name}, stok ${product.name} saya tinggal ${product.stock}. Apakah tersedia untuk dipesan?`,
      `Hi ${s.name}, my stock of ${product.name} is down to ${product.stock}. Is it available to order?`
    );
  if (!list.length) {
    return (
      <button type="button" className="reco-none" onClick={() => go("suppliers")}>
        <Ic n="users" s={13} /> {tl("Belum ada penjual untuk produk ini · Tambah", "No supplier for this product · Add one")}
      </button>
    );
  }
  return (
    <div className="reco">
      <small className="muted">{tl("Hubungi penjual:", "Contact supplier:")}</small>
      <div className="reco-list">
        {list.map((s) =>
          s.phone ? (
            <a key={s._id} className="reco-chip" href={waLink(s.phone, msg(s))} target="_blank" rel="noreferrer">
              <Ic n="send" s={12} /> {s.name}
            </a>
          ) : (
            <span key={s._id} className="reco-chip off">{s.name} · {tl("tanpa nomor", "no number")}</span>
          )
        )}
      </div>
    </div>
  );
}

// ---------- Beranda ----------
function Beranda({ txs, products, suppliers = [], go, closeDay, openDay, closed, askLogout, openDetail, settings = {}, setSettings, fund, openFund }) {
  const { t, locale, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const { hideLaba = false, hidePengeluaran = false, hideTransaksi = false } = settings;

  // Filter tanggal untuk kartu laba / pemasukan / pengeluaran / transaksi (null = hari ini)
  const [pick, setPick] = useState(null);
  const dateRef = useRef(null);
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    if (el.showPicker) el.showPicker();
    else el.click();
  };
  const todayKey = toKey(new Date());
  const date = pick || todayKey;
  const isToday = date === todayKey;
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  const tt = txs.filter((x) => toKey(x.createdAt) === date);
  const inc = tt.filter((x) => x.type === "income").reduce((s, x) => s + x.total, 0);
  // const exp = tt.filter((x) => x.type === "expense").reduce((s, x) => s + x.total, 0);
  const exp = expenseOn(txs, date).total;
  const low = products.filter((p) => p.stock < LOW_LIMIT);
  const h = new Date().getHours();
  const greet = h < 11 ? t("greetMorning") : h < 15 ? t("greetNoon") : h < 18 ? t("greetAfternoon") : t("greetNight");
  const menu = [
    { img: "/kasir2.png", label: t("menuCashier"), fn: () => go("kasir") },
    { img: "/produk.png", label: t("menuProducts"), fn: () => go("produk") },
    { img: "/keranjang.png", label: t("menuShopping"), fn: () => go("keluar") },
    { img: "/riwayat.png", label: t("menuHistory"), fn: () => go("riwayat") },
    closed
      ? { img: "/close2.png", label: t("menuOpen"), fn: openDay }
      : { img: "/tutup.png", label: t("menuClose"), fn: closeDay },
  ];

  let filteredTxs = [...txs];
  if (settings.filterJenis !== "all") filteredTxs = filteredTxs.filter((x) => x.type === settings.filterJenis);
  if (settings.filterKategori !== "all") {
    filteredTxs = filteredTxs.filter((x) => x.items?.some((i) => i.category === settings.filterKategori));
  }
  const displayTxs = filteredTxs.slice(0, settings.maxRiwayatBeranda);

  const money = (value) => (settings.hideNominal ? "••••••" : rp(value));
  const fundMoney = (value) => (settings.hideNominal || settings.hideKembalian ? "••••••" : rp(value));

  return (
    <>
      <div className="hero">
        <div className="hero-row">
          <div className="avatar">
            <img src="/avatar2.png" alt="avatar-img" style={{width: '80%', position: 'relative', top: 4}} />
          </div>
          <div className="grow">
            <small>{greet},</small>
            <b>{t("owner")}</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{ borderRadius: "9999px", position: "relative" }}
              className={"icon-btn" + (!isToday ? " active" : "")}
              onClick={openPicker}
              title={t("filterDate")}
            >
              <Ic n="calendar" />
              <input
                ref={dateRef}
                type="date"
                className="date-hidden"
                value={date}
                max={todayKey}
                tabIndex={-1}
                aria-label={t("pickDate")}
                onChange={(e) => setPick(e.target.value && e.target.value !== todayKey ? e.target.value : null)}
              />
            </button>
            <button style={{ borderRadius: "9999px" }} className="icon-btn" onClick={() => go("setting")} title={t("settings")}>
              <Ic n="settings" />
            </button>
            <button style={{ borderRadius: "9999px" }} className="icon-btn" onClick={askLogout} title={t("logout")}>
              <Ic n="logout" />
            </button>
          </div>
        </div>
        <div className="balance">
          <div className="bal-head">
            <span>{isToday ? t("profitToday") : t("profitOn", { date: dateLabel })}</span>
          </div>
          <strong>{hideLaba ? "••••••" : money(inc - exp)}</strong>
          <div className="bal-row">
            <div><small>{t("income")}</small><b className="ok">{money(inc)}</b></div>
            <div><small>{t("expense")}</small><b className="err">{hidePengeluaran ? "••••••" : money(exp)}</b></div>
            <div><small>{t("transactions")}</small><b>{hideTransaksi ? "••••" : tt.length}</b></div>
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

        <ChangeFundCard fund={fund} money={fundMoney} onManage={openFund} />

        {closed && (
          <div className="card warn">
            <div className="warn-h"><img src="/close2.png" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} /> {t("closedTitle")}</div>
            <small className="muted">{t("shopClosedDesc")}</small>
          </div>
        )}

        {low.length > 0 && (
          <div className="card warn">
            <div className="warn-h"><Ic n="alert" s={18} /> {t("stockLow")}</div>
            {low.slice(0, 5).map((p) => (
              <div key={p._id}>
                <div className="li"><span><CatIcon c={p.category} s={18} /> {p.name}</span><b className="err">{t("remaining")} {p.stock}</b></div>
                <SupplierReco product={p} suppliers={suppliers} go={go} />
              </div>
            ))}
          </div>
        )}

        <HourlyChartNew
          txs={tt}
          hidden={!!settings.hideChart}
          onToggle={() => setSettings((p) => ({ ...p, hideChart: !p.hideChart }))}
        />

        <div className="sec-h"><h3>{t("latestTx")}</h3></div>
        {displayTxs.map((x) => (
          <TxRow key={x._id} t={x} onClick={() => openDetail(x)} />
        ))}
        {!displayTxs.length && (
          <EmptyState
            img="/riwayat.png"
            icon="list"
            title={t("noTx")}
            desc={tl("Transaksi hari ini akan muncul di sini.", "Today's transactions will show up here.")}
            // actionText={closed ? undefined : tl("Buka Kasir", "Open Cashier")}
            onAction={() => go("kasir")}
          />
        )}
      </div>
    </>
  );
}

// ---------- Manajemen kembalian ----------
function ChangeFundCard({ fund, money, onManage }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  if (!fund) return null;
  const empty = fund.balance <= 0;
  return (
    <div className={"card cf-card" + (empty ? " empty" : "")}>
      <div className="cf-h">
        <span className="cf-ic"><Ic n="wallet" s={16} /></span>
        <b>{tl("Uang Kembalian", "Change Float")}</b>
        <button
          type="button"
          className="cf-add"
          onClick={onManage}
          title={tl("Atur kembalian", "Manage change")}
          aria-label={tl("Atur kembalian", "Manage change")}
        >
          <Ic n="plus" s={16} />
        </button>
      </div>
      <strong className="cf-bal">{money(fund.balance)}</strong>
      <div className="cf-stats">
        <div><small>{tl("Modal awal", "Opening")}</small><b>{money(fund.initial)}</b></div>
        <div><small>{tl("Penjualan tunai", "Cash sales")}</small><b className="ok">{money(fund.sales)}</b></div>
        <div><small>{tl("Tambahan", "Added")}</small><b>{money(fund.added)}</b></div>
        {/* <div><small>{tl("Sumber lain", "Other source")}</small><b className={fund.otherUsed > 0 ? "err" : ""}>{money(fund.otherUsed)}</b></div> */}
      </div>
    </div>
  );
}

function ChangeFundModal({ fund, onClose, onSaved }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [mode, setMode] = useState("add");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await req("/change-fund", "POST", { mode, amount: Number(amount) });
      onSaved(saved);
      toast.success(tl("Uang kembalian diperbarui", "Change float updated"));
      onClose();
    } catch (x) {
      toast.error(x.message);
    }
    setBusy(false);
  };

  return (
    <Modal title={tl("Manajemen Kembalian", "Change Management")} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="cf-split" style={{ marginTop: 0 }}>
          <div><span>{tl("Sisa stok kembalian", "Current float")}</span><b>{rp(fund?.balance)}</b></div>
          {fund?.otherUsed > 0 && (
            <div><span>{tl("Sudah diambil dari sumber lain", "Taken from other source")}</span><b className="err">{rp(fund.otherUsed)}</b></div>
          )}
        </div>

        <div className="seg" style={{ marginTop: 12 }}>
          <button type="button" className={mode === "add" ? "on" : ""} onClick={() => setMode("add")}>{tl("Tambah", "Top up")}</button>
          <button type="button" className={mode === "set" ? "on" : ""} onClick={() => setMode("set")}>{tl("Atur ulang", "Reset")}</button>
        </div>

        <label>{mode === "add" ? tl("Tambah uang kembalian (Rp)", "Add change (Rp)") : tl("Modal kembalian baru (Rp)", "New float (Rp)")}</label>
        <input
          type="number"
          inputMode="numeric"
          min={mode === "add" ? 1 : 0}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          autoFocus
        />
        <div className="chips">
          {[20000, 50000, 100000, 200000].map((n) => (
            <button type="button" key={n} onClick={() => setAmount(String(n))}>{rp(n)}</button>
          ))}
        </div>
        <small className="muted" style={{ display: "block", marginTop: 8 }}>
          {mode === "add"
            ? tl("Menambah ke sisa stok kembalian yang sekarang.", "Adds to the current float.")
            : tl("Mengganti sisa stok dengan nominal ini & mengosongkan hitungan 'sumber lain'.", "Replaces the current float and clears the 'other source' counter.")}
        </small>

        <button className="btn gold" disabled={busy}>{tl("Simpan", "Save")}</button>
      </form>
    </Modal>
  );
}

// Dialog buka toko + modal kembalian
function OpenDayModal({ fund, onClose, onConfirm }) {
  const { t, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [amount, setAmount] = useState(fund ? String(fund.balance) : "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await onConfirm(amount === "" ? undefined : Number(amount));
    setBusy(false);
  };

  return (
    <Modal title={t("reopenTitle")} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted small" style={{ marginTop: 0 }}>{t("reopenDesc")}</p>
        <label>{tl("Modal uang kembalian hari ini (Rp)", "Today's change float (Rp)")}</label>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
        <small className="muted" style={{ display: "block", marginTop: 6 }}>
          {tl("Terisi otomatis dengan sisa kemarin. Kosongkan untuk tidak mengubah.", "Prefilled with yesterday's remaining. Leave empty to keep it unchanged.")}
        </small>
        <div className="row-actions-2" style={{ marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button>
          <button className="btn gold" disabled={busy}>{t("yesOpen")}</button>
        </div>
      </form>
    </Modal>
  );
}

// Rincian asal kembalian (dipakai di PaymentSuccess & Detail)
function ChangeSourceRows({ tx }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const s = tx?.changeSource;
  if (!s || !(s.stock > 0 || s.other > 0)) return null;
  return (
    <>
      <div className="li"><span className="muted">{tl("Kembalian dari stok", "Change from float")}</span><b>{rp(s.stock)}</b></div>
      {s.other > 0 && (
        <div className="li"><span className="muted">{tl("Kembalian dari sumber lain", "Change from other source")}</span><b className="err">{rp(s.other)}</b></div>
      )}
    </>
  );
}

// Kumpulkan data satu hari untuk rekap
function buildRecap(txs, key) {
  const byTime = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  const sales = txs.filter((x) => x.type === "income" && toKey(x.createdAt) === key).sort(byTime);
  const exps = txs
    .filter((x) => x.type === "expense" && (x.permanent ? toKey(x.createdAt) <= key : toKey(x.createdAt) === key))
    .sort(byTime);
  return {
    sales,
    exps,
    income: sales.reduce((s, x) => s + x.total, 0),
    expense: expenseOn(txs, key).total,
  };
}

function Setting({ settings, setSettings, go, onReset, txs = [] }) {
  const { t, lang } = useT();
  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const [srv, setSrv] = useState("cek");
  useEffect(() => {
    fetch("/api/products", { cache: "no-store", headers: { "x-pass": localStorage.getItem("pos_pass") || "" } })
      .then((r) => setSrv(r.headers.get("x-packaging-schema") === "true" ? "ok" : "lama"))
      .catch(() => setSrv("gagal"));
  }, []);
  const [showReset, setShowReset] = useState(false);
  const [recapDate, setRecapDate] = useState(toKey(new Date()));
  const [uploading, setUploading] = useState(false);

  // ===== fungsi upload & restore =====
  const handleUploadRecap = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset input

    setUploading(true);
    const toastId = toast.loading(lang === "en" ? "Reading PDF..." : "Membaca PDF...");

    try {
      const text = await extractTextFromPdf(file);

      // Cari marker
      const startMarker = "---REKAP-DATA-START---";
      const endMarker = "---REKAP-DATA-END---";

      const startIdx = text.indexOf(startMarker);
      const endIdx = text.indexOf(endMarker);

      if (startIdx === -1 || endIdx === -1) {
        throw new Error(
          lang === "en"
            ? "This PDF does not contain restore data"
            : "PDF ini tidak mengandung data restore"
        );
      }

      // Ambil teks di antara marker
      let jsonRaw = text
        .substring(startIdx + startMarker.length, endIdx)
        .trim();

      // Bersihkan karakter yang sering merusak JSON
      jsonRaw = jsonRaw
        .replace(/\u00A0/g, " ")      // non-breaking space
        .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
        .replace(/\s+/g, " ")         // spasi ganda
        .trim();

      let payload;
      try {
        payload = JSON.parse(jsonRaw);
      } catch (err) {
        console.error("JSON yang gagal diparse:", jsonRaw.slice(0, 300));
        throw new Error(
          lang === "en" ? "Invalid data inside PDF" : "Data di dalam PDF rusak"
        );
      }

      const allTx = [...(payload.sales || []), ...(payload.exps || [])];
      if (!allTx.length) {
        throw new Error(lang === "en" ? "No transactions found" : "Tidak ada transaksi di PDF");
      }

      const result = await req("/import-transactions", "POST", {
        transactions: allTx,
        key: payload.key,
        restore: true,
      });

      toast.success(
        lang === "en"
          ? `Successfully restored ${result.imported} transactions`
          : `Berhasil memulihkan ${result.imported} transaksi`,
        { id: toastId }
      );

      // refresh data di App
      if (onReset) onReset();
    } catch (err) {
      console.error(err);
      toast.error(
        (lang === "en" ? "Failed to restore: " : "Gagal memulihkan: ") + (err.message || ""),
        { id: toastId }
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Top
        title={t("settings")}
        sub={t("settingsSub")}
        right={<button className="icon-btn dark" onClick={() => go("home")}><Ic n="x" /></button>}
      />

      <div className="page pull">
        <div className="card">
          <h3>{t("language")}</h3>
          <small className="muted">{t("languageDesc")}</small>
          <div className="seg lang-seg">
            <button className={lang === "id" ? "on" : ""} onClick={() => update("lang", "id")}>Indonesia</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => update("lang", "en")}>English</button>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{t("activityLog")}</h3>
          <small className="muted" style={{ display: "block", marginBottom: 12 }}>
            {t("activityLogSub")}
          </small>
          <button
            className="btn ghost"
            style={{
              width: "100%",
              background: "transparent",
              border: "1.5px solid var(--border, #cbd5e1)",
              color: "inherit",
              fontWeight: 600,
              fontSize: 14
            }}
            onClick={() => go("logs")}
          >
            {t("goToLogs")}
          </button>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{lang === "en" ? "Suppliers" : "Kontak Penjual"}</h3>
          <small className="muted" style={{ display: "block", marginBottom: 12 }}>
            {lang === "en" ? "Save supplier contacts for restocking." : "Simpan kontak penjual bahan baku untuk belanja stok."}
          </small>
          <button className="btn ghost" style={{ width: "100%", background: "transparent", border: "1.5px solid var(--border, #cbd5e1)", color: "inherit", fontWeight: 600, fontSize: 14 }} onClick={() => go("suppliers")}>
            {lang === "en" ? "Manage suppliers" : "Kelola kontak penjual"}
          </button>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 16 }}>{t("privacy")}</h3>

          <label className="switch-row">
            <span>{t("hideAll")}</span>
            <input type="checkbox" checked={settings.hideNominal} onChange={(e) => update("hideNominal", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>{t("hideExp")}</span>
            <input type="checkbox" checked={settings.hidePengeluaran} onChange={(e) => update("hidePengeluaran", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>{t("hideProfit")}</span>
            <input type="checkbox" checked={settings.hideLaba} onChange={(e) => update("hideLaba", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>{t("hideTxCount")}</span>
            <input type="checkbox" checked={settings.hideTransaksi} onChange={(e) => update("hideTransaksi", e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>{lang === "en" ? "Hide change float" : "Sembunyikan kembalian"}</span>
            <input type="checkbox" checked={!!settings.hideKembalian} onChange={(e) => update("hideKembalian", e.target.checked)} />
          </label>
        </div>

        {/* ==================== REKAP HARIAN + UPLOAD ==================== */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{lang === "en" ? "Daily Recap" : "Rekap Harian"}</h3>
          <small className="muted" style={{ display: "block", marginBottom: 12 }}>
            {lang === "en"
              ? "Download one day's sales & expenses as PDF. You can later upload the same PDF to restore data."
              : "Unduh penjualan & pengeluaran satu hari sebagai PDF. Nanti bisa di-upload lagi untuk memulihkan data."}
          </small>

          <input
            type="date"
            value={recapDate}
            max={toKey(new Date())}
            onChange={(e) => e.target.value && setRecapDate(e.target.value)}
          />

          <button
            className="btn ghost"
            style={{
              width: "100%",
              marginTop: 10,
              background: "transparent",
              border: "1.5px solid var(--border, #cbd5e1)",
              color: "inherit",
              fontWeight: 600,
              fontSize: 14,
            }}
            onClick={() => {
              try {
                downloadRecapPdf({
                  ...buildRecap(txs, recapDate),
                  key: recapDate,
                  lang,
                });
                toast.success(lang === "en" ? "Recap downloaded" : "Rekap diunduh");
              } catch (e) {
                toast.error(
                  (lang === "en" ? "Failed to create PDF: " : "Gagal membuat PDF: ") +
                    (e.message || "")
                );
              }
            }}
          >
            <Ic n="download" s={18} />{" "}
            {lang === "en" ? "Download PDF" : "Download PDF"}
          </button>

          {/* ===== UPLOAD ===== */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px dashed var(--border, #cbd5e1)",
            }}
          >
            <small className="muted" style={{ display: "block", marginBottom: 8 }}>
              {lang === "en"
                ? "Upload a previously downloaded Recap PDF to restore the transactions of that day."
                : "Upload PDF Rekap yang sudah pernah diunduh untuk memulihkan transaksi hari tersebut."}
            </small>

            <input
              type="file"
              accept="application/pdf,.pdf"
              id="recap-upload-input"
              style={{ display: "none" }}
              onChange={handleUploadRecap}
              disabled={uploading}
            />

            <button
              className="btn ghost"
              disabled={uploading}
              style={{
                width: "100%",
                background: "transparent",
                border: "1.5px solid var(--border, #cbd5e1)",
                color: "inherit",
                fontWeight: 600,
                fontSize: 14,
              }}
              onClick={() => document.getElementById("recap-upload-input")?.click()}
            >
              <Ic n="upload" s={18} />{" "}
              {uploading
                ? lang === "en"
                  ? "Restoring..."
                  : "Memulihkan..."
                : lang === "en"
                ? "Upload PDF"
                : "Upload PDF"}
            </button>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 16 }}>{t("homeDisplay")}</h3>

          <label className="switch-row">
            <span>{lang === "en" ? "Hide chart" : "Sembunyikan grafik"}</span>
            <input type="checkbox" checked={!!settings.hideChart} onChange={(e) => update("hideChart", e.target.checked)} />
          </label>

          <label>{t("maxTx")}</label>
          <select value={settings.maxRiwayatBeranda} onChange={(e) => update("maxRiwayatBeranda", Number(e.target.value))}>
            {[3, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{t("nTx", { n })}</option>)}
          </select>

          <label style={{ marginTop: 16 }}>{t("showType")}</label>
          <select value={settings.filterJenis} onChange={(e) => update("filterJenis", e.target.value)}>
            <option value="all">{t("typeAll")}</option>
            <option value="income">{t("typeIncome")}</option>
            <option value="expense">{t("typeExpense")}</option>
          </select>

          <label style={{ marginTop: 16 }}>{t("filterCat")}</label>
          <select value={settings.filterKategori} onChange={(e) => update("filterKategori", e.target.value)}>
            <option value="all">{t("catAll")}</option>
            <option value="makanan">{t("catFoodOnly")}</option>
            <option value="minuman">{t("catDrinkOnly")}</option>
          </select>
        </div>

        <div className="card" style={{ marginTop: 16, border: "1px solid rgba(229,72,77,.25)" }}>
          <h3 style={{ marginBottom: 8 }}>{lang === "en" ? "Transaction History" : "Riwayat Transaksi"}</h3>
          <small className="muted" style={{ display: "block", marginBottom: 12 }}>
            {lang === "en"
              ? "Delete all transaction history. Requires the reset password."
              : "Hapus seluruh riwayat transaksi. Butuh password reset."}
          </small>
          <button
            className="btn ghost"
            style={{ width: "100%", color: "var(--err)", border: "1.5px solid var(--err)", fontWeight: 600, fontSize: 14 }}
            onClick={() => setShowReset(true)}
          >
            <Ic n="trash" s={16} /> {lang === "en" ? "Reset History" : "Reset Riwayat"}
          </button>
        </div>

        {showReset && <ResetHistoryModal onClose={() => setShowReset(false)} onDone={onReset} />}

        <p className="muted center" style={{ marginTop: 24, fontSize: 13 }}>
          {t("savedAuto")}
        </p>

      </div>
    </>
  );
}

// ---------- Halaman Pembayaran Berhasil (layar penuh, rincian seperti detail transaksi) ----------
function PaymentSuccess({ done, onClose }) {
  const { t, locale, lang } = useT();
  const [pdfBusy, setPdfBusy] = useState(false);
  const tx = done.tx || {};
  const items = tx.items || [];
  const total = tx.total ?? done.total;
  const paid = tx.cashReceived ?? done.paid;
  const change = tx.change ?? done.change;
  const itemsSum = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  const adj = itemsSum - total;
  const pk = tx.packaging || {};
  const mixed = isMix(tx);

  const savePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadReceipt(tx);
    } catch (e) {
      toast.error(t("pdfFail") + (e.message || t("retry")));
    }
    setPdfBusy(false);
  };

  return (
    <div className="pay-done">
      <div className="pay-hero">
        <div className="ok-ic"><Ic n="check" s={34} /></div>
        <h1>{t("paySuccess")}</h1>
        <strong>{rp(total)}</strong>
        <small>
          {new Date(tx.createdAt || Date.now()).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </small>
      </div>

      <div className="pay-body">
        {items.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{t("orderItems")}</h3>
            {items.map((i, idx) => (
              <div className="li" key={idx}>
                <span>
                  <CatIcon c={i.category} s={18} /> {i.name}
                  <small className="muted">
                    {" "}{rp(i.price)} × {i.qty}
                    {i.raw && ` · ${lang === "en" ? "not brewed" : "tanpa seduh"}`}
                    {i.custom && ` · ${lang === "en" ? "custom" : "kustom"}`}
                  </small>
                </span>
                <b>{rp(i.price * i.qty)}</b>
                {i.raw && ` · ${lang === "en" ? "not brewed" : "tanpa seduh"}`}
                {i.custom && ` · ${lang === "en" ? "custom" : "kustom"}`}
              </div>
            ))}
            {adj > 0 && (
              <div className="li"><span className="muted">{t("promoDisc")}</span><b className="ok">−{rp(adj)}</b></div>
            )}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{t("payment")}</h3>
          <div className="li"><span className="muted">{t("method")}</span><b>{methodLabel(tx.method || "cash", t)}</b></div>
          <div className="li"><span className="muted">{t("total")}</span><b>{rp(total)}</b></div>
          {(tx.method || "cash") === "cash" && (
              <>
                <div className="li"><span className="muted">{t("received")}</span><b>{rp(paid)}</b></div>
                <div className="li"><span className="muted">{t("change")}</span><b className="ok">{rp(change)}</b></div>
                <ChangeSourceRows tx={tx} />
              </>
            )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{t("extras")}</h3>
          <div className="li"><span className="muted">{t("mixOrder")}</span><b>{mixed ? t("yes") : t("no")}</b></div>
          <div className="li"><span className="muted">🛍️ {t("plastic")}</span><b>{pk.plastic || 0}</b></div>
          <div className="li"><span className="muted">🥤 {t("cup")}</span><b>{pk.cup || 0}</b></div>
        </div>

        {tx.note && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{t("note")}</h3>
            <p>{tx.note}</p>
          </div>
        )}
      </div>

      <div className="pay-actions">
        <button className="btn ghost" disabled={pdfBusy} onClick={savePdf}>
          <Ic n="download" s={18} /> {pdfBusy ? t("makingPdf") : t("pdfReceipt")}
        </button>
        <button className="btn gold" onClick={onClose}>{t("newTx")}</button>
      </div>
    </div>
  );
}

// ---------- Kasir ----------
function Kasir({ products, reload, patchTx, closed, openDay, fund, hideFund, cols = 2, setCols }) {
  const { t, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [cart, setCart] = useState({});
  const [rawCart, setRawCart] = useState({});     // minuman "tanpa seduh"
  const [extraItems, setExtraItems] = useState([]); // item kustom
  const [showExtra, setShowExtra] = useState(false);
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("minuman");
  const [method, setMethod] = useState("cash");
  const isCash = method === "cash";
  const [done, setDone] = useState(null);

  // opsi baru
  const [mix, setMix] = useState(false);
  const [plastic, setPlastic] = useState(0);
  const [cup, setCup] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const shown = products.filter((p) => (q.trim() !== "" || p.category === cat) && (p.name || "").toLowerCase().includes(q.toLowerCase()));
  
  const lines = products.filter((p) => cart[p._id]);
  const rawLines = products.filter((p) => rawCart[p._id]);
  const usedOf = (p) => (cart[p._id] || 0) + (rawCart[p._id] || 0);
  const subtotal =
    lines.reduce((s, p) => s + calcLineTotal(p, cart[p._id]), 0) +
    rawLines.reduce((s, p) => s + p.priceRaw * rawCart[p._id], 0) +
    extraItems.reduce((s, c) => s + c.price * c.qty, 0);
  const count =
    lines.reduce((s, p) => s + cart[p._id], 0) +
    rawLines.reduce((s, p) => s + rawCart[p._id], 0) +
    extraItems.reduce((s, c) => s + c.qty, 0);

  const total = custom && customVal !== "" ? Math.max(0, Number(customVal)) : subtotal;
  const change = Number(cash || 0) - total;
  const fundBal = fund?.balance ?? 0;
  const needChange = isCash ? Math.max(0, change) : 0;
  const fromStock = Math.min(fundBal, needChange);
  const fromOther = needChange - fromStock;
  const canPay = count > 0 && (!custom || customVal !== "") && (isCash ? cash !== "" && change >= 0 : true);

  const add = (p, d, raw = false) => {
    const other = raw ? cart[p._id] || 0 : rawCart[p._id] || 0;
    (raw ? setRawCart : setCart)((c) => {
      const n = { ...c };
      const v = Math.max(0, Math.min(p.stock - other, (c[p._id] || 0) + d));
      if (v) n[p._id] = v; else delete n[p._id];
      return n;
    });
  };
  const setExtraQty = (id, d) =>
    setExtraItems((l) => l.map((c) => (c.id === id ? { ...c, qty: c.qty + d } : c)).filter((c) => c.qty > 0));

  // Pindahkan seluruh qty satu produk antara "seduh" <-> "tanpa seduh"
  const moveLine = (p, toRaw) => {
    const qty = (toRaw ? cart : rawCart)[p._id] || 0;
    if (!qty) return;
    const drop = (c) => { const n = { ...c }; delete n[p._id]; return n; };
    const grow = (c) => ({ ...c, [p._id]: (c[p._id] || 0) + qty });
    (toRaw ? setCart : setRawCart)(drop);
    (toRaw ? setRawCart : setCart)(grow);
  };

  const resetForm = () => {
    setCart({}); setCash(""); setNote(""); setOpen(false);
    setMethod("cash");
    setRawCart({}); setExtraItems([]);
    setMix(false); setPlastic(0); setCup(0); setCustom(false); setCustomVal("");
  };
  
  
  
  const pay = async () => {
    setBusy(true);
    try {
      const items = [
        ...lines.map((p) => ({ product: p._id, qty: cart[p._id] })),
        ...rawLines.map((p) => ({ product: p._id, qty: rawCart[p._id], raw: true })),
        ...extraItems.map((c) => ({ custom: true, name: c.name, price: c.price, qty: c.qty })),
      ];
      const paid = isCash ? Number(cash) : total;
      const saved = await req("/transactions", "POST", {
        type: "income",
        items,
        method,            // ← sebelumnya "cash"
        cashReceived: paid,
        note,
        mix,
        packaging: { plastic, cup },
        customTotal: custom && customVal !== "" ? Number(customVal) : undefined,
      });
      if ((saved.packaging?.plastic ?? 0) !== plastic || (saved.packaging?.cup ?? 0) !== cup) {
        toast.error(t("serverNoPack"), { duration: 8000 });
      }
      patchTx(saved); // langsung muncul di riwayat/beranda
      setDone({ tx: saved, total, paid, change: paid - total });
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

  if (closed) return <Locked openDay={openDay} text={t("lockedCashier")} />;

  return (
    <div className="kasir">
      <div>
        <div className="search"><Ic n="search" s={18} /><input placeholder={t("searchProd")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="pills-row">
          <div className="pills">
            {[["minuman", t("drink")], ["makanan", t("food")]].map(([k, l]) => (
              <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>
            ))}
          </div>
          <div className="view-seg" role="group" aria-label={tl("Tampilan menu", "Menu layout")}>
            <button className={cols === 1 ? "on" : ""} onClick={() => setCols(1)} title={tl("1 kolom", "1 column")}>
              <Ic n="view1" s={16} />
            </button>
            <button className={cols === 2 ? "on" : ""} onClick={() => setCols(2)} title={tl("2 kolom", "2 columns")}>
              <Ic n="view2" s={16} />
            </button>
          </div>
        </div>
        {/* <button type="button" className="btn ghost extra-btn" onClick={() => setShowExtra(true)}>
          <Ic n="plus" s={16} /> {tl("Item kustom (sedotan, cup, dll)", "Custom item (straw, cup, etc.)")}
        </button> */}
        {fund && (
          <small className="muted cf-mini">
          </small>
        )}
        <div className={"products cols-" + cols}>
          <button type="button" className="prod extra-card" onClick={() => setShowExtra(true)}>
            <Ic n="plus" s={22} />
            <span>{tl("Item kustom", "Custom item")}</span>
          </button>
          {shown.map((p) => {
            const qty = cart[p._id] || 0;
            const level = p.stock < 1 ? "empty" : p.stock < 5 ? "low" : "good";
            return (
              <div key={p._id} className={"prod" + (qty || rawCart[p._id] ? " active" : "") + (p.stock < 1 ? " out" : "")}>
                <div style={{
                  background: p.promo?.enabled ? "linear-gradient(135deg, #fbb02d, #f59e0b)" : "#e5e7eb",
                  color: p.promo?.enabled ? "#00264d" : "#6b7280",
                  fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 20, marginTop: 6,
                  display: "inline-block", letterSpacing: "-0.2px",
                }}>
                  {p.promo?.enabled ? `${p.promo.buyQty} / ${rp(p.promo.payAmount)}` : t("normalPrice")}
                </div>

                <div className="prod-name">
                  <b>{p.name}</b>
                  <span className={"stock " + level}>{p.stock < 1 ? t("outOfStock") : t("stockN", { n: p.stock })}</span>
                </div>
                <div className="stepper">
                  <button onClick={() => add(p, -1)} disabled={qty < 1}>
                    <span style={{ position: "relative", top: -3.2 }}>−</span>
                  </button>
                  <span>{qty}</span>
                  <button onClick={() => add(p, 1)} disabled={usedOf(p) >= p.stock}>
                    <span style={{ position: "relative", top: -3.2 }}>+</span>
                  </button>
                </div>
                {/* {p.category === "minuman" && p.priceRaw != null && (
                  <div className="prod-raw">
                    <span>{tl("Tanpa seduh", "Not brewed")} · {rp(p.priceRaw)}</span>
                    <div className="stepper">
                      <button onClick={() => add(p, -1, true)} disabled={!rawCart[p._id]}>−</button>
                      <span>{rawCart[p._id] || 0}</span>
                      <button onClick={() => add(p, 1, true)} disabled={usedOf(p) >= p.stock}>+</button>
                    </div>
                  </div>
                )} */}
              </div>
            );
          })}
        </div>
         {!products.length && (
            <EmptyState
              img="/produk.png"
              icon="box"
              title={t("noProductsShort")}
              desc={tl("Tambahkan produk pertama untuk anda", "Add your first your product")}
              // actionText={t("addProduct")}
              // onAction={() => setShow(true)}
            />
          )}
      </div>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className={"cart-panel" + (open ? " open" : "")}>
        <div className="modal-h"><h3>{t("cart")}</h3><button className="icon-btn dark sheet-x" onClick={() => setOpen(false)}><Ic n="x" /></button></div>
        
        {lines.map((p) => {
          const qty = cart[p._id];
          const lineTotal = calcLineTotal(p, qty);
          const normalTotal = p.price * qty;
          const hasPromo = p.promo?.enabled && qty >= p.promo.buyQty;
          const canRaw = p.category === "minuman" && p.priceRaw != null;

          return (
            <div key={p._id}>
              <div className="row">
                <div className="grow">
                  <b>{p.name}</b>
                  <br />
                  <small className="muted">
                    {rp(p.price)} × {qty}
                    {hasPromo && <span style={{ color: "var(--ok)", fontWeight: 700 }}> → {t("promo")}</span>}
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
              {canRaw && (
                <label className="raw-check">
                  <input type="checkbox" checked={false} onChange={() => moveLine(p, true)} />
                  <span>{tl("Tanpa seduh", "Not brewed")} · {rp(p.priceRaw)}</span>
                </label>
              )}
            </div>
          );
        })}

        {rawLines.map((p) => {
          const qty = rawCart[p._id];
          return (
            <div key={p._id + ":raw"}>
              <div className="row">
                <div className="grow">
                  <b>{p.name}</b><br />
                  <small className="muted">{tl("Tanpa seduh", "Not brewed")} · {rp(p.priceRaw)} × {qty}</small>
                </div>
                <div className="qty">
                  <button onClick={() => add(p, -1, true)}>−</button><span>{qty}</span><button onClick={() => add(p, 1, true)}>+</button>
                </div>
                <b className="w">{rp(p.priceRaw * qty)}</b>
              </div>
              <label className="raw-check on">
                <input type="checkbox" checked onChange={() => moveLine(p, false)} />
                <span>{tl("Tanpa seduh", "Not brewed")} · {rp(p.priceRaw)}</span>
              </label>
            </div>
          );
        })}
        {extraItems.map((c) => (
          <div className="row" key={c.id}>
            <div className="grow">
              <b>{c.name}</b><br />
              <small className="muted">{tl("Kustom", "Custom")} · {rp(c.price)} × {c.qty}</small>
            </div>
            <div className="qty">
              <button onClick={() => setExtraQty(c.id, -1)}>−</button><span>{c.qty}</span><button onClick={() => setExtraQty(c.id, 1)}>+</button>
            </div>
            <b className="w">{rp(c.price * c.qty)}</b>
          </div>
        ))}
        {count === 0 && <p className="muted center">{t("pickToStart")}</p>}

        {/* ===== Opsi pesanan ===== */}
        <label className="switch-row" style={{ marginTop: 10 }}>
          <span> {t("mixOpt")}</span>
          <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
        </label>

        <div className="opt-grid">
          <Counter label={`🛍️ ${t("plastic")}`} value={plastic} set={setPlastic} />
          <Counter label={`🥤 ${t("cup")}`} value={cup} set={setCup} />
        </div>

        <label className="switch-row">
          <span>{t("customAmount")}</span>
          <input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setCustomVal(""); }} />
        </label>
        {custom && (
          <div className="custom-box">
            <label style={{ marginTop: 0 }}>{t("customTotal")}</label>
            <input
              type="number"
              inputMode="numeric"
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value)}
              placeholder={String(subtotal)}
            />
            <small className="muted">{t("normalTotal", { v: rp(subtotal) })}</small>
          </div>
        )}

        <div className="total">
          <span>{t("total")}</span>
          <b>
            {rp(total)}
            {custom && customVal !== "" && total !== subtotal && (
              <small style={{ display: "block", fontSize: 12, color: "var(--muted)", textDecoration: "line-through", fontWeight: 600, textAlign: "right" }}>
                {rp(subtotal)}
              </small>
            )}
          </b>
        </div>

        <label>{t("payMethod")}</label>
        <div className="seg">
          {[["cash", t("cash")], ["transfer", t("transfer")], ["ewallet", t("ewallet")]].map(([k, l]) => (
            <button key={k} type="button" className={method === k ? "on" : ""} onClick={() => setMethod(k)}>{l}</button>
          ))}
        </div>

        {isCash && (
          <>
            <label>{t("cashReceived")}</label>
            <input type="number" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
            <div className="chips">
              <button onClick={() => setCash(total)}>{t("exactCash")}</button>
              {[10000, 20000, 50000].map((n) => <button key={n} onClick={() => setCash(n)}>{t("thousandK", { n: n / 1000 })}</button>)}
            </div>
            <div className={"change " + (cash !== "" && change < 0 ? "bad" : "")}>
              <span>{cash !== "" && change < 0 ? t("short") : t("change")}</span>
              <b>{cash === "" ? "0" : rp(Math.abs(change))}</b>
            </div>
            {cash !== "" && needChange > 0 && (
              <div className={"cf-split" + (fromOther > 0 ? " warn" : "")}>
                <div><span>{tl("Dari stok kembalian", "From change float")}</span><b>{rp(fromStock)}</b></div>
                {fromOther > 0 && (
                  <div><span>{tl("Kurang → ambil dari sumber lain", "Short → take from other source")}</span><b className="err">{rp(fromOther)}</b></div>
                )}
                <small className="muted">{tl("Saldo setelah ini", "Balance after this")}: {rp(fundBal + Number(cash) - fromStock)}</small>
              </div>
            )}
          </>
        )}

        <input placeholder={t("noteOpt")} value={note} onChange={(e) => setNote(e.target.value)} style={{marginTop: 10.5}} />
        <button className="btn gold" disabled={!canPay || busy} onClick={pay}>
          {busy ? t("processing") : t("payNow")}
        </button>
      </div>

      {count > 0 && !open && (
        <button className="cbar" onClick={() => setOpen(true)}>
          <span className="cbar-l"><Ic n="cart" s={18} /> {t("nItems", { n: count })}</span>
          <b>{rp(total)}</b>
          <span className="cbar-r">{t("payArrow")}</span>
        </button>
      )}

      {done && <PaymentSuccess done={done} onClose={() => setDone(null)} />}
      {showExtra && <ExtraItemModal onClose={() => setShowExtra(false)} onAdd={(c) => setExtraItems((l) => [...l, c])} />}
    </div>
  );
}

function ExtraItemModal({ onClose, onAdd }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const submit = (e) => {
    e.preventDefault();
    onAdd({ id: Date.now() + Math.random(), name: name.trim(), price: Number(price), qty: Math.max(1, Math.floor(Number(qty) || 1)) });
    onClose();
  };
  return (
    <Modal title={tl("Item Kustom", "Custom Item")} onClose={onClose}>
      <form onSubmit={submit}>
        <label>{tl("Nama item", "Item name")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tl("mis. Sedotan", "e.g. Straw")} required autoFocus />
        <div className="chips">
          {["Sedotan", "Cup", "Plastik"].map((n) => <button type="button" key={n} onClick={() => setName(n)}>{n}</button>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>{tl("Harga satuan (Rp)", "Unit price (Rp)")}</label>
            <input type="number" inputMode="numeric" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div>
            <label>{tl("Jumlah", "Qty")}</label>
            <input type="number" inputMode="numeric" min="1" value={qty} onChange={(e) => setQty(e.target.value)} required />
          </div>
        </div>
        <button className="btn gold">{tl("Tambah ke keranjang", "Add to cart")}</button>
      </form>
    </Modal>
  );
}

// Bilah pilih & hapus massal (dipakai Riwayat & Produk)
function SelBar({ selecting, count, allPicked, onStart, onToggleAll, onDelete, onCancel, extra }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  return (
    <div className={"sel-bar" + (selecting ? " active" : "")}>
      {!selecting ? (
        <>
          <button type="button" className="sel-btn" onClick={onStart}>
            <Ic n="check" s={15} /> {tl("Pilih", "Select")}
          </button>
          {extra}
        </>
      ) : (
        <>
          <button type="button" className="sel-btn" onClick={onToggleAll}>
            {allPicked ? tl("Batal semua", "Unselect all") : tl("Pilih semua", "Select all")}
          </button>
          <button type="button" className="sel-btn solid-danger" disabled={!count} onClick={onDelete}>
            <Ic n="trash" s={15} /> {tl("Hapus", "Delete")}
            {count > 0 && <span className="sel-count">{count}</span>}
          </button>
          <button type="button" className="sel-btn icon" onClick={onCancel} aria-label={tl("Batal", "Cancel")}>
            <Ic n="x" s={16} />
          </button>
        </>
      )}
    </div>
  );
}

// ---------- Produk ----------
function Produk({ products, txs = [], reload, suppliers = [], patchProduct, removeProduct }) {
  const { t, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [q, setQ] = useState("");
  const [rank, setRank] = useState("best"); // best | worst
  const empty = { name: "", category: "makanan", price: "", priceRaw: "", stockInitial: "",
    promoEnabled: false, promoBuyQty: "", promoPayAmount: "" };
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [delP, setDelP] = useState(null);
  const [view, setView] = useState("list"); // list | top
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const close = () => { setShow(false); setEditId(null); setF(empty); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: f.name,
        category: f.category,
        price: Number(f.price),
        priceRaw: f.category === "minuman" && f.priceRaw !== "" ? Number(f.priceRaw) : null,
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
      toast.success(editId ? t("prodUpdated") : t("prodAdded"));
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
      priceRaw: p.priceRaw ?? "",
      stockInitial: p.stockInitial,
      promoEnabled: p.promo?.enabled || false,
      promoBuyQty: p.promo?.buyQty || "",
      promoPayAmount: p.promo?.payAmount || "",
    });
    setShow(true);
  };

  const del = (p) => setDelP(p);

  const doDelete = async (p) => {
    try {
      await req(`/products/${p._id}`, "DELETE");
      removeProduct(p._id);
      toast.success(lang === "en" ? "Product deleted" : "Produk dihapus");
      reload();
    } catch (x) {
      toast.error(x.message);
    }
  };

  const shown = products.filter((p) => (p.name || "").toLowerCase().includes(q.trim().toLowerCase()));
  const stats = {};
  txs.forEach((x) => {
    if (x.type !== "income") return;
    (x.items || []).forEach((i) => {
      if (!i.product) return;
      const s = (stats[i.product] ||= { qty: 0, raw: 0, rev: 0 });
      s.qty += i.qty;
      s.rev += (i.price || 0) * i.qty;
      if (i.raw) s.raw += i.qty;
    });
  });
  const totalOf = (p) => stats[p._id]?.qty || 0;
  const ranked = [...shown].sort((a, b) => (rank === "best" ? totalOf(b) - totalOf(a) : totalOf(a) - totalOf(b)));
  const list = rank === "best" ? ranked.filter((p) => totalOf(p) > 0) : ranked;
  const maxSold = Math.max(1, ...shown.map(totalOf));

  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState([]);
  const [confirmMany, setConfirmMany] = useState(false);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allIds = shown.map((p) => p._id);
  const allPicked = allIds.length > 0 && allIds.every((id) => sel.includes(id));
  const stopSelect = () => { setSelecting(false); setSel([]); };

  const doDeleteMany = async () => {
    try {
      const r = await req("/products/bulk-delete", "POST", { ids: sel });
      (r.ids || sel).forEach(removeProduct);
      toast.success(tl(`${r.deletedCount} produk dihapus`, `${r.deletedCount} products deleted`));
      stopSelect();
      reload();
    } catch (x) {
      toast.error(x.message);
    }
  };

  return (
    <>
    <div className="search" style={{ marginBottom: 10 }}>
      <Ic n="search" s={18} />
      <input placeholder={tl("Cari produk...", "Search products...")} value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
   <div className="row-actions">
      <button className="btn ghost" style={{ backgroundColor: "white" }} onClick={() => setShow(true)}>
        <Ic n="plus" s={18} /> {t("addProduct")}
      </button>

      <button
        className={"btn ghost" + (view === "list" ? " on" : "")}
        style={{ backgroundColor: "white" }}
        onClick={() => setView("list")}
      >
        <Ic n="list" s={18} /> {tl("Daftar", "List")}
      </button>

      <button
        className={"btn ghost" + (view === "top" ? " on" : "")}
        style={{ backgroundColor: "white" }}
        onClick={() => setView("top")}
      >
        <Ic n="sparkles" s={18} /> {tl("Terlaris", "Best sellers")}
      </button>
    </div>

    {view === "top" && (
      <>
          <div className="seg" style={{ marginBottom: 8, marginTop: 16 }}>
            <button className={rank === "best" ? "on" : ""} onClick={() => setRank("best")}>{tl("Terlaris", "Best")}</button>
            <button className={rank === "worst" ? "on" : ""} onClick={() => setRank("worst")}>{tl("Kurang laris", "Slowest")}</button>
          </div>
          <div className="plist">
            {list.map((p, i) => (
              <div className="card pc" key={p._id}>
                <div className="pc-h">
                  <b style={{ width: 28, textAlign: "center", fontSize: 18 }}>
                    {rank === "best" ? (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1) : i + 1}
                  </b>
                  <span className="pe"><CatIcon c={p.category} s={28} /></span>
                  <div className="grow">
                    <b>{p.name}</b><br />
                    <small className="muted">
                      {totalOf(p) > 0
                        ? `${tl("Terjual", "Sold")} ${totalOf(p)} · ${rp(stats[p._id]?.rev || 0)}`
                        : tl("Belum pernah terjual", "Never sold")}
                    </small>
                  </div>
                </div>
                <div style={{ height: 6, borderRadius: 6, background: "#e5e7eb", overflow: "hidden", marginTop: 6 }}>
                  <div style={{ width: `${(totalOf(p) / maxSold) * 100}%`, height: "100%",
                    background: rank === "best" ? "linear-gradient(90deg,#fbb02d,#f59e0b)" : "linear-gradient(90deg,#94a3b8,#64748b)" }} />
                </div>
              </div>
            ))}
            {!list.length && (
              <EmptyState img="/produk.png" icon="box" title={tl("Belum ada penjualan", "No sales yet")}
                desc={tl("Peringkat muncul setelah ada transaksi.", "Ranking appears after sales are made.")} />
            )}
          </div>
      </>
    )}

    {view === "list" && (
      <>
        {shown.length > 0 && (
          <SelBar
            selecting={selecting}
            count={sel.length}
            allPicked={allPicked}
            onStart={() => setSelecting(true)}
            onToggleAll={() => setSel(allPicked ? [] : allIds)}
            onDelete={() => setConfirmMany(true)}
            onCancel={stopSelect}
          />
        )}

        <div className="plist">
          {shown.map((p) => {
            const on = sel.includes(p._id);
            return (
              <div className={"sel-wrap" + (on ? " picked" : "")} key={p._id}>
                {selecting && <input type="checkbox" className="sel-cb" checked={on} onChange={() => toggle(p._id)} />}
                <div className="sel-body">
                  <div className="card pc" onClick={selecting ? () => toggle(p._id) : undefined}>
                    <div className="pc-h">
                      <span className="pe"><CatIcon c={p.category} s={28} /></span>
                      <div className="grow"><b>{p.name}</b><br /><small className="chip">{p.category === "minuman" ? t("drink") : t("food")}</small></div>
                      <b className="price">{rp(p.price)}</b>
                    </div>
                    <div className="stats4">
                      <div><small>{t("stockStart")}</small><b>{p.stockInitial}</b></div>
                      <div><small>{t("sold")}</small><b>{p.sold}</b></div>
                      <div className={"hl" + (p.stock < LOW_LIMIT ? " low" : "")}><small>{t("now")}</small><b>{p.stock}</b></div>
                      <div><small>{t("stockEnd")}</small><b>{p.stockEnd ?? "-"}</b></div>
                    </div>
                    <small className="muted" style={{ display: "block", margin: "6px 0 2px" }}>
                      {p.stock < LOW_LIMIT && !selecting && <SupplierReco product={p} suppliers={suppliers} go={go} />}
                      {p.priceRaw != null && ` · ${tl("tanpa seduh", "not brewed")}: ${stats[p._id]?.raw || 0}`}
                    </small>
                    {!selecting && (
                      <div className="pc-a">
                        <button onClick={() => edit(p)}><Ic n="edit" s={15} /> {t("edit")}</button>
                        <button className="d" onClick={() => del(p)}><Ic n="trash" s={15} /> {t("delete")}</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!shown.length && (
          <EmptyState
            img="/produk.png"
            icon="box"
            title={q ? tl("Produk tidak ditemukan", "No products found") : t("noProductsShort")}
            desc={q ? tl("Coba kata kunci lain.", "Try another keyword.") : tl("Tambahkan produk pertama untuk mulai berjualan.", "Add your first product to start selling.")}
          />
        )}
      </>
    )}

      {show && (
        <Modal title={editId ? t("editProduct") : t("addProduct")} onClose={close}>
          <form onSubmit={submit}>
            <label>{t("prodName")}</label>
            <input placeholder={t("prodNamePh")} value={f.name} onChange={set("name")} required />
            <label>{t("category")}</label>
            <select value={f.category} onChange={set("category")}><option value="makanan">{t("food")}</option><option value="minuman">{t("drink")}</option></select>
            <label>{t("price")}</label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.price} onChange={set("price")} required />
            {f.category === "minuman" && (
            <>
              <label>{tl("Harga tanpa seduh (opsional)", "Price without brewing (optional)")}</label>
              <input type="number" inputMode="numeric" placeholder="0" value={f.priceRaw} onChange={set("priceRaw")} />
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {tl("Untuk pembeli yang hanya beli produknya",
                    "For customers who buy the product only")}
              </small>
            </>
          )}
            <label>{t("stockStart")}</label>
            <input type="number" inputMode="numeric" placeholder="0" value={f.stockInitial} onChange={set("stockInitial")} required />

            <label style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={f.promoEnabled}
                onChange={(e) => setF({ ...f, promoEnabled: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              {t("enablePromo")}
            </label>

            {f.promoEnabled && (
              <div style={{ background: "var(--ty)", borderRadius: 14, padding: "12px 14px", marginTop: 8, border: "1px solid rgba(251,176,45,.4)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ marginTop: 0 }}>{t("buyHowMany")}</label>
                    <input type="number" inputMode="numeric" placeholder="4" value={f.promoBuyQty} onChange={set("promoBuyQty")} required={f.promoEnabled} min={2} />
                  </div>
                  <div>
                    <label style={{ marginTop: 0 }}>{t("payRp")}</label>
                    <input type="number" inputMode="numeric" placeholder="10000" value={f.promoPayAmount} onChange={set("promoPayAmount")} required={f.promoEnabled} />
                  </div>
                </div>
                <small style={{ color: "var(--warnt)", display: "block", marginTop: 6 }}>
                  {t("promoExample")}
                </small>
              </div>
            )}
            <button className="btn gold">{editId ? t("saveChanges") : t("addProduct")}</button>
          </form>
        </Modal>
      )}

      {delP && (
        <ConfirmModal
          title={t("confirmDelProd", { name: delP.name })}
          okText={t("yesDelete")}
          cancelText={t("cancel")}
          onOk={() => doDelete(delP)}
          onClose={() => setDelP(null)}
        />
      )}

      {confirmMany && (
        <ConfirmModal
          title={tl(`Hapus ${sel.length} produk?`, `Delete ${sel.length} products?`)}
          desc={tl("Riwayat transaksi tetap aman", "Transaction history is kept")}
          okText={t("yesDelete")}
          cancelText={t("cancel")}
          onOk={doDeleteMany}
          onClose={() => setConfirmMany(false)}
        />
      )}
    </>
  );
}

// ---------- Kontak Penjual (CRUD) ----------
function Penjual({ suppliers, products, setSuppliers, go }) {
  const { lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const blank = { name: "", phone: "", note: "", products: [], customProducts: [] };
  const [custom, setCustom] = useState(""); // isian barang kustom
  const [f, setF] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [del, setDel] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { setShow(false); setEditId(null); setF(blank); setCustom(""); };
  const openEdit = (s) => {
    setEditId(s._id);
    setF({ name: s.name, phone: s.phone || "", note: s.note || "", products: s.products || [], customProducts: s.customProducts || [] });
    setCustom("");
    setShow(true);
  };
  const toggleProd = (id) =>
    setF((p) => ({ ...p, products: p.products.includes(id) ? p.products.filter((x) => x !== id) : [...p.products, id] }));

  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    setF((p) =>
      p.customProducts.some((x) => x.toLowerCase() === v.toLowerCase())
        ? p
        : { ...p, customProducts: [...p.customProducts, v] }
    );
    setCustom("");
  };

  const removeCustom = (v) => setF((p) => ({ ...p, customProducts: p.customProducts.filter((x) => x !== v) }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const pending = custom.trim();
      const payload = pending && !f.customProducts.some((x) => x.toLowerCase() === pending.toLowerCase())
        ? { ...f, customProducts: [...f.customProducts, pending] }
        : f;
      const saved = await (editId ? req(`/suppliers/${editId}`, "PUT", payload) : req("/suppliers", "POST", payload));
      setSuppliers((l) => {
        const i = l.findIndex((x) => x._id === saved._id);
        const n = i < 0 ? [...l, saved] : l.map((x) => (x._id === saved._id ? saved : x));
        return n.sort((a, b) => a.name.localeCompare(b.name));
      });
      toast.success(editId ? tl("Penjual diperbarui", "Supplier updated") : tl("Penjual ditambahkan", "Supplier added"));
      close();
    } catch (x) {
      toast.error(x.message);
    }
    setBusy(false);
  };

  const doDelete = async (s) => {
    try {
      await req(`/suppliers/${s._id}`, "DELETE");
      setSuppliers((l) => l.filter((x) => x._id !== s._id));
      toast.success(tl("Penjual dihapus", "Supplier deleted"));
    } catch (x) {
      toast.error(x.message);
    }
  };

  const shown = suppliers.filter((s) =>
    `${s.name} ${s.phone} ${(s.customProducts || []).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())
  );
  
  const nameOf = (id) => products.find((p) => p._id === id)?.name;

  return (
    <>
      <Top
        title={tl("Kontak Penjual", "Suppliers")}
        sub={tl("Penjual bahan baku", "Raw material sellers")}
        right={<button className="icon-btn dark" onClick={() => go("home")}><Ic n="x" /></button>}
      />
      <div className="page pull">
        <div className="search" style={{ marginBottom: 10 }}>
          <Ic n="search" s={18} />
          <input placeholder={tl("Cari penjual...", "Search suppliers...")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn ghost" style={{ marginTop: 0, marginBottom: 12, backgroundColor: "white" }} onClick={() => setShow(true)}>
          <Ic n="plus" s={18} /> {tl("Tambah penjual", "Add supplier")}
        </button>

        {shown.map((s) => {
          const names = [...(s.products || []).map(nameOf).filter(Boolean), ...(s.customProducts || [])];
          return (
            <div className="card sp" key={s._id}>
              <div className="sp-h">
                <span className="cf-ic"><Ic n="users" s={16} /></span>
                <div className="grow">
                  <b>{s.name}</b>
                  <br />
                  <small className="muted">{s.phone || tl("Tanpa nomor", "No number")}</small>
                </div>
              </div>
              {names.length > 0 && (
                <div className="sp-prods">
                  {names.map((n) => <span key={n} className="chip">{n}</span>)}
                </div>
              )}
              {s.note && <small className="muted" style={{ display: "block", marginTop: 6 }}>{s.note}</small>}
              <div className="pc-a">
                {s.phone && (
                  <>
                    <a className="sp-act" href={waLink(s.phone, tl(`Halo ${s.name}, saya mau pesan bahan.`, `Hi ${s.name}, I'd like to order supplies.`))} target="_blank" rel="noreferrer">
                      <Ic n="send" s={15} /> WhatsApp
                    </a>
                  </>
                )}
                <button onClick={() => openEdit(s)}><Ic n="edit" s={15} /> {tl("Edit", "Edit")}</button>
                <button className="d" onClick={() => setDel(s)}><Ic n="trash" s={15} /> {tl("Hapus", "Delete")}</button>
              </div>
            </div>
          );
        })}

        {!shown.length && (
          <EmptyState
            icon="users"
            title={q ? tl("Penjual tidak ditemukan", "No suppliers found") : tl("Belum ada kontak penjual", "No suppliers yet")}
            desc={q ? tl("Coba kata kunci lain.", "Try another keyword.") : tl("Simpan kontak penjual supaya mudah dihubungi saat stok habis.", "Save supplier contacts so you can reach them when stock runs out.")}
          />
        )}
      </div>

      {show && (
        <Modal title={editId ? tl("Edit Penjual", "Edit Supplier") : tl("Tambah Penjual", "Add Supplier")} onClose={close}>
          <form onSubmit={submit}>
            <label>{tl("Nama penjual / toko", "Supplier / shop name")}</label>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />

            <label>{tl("Nomor WhatsApp / HP", "WhatsApp / phone number")}</label>
            <input type="tel" inputMode="tel" placeholder="08xxxxxxxxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />

            <label>{tl("Produk yang dijual", "Products they supply")}</label>
            <div className="sp-pick">
              {products.map((p) => (
                <label key={p._id} className={"sp-opt" + (f.products.includes(p._id) ? " on" : "")}>
                  <input type="checkbox" checked={f.products.includes(p._id)} onChange={() => toggleProd(p._id)} />
                  <span>{p.name}</span>
                </label>
              ))}
              {!products.length && <small className="muted">{tl("Belum ada produk", "No products yet")}</small>}
            </div>

            <label>{tl("Barang lain (kustom)", "Other items (custom)")}</label>
              <div className="sp-add">
                <input
                  placeholder={tl("mis. Gula, Galon, Plastik", "e.g. Sugar, Water jug")}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
                />
                <button type="button" className="btn gold" onClick={addCustom} disabled={!custom.trim()}>
                  <Ic n="plus" s={16} />
                </button>
              </div>
              {f.customProducts.length > 0 && (
                <div className="sp-prods" style={{ marginTop: 6 }}>
                  {f.customProducts.map((n) => (
                    <span key={n} className="chip sp-x">
                      {n}
                      <button type="button" onClick={() => removeCustom(n)} aria-label={tl("Hapus", "Remove")}>
                        <Ic n="x" s={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

            <label>{tl("Catatan", "Note")}</label>
            <input placeholder={tl("Opsional (alamat, jam buka, dll)", "Optional (address, hours, etc.)")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />

            <button className="btn gold" disabled={busy}>{editId ? tl("Simpan perubahan", "Save changes") : tl("Tambah penjual", "Add supplier")}</button>
          </form>
        </Modal>
      )}

      {del && (
        <ConfirmModal
          title={tl(`Hapus ${del.name}?`, `Delete ${del.name}?`)}
          okText={tl("Ya, hapus", "Yes, delete")}
          cancelText={tl("Batal", "Cancel")}
          onOk={() => doDelete(del)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}

// ---------- Pengeluaran ----------
// Satuan untuk pembelian stok (belanja)
const UNITS = ["pcs", "bal", "pack", "unit", "kg", "gram", "renteng", "liter"];

function Pengeluaran({ products, reload, patchTx, closed, openDay, go }) {
  const { t, lang } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const blank = { description: "", amount: "", product: "", qty: "", unit: "pcs", note: "", method: "cash", permanent: false };
  const qtyLabel = (product) => (product ? t("stockBought") : lang === "en" ? "Quantity (optional)" : "Jumlah (opsional)");
  const [f, setF] = useState(blank);
  const [unitCost, setUnitCost] = useState(0); // harga per satuan, jadi patokan nominal
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const [kind, setKind] = useState("belanja"); // belanja | non
  const isShop = kind === "belanja";
  const switchKind = (k) => {
    setKind(k);
    if (k === "non") {
      // bersihkan isian khusus belanja
      setF((p) => ({ ...p, product: "", qty: "", unit: "pcs" }));
      setUnitCost(0);
    }
  };

    const onAmount = (e) => {
    const v = e.target.value;
    const q = Number(f.qty) > 0 ? Number(f.qty) : 1;
    setF({ ...f, amount: v });
    setUnitCost(v === "" ? 0 : Number(v) / q);
  };

  const onQty = (e) => {
    const v = e.target.value;
    const q = Number(v);
    const next = { ...f, qty: v };
    if (unitCost > 0) next.amount = String(Math.round(unitCost * (q > 0 ? q : 1)));
    setF(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const items = isShop && f.product && f.qty ? [{ product: f.product, qty: Number(f.qty), unit: f.unit }] : [];
      const saved = await req("/transactions", "POST", {
        type: "expense",
        description: f.description.trim(),
        amount: Number(f.amount),
        items,
        buyQty: isShop && Number(f.qty) > 0 ? Number(f.qty) : undefined,
        buyUnit: isShop ? f.unit : undefined,
        permanent: f.permanent,
        note: f.note,
        method: f.method,
      });
      patchTx(saved);
      setF(blank);
      setUnitCost(0);
      toast.success(t("expenseSaved"));
      go("home");   // ← redirect ke beranda
      reload();
    } catch (x) {
      toast.error(x.message);
    }
  };

  if (closed) return <Locked openDay={openDay} text={t("lockedExpense")} />;

  return (
    <form className="card" onSubmit={submit}>
      <div className="seg" style={{ marginTop: 0 }}>
        <button type="button" className={isShop ? "on" : ""} onClick={() => switchKind("belanja")}>
          {tl("Belanja", "Shopping")}
        </button>
        <button type="button" className={!isShop ? "on" : ""} onClick={() => switchKind("non")}>
          {tl("Non-belanja", "Non-shopping")}
        </button>
      </div>

      <label>{t("description")}</label>
      <input placeholder={t("descPh")} value={f.description} onChange={set("description")} required />

      <label>{t("amount")}</label>
      <input type="number" inputMode="numeric" placeholder="0" value={f.amount} onChange={onAmount} required />
      {isShop && unitCost > 0 && Number(f.qty) > 0 && (
        <small className="muted" style={{ display: "block", marginTop: 4 }}>
          {lang === "en"
            ? `Follows quantity (${rp(Math.round(unitCost))} / unit)`
            : `Mengikuti jumlah (${rp(Math.round(unitCost))} / satuan)`}
        </small>
      )}

      <label>{t("payMethod")}</label>
      <select value={f.method} onChange={set("method")}>
        <option value="cash">{t("cash")}</option>
        <option value="transfer">{t("transfer")}</option>
        <option value="ewallet">{t("ewallet")}</option>
      </select>

      {isShop && (
        <>
          <label>{t("addStockOpt")}</label>
          <select value={f.product} onChange={set("product")}>
            <option value="">{t("noAddStock")}</option>
            {products.map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
          </select>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>{qtyLabel(f.product)}</label>
              <input type="number" inputMode="numeric" min="1" value={f.qty} onChange={onQty} required={!!f.product} />
            </div>
            <div>
              <label>{lang === "en" ? "Unit" : "Satuan"}</label>
              <select value={f.unit} onChange={set("unit")}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <label>{t("note")}</label>
          <input placeholder={t("optionalPh")} value={f.note} onChange={set("note")} />
        </>
      )}

      <label className="switch-row" style={{ marginTop: 10 }}>
        <span>{tl("Pengeluaran permanen", "Permanent expense")}</span>
        <input type="checkbox" checked={f.permanent} onChange={(e) => setF({ ...f, permanent: e.target.checked })} />
      </label>
      <small className="muted" style={{ display: "block", marginBottom: 6 }}>
        {tl("Dihitung di pengeluaran & laba setiap hari", "Counted in expenses & profit every day")}
      </small>

      <button className="btn gold">{t("saveExpense")}</button>
    </form>
  );
}

// ---------- Modal edit transaksi (dipakai Riwayat & Detail) ----------
function TxEditModal({ tx, products, onClose, onSaved }) {
  const { t, lang } = useT();
  const inc = tx.type === "income";
  const [items, setItems] = useState(() =>
    (tx.items || []).map((i) =>
      i.custom || !i.product
        ? { custom: true, name: i.name, price: i.price || 0, category: i.category, qty: i.qty }
        : { product: String(i.product), name: i.name, price: i.price || 0, category: i.category, qty: i.qty, raw: !!i.raw }
    )
  );  
  const [itemsChanged, setItemsChanged] = useState(false);
  const [nominalTouched, setNominalTouched] = useState(false);
  const [f, setF] = useState({
    nominal: tx.total,
    note: tx.note || "",
    description: tx.description || "",
    mix: !!tx.mix,
    permanent: !!tx.permanent,
    plastic: tx.packaging?.plastic || 0,
    cup: tx.packaging?.cup || 0,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const prodOf = (id) => products.find((p) => p._id === id);
  const computed = items.reduce((sum, it) => {
    const q = Number(it.qty) || 0;
    return sum + (it.custom || it.raw ? it.price * q : calcLineTotal({ price: it.price, promo: prodOf(it.product)?.promo }, q));
  }, 0);
  // Penjualan: total ikut dihitung ulang dari item, kecuali nominal diubah manual
  const nominal = !inc || nominalTouched ? f.nominal : itemsChanged ? computed : tx.total;

  const updateItem = (idx, patch) => {
    setItems((l) => l.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setItemsChanged(true);
  };
  const changeProduct = (idx, id) => {
    const p = prodOf(id);
    if (p) updateItem(idx, { product: p._id, name: p.name, price: p.price, category: p.category, raw: false });
  };
  const removeItem = (idx) => {
    setItems((l) => l.filter((_, i) => i !== idx));
    setItemsChanged(true);
  };
  const addItem = () => {
    const p = products[0];
    if (!p) return toast.error(t("noProductsToast"));
    setItems((l) => [...l, { product: p._id, name: p.name, price: p.price, category: p.category, qty: 1 }]);
    setItemsChanged(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (inc && !items.length) return toast.error(t("minOneItem"));
    if (items.some((i) => !(Number(i.qty) >= 1))) return toast.error(t("itemQtyMin"));
    try {
      const body = {
        note: f.note,
        amount: Number(nominal),
        items: items.map((i) =>
          i.custom
            ? { custom: true, name: i.name, price: i.price, qty: Number(i.qty) }
            : { product: i.product, qty: Number(i.qty), raw: !!i.raw }
        ),
      };
       if (!inc) {
        body.description = f.description;
        body.permanent = f.permanent;
      } else {
        body.mix = f.mix;
        body.packaging = { plastic: Number(f.plastic) || 0, cup: Number(f.cup) || 0 };
      }
      const saved = await req(`/transactions/${tx._id}`, "PUT", body);
      if (inc) {
        const sp = saved.packaging?.plastic ?? 0, sc = saved.packaging?.cup ?? 0;
        if (sp !== body.packaging.plastic || sc !== body.packaging.cup) {
          toast.error(t("serverNoPack"), { duration: 8000 });
        }
      }
      onSaved(saved);
      toast.success(t("txUpdated"));
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Modal title={t("editTx")} onClose={onClose}>
      <form onSubmit={submit}>
        {!inc && (
          <>
            <label>{t("description")}</label>
            <input value={f.description} onChange={set("description")} required />
          </>
        )}

        <label>{inc ? t("itemsBought") : t("stockAdded")}</label>
        {items.map((it, idx) => (
          <div key={idx}>
            <div className="edit-item">
              {it.custom ? (
                <input value={`${it.name} · ${rp(it.price)}`} disabled />
              ) : (
                <select value={it.product} onChange={(e) => changeProduct(idx, e.target.value)}>
                  {!prodOf(it.product) && <option value={it.product}>{it.name} {t("deletedTag")}</option>}
                  {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              )}
              <input type="number" inputMode="numeric" min="1" value={it.qty}
                onChange={(e) => updateItem(idx, { qty: e.target.value })} aria-label={t("qtyAria")} />
              <button type="button" className="icon-btn dark" onClick={() => removeItem(idx)} title={t("removeItem")}>
                <Ic n="trash" s={16} />
              </button>
            </div>
            {it.raw && (
              <small className="muted" style={{ display: "block", margin: "-2px 0 8px" }}>
                {lang === "en" ? "Not brewed" : "Tanpa seduh"} · {rp(it.price)}
              </small>
            )}
          </div>
        ))}
        {!items.length && <p className="muted small">{t("noItems")}</p>}
        <button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={addItem}>
          <Ic n="plus" s={16} /> {t("addItem")}
        </button>
        {inc && <small className="muted" style={{ display: "block", marginTop: 8 }}>{t("totalFromItems", { v: rp(computed) })}</small>}

        {inc && (
          <>
            <label className="switch-row" style={{ marginTop: 8 }}>
              <span> {t("mixShort")}</span>
              <input type="checkbox" checked={f.mix} onChange={(e) => setF({ ...f, mix: e.target.checked })} />
            </label>

            <div className="opt-grid">
              <div className="opt"><span>🛍️ {t("plastic")}</span><input type="number" inputMode="numeric" min="0" value={f.plastic} onChange={set("plastic")} /></div>
              <div className="opt"><span>🥤 {t("cup")}</span><input type="number" inputMode="numeric" min="0" value={f.cup} onChange={set("cup")} /></div>
            </div>
          </>
        )}

        <label>{t("totalAmount")}</label>
        <input
          type="number"
          inputMode="numeric"
          value={nominal}
          onChange={(e) => { setNominalTouched(true); setF({ ...f, nominal: e.target.value }); }}
          required
        />

        {!inc && (
          <label className="switch-row">
            <span>{lang === "en" ? "Permanent expense" : "Pengeluaran permanen"}</span>
            <input type="checkbox" checked={f.permanent} onChange={(e) => setF({ ...f, permanent: e.target.checked })} />
          </label>
        )}

        <label>{t("note")}</label>
        <input placeholder={t("optionalPh")} value={f.note} onChange={set("note")} />

        <button className="btn gold" type="submit">{t("saveBtn")}</button>
      </form>
    </Modal>
  );
}

// ---------- Riwayat ----------
function Riwayat({ txs, onEdit, onDelete, openDetail, onRemoved }) {
  const { t, lang, locale } = useT();
  const tl = (id, en) => (lang === "en" ? en : id);
  const [range, setRange] = useState("today"); // today | all | date
  const [date, setDate] = useState(toKey(new Date()));
  const todayKey = toKey(new Date());
  const list =
    range === "all"
      ? txs
      : txs.filter((x) => toKey(x.createdAt) === (range === "date" ? date : todayKey));
  const inc = list.filter((x) => x.type === "income").reduce((s, x) => s + x.total, 0);
  const ex = range === "all" ? expenseAll(txs) : expenseOn(txs, range === "date" ? date : todayKey);
  const exp = ex.total;

  // ===== mode pilih & hapus massal =====
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState([]);
  const [confirm, setConfirm] = useState(null); // "sel" | "date"
  useEffect(() => { setSel([]); }, [range, date]);

  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allIds = list.map((x) => x._id);
  const allPicked = allIds.length > 0 && allIds.every((id) => sel.includes(id));
  const stopSelect = () => { setSelecting(false); setSel([]); };

  const targetDate = range === "date" ? date : range === "today" ? todayKey : null;
  const targetLabel = targetDate
    ? new Date(targetDate + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
    : "";
  const hasPerm = list.some((x) => x.permanent);

  const delSelected = async (mode) => {
    try {
      const r = await req("/transactions/bulk-delete", "POST", { ids: sel, mode });
      onRemoved(r.ids || sel);
      toast.success(tl(`${r.deletedCount} transaksi dihapus`, `${r.deletedCount} transactions deleted`));
      stopSelect();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const delByDate = async (mode) => {
    try {
      const from = new Date(targetDate + "T00:00:00").toISOString();
      const to = new Date(targetDate + "T23:59:59.999").toISOString();
      const r = await req("/transactions/delete-by-date", "POST", { from, to, mode });
      onRemoved(r.ids || []);
      toast.success(tl(`${r.deletedCount} transaksi dihapus`, `${r.deletedCount} transactions deleted`));
      stopSelect();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <div className="seg">
        <button className={range === "today" ? "on" : ""} onClick={() => setRange("today")}>{t("today")}</button>
        <button className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>{t("allTime")}</button>
        <button className={range === "date" ? "on" : ""} onClick={() => setRange("date")}>{t("byDate")}</button>
      </div>
      {range === "date" && (
        <div className="card date-row">
          <Ic n="calendar" s={18} />
          <input
            type="date"
            value={date}
            max={todayKey}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label={t("pickDate")}
          />
        </div>
      )}
      <div className="sum3">
        <div className="card"><small>{t("income")}</small><b className="ok">{rp(inc)}</b></div>
        <div className="card"><small>{t("expense")}</small><b className="err">{rp(exp)}</b></div>
      </div>

      {/* Bilah pilih & hapus massal */}
      {list.length > 0 && (
        <SelBar
          selecting={selecting}
          count={sel.length}
          allPicked={allPicked}
          onStart={() => setSelecting(true)}
          onToggleAll={() => setSel(allPicked ? [] : allIds)}
          onDelete={() => setConfirm("sel")}
          onCancel={stopSelect}
          extra={
            targetDate && (
              <button type="button" className="sel-btn soft-danger" onClick={() => setConfirm("date")}>
                <Ic n="trash" s={15} /> {tl("Hapus tanggal ini", "Delete this date")}
              </button>
            )
          }
        />
      )}

      {list.map((x) => {
        const on = sel.includes(x._id);
        return (
          <div className={"sel-wrap" + (on ? " picked" : "")} key={x._id}>
            {selecting && (
              <input type="checkbox" className="sel-cb" checked={on} onChange={() => toggle(x._id)} />
            )}
            <div className="sel-body">
              <TxRow t={x} onClick={() => (selecting ? toggle(x._id) : openDetail(x))}>
                {!selecting && (
                  <div className="pc-a" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onEdit(x)}><Ic n="edit" s={15} /> {t("edit")}</button>
                    <button className="d" onClick={() => onDelete(x)}><Ic n="trash" s={15} /> {t("delete")}</button>
                  </div>
                )}
              </TxRow>
            </div>
          </div>
        );
      })}

      {!list.length && (
        <EmptyState
          img="/riwayat.png"
          icon="list"
          title={range === "date" ? t("noTxDate") : t("noTx")}
          desc={
            range === "date"
              ? tl("Coba pilih tanggal lain.", "Try picking another date.")
              : tl("Penjualan dan belanja akan tercatat di sini.", "Sales and expenses will be recorded here.")
          }
        />
      )}

      {confirm && (
        <ConfirmModal
          title={
            confirm === "sel"
              ? tl(`Hapus ${sel.length} transaksi?`, `Delete ${sel.length} transactions?`)
              : tl(`${targetLabel}?`, `${targetLabel}`)
          }
          desc={
            confirm === "sel"
              ? tl("Transaksi yang dipilih dihapus permanen", "Selected transactions are deleted permanently")
              : tl(
                  `${list.length} transaksi dihapus permanen.` + (hasPerm ? " Termasuk pengeluaran permanen, yang berhenti dihitung di hari-hari berikutnya." : ""),
                  `${list.length} transactions are deleted permanently.` + (hasPerm ? " This includes permanent expenses, which stop counting on later days." : "")
                )
          }
          okText={t("yesDelete")}
          cancelText={t("cancel")}
          refund={{ defaultMode: "none" }}
          onOk={confirm === "sel" ? delSelected : delByDate}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

// ---------- Detail transaksi ----------
function Detail({ tx, back, onEdit, onDelete }) {
  const { t, locale, lang } = useT();
  const [pdfBusy, setPdfBusy] = useState(false);
  const savePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadReceipt(tx);
    } catch (e) {
      toast.error(t("pdfFail") + (e.message || t("retry")));
    }
    setPdfBusy(false);
  };

  const closeBtn = (
    <button className="icon-btn dark" onClick={back}><Ic n="x" /></button>
  );

  if (!tx) {
    return (
      <>
        <Top title={t("txDetail")} sub={t("txDetailSub")} right={closeBtn} />
        <div className="page pull"><div className="card center muted">{t("txNotFound")}</div></div>
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
      <Top title={t("txDetail")} sub={t("txDetailSub")} right={closeBtn} />
      <div className="page pull">
        <div className="card dt-hero">
          <span className={`tx-ic ${inc ? "in" : "outc"}${isMix(tx) ? " mix" : ""}`} style={{ width: 54, height: 54, margin: "0 auto 8px" }}>
            <TxIcon key={isMix(tx) ? "m" : "n"} t={tx} />
          </span>
          <small className="muted">{inc ? t("income") : t("expense")}{isMix(tx) ? ` · ${t("mixTag")}` : ""}</small>
          <strong className={inc ? "ok" : "err"}>{inc ? "+" : "−"}{rp(tx.total)}</strong>
          <small className="muted">
            {new Date(tx.createdAt).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </small>
        </div>

        {!inc && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{t("description")}</h3>
            <div className="tx-name">
              <p style={{ margin: 0 }}>{tx.description}</p>
              {tx.permanent && (
                <span className="perm-ic" title={lang === "en" ? "Permanent expense" : "Pengeluaran permanen"}>
                  <Ic n="repeat" s={12} />
                </span>
              )}
            </div>
            {tx.buyQty > 0 && <small className="muted">{tx.buyQty} {tx.buyUnit || "pcs"}</small>}
          </div>
        )}

        {!inc && (tx.expenseItems || []).length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/other.png" alt="" style={{ width: 22, height: 22, objectFit: "contain" }} /> {t("shoppingItems")}
            </h3>
            {tx.expenseItems.map((c, idx) => (
              <div className="li" key={idx}>
                <span>
                  {c.name}
                  <small className="muted"> {rp(c.price)} × {c.qty}</small>
                </span>
                <b>{rp(c.price * c.qty)}</b>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{inc ? t("orderItems") : t("stockAddedShort")}</h3>
            {items.map((i, idx) => (
              <div className="li" key={idx}>
                <span>
                  <CatIcon c={i.category} s={18} /> {i.name}
                  <small className="muted">
                    {" "}{inc ? `${rp(i.price)} × ${i.qty}` : `+${i.qty}${i.unit ? " " + i.unit : ""}`}
                    {inc && i.raw && ` · ${lang === "en" ? "not brewed" : "tanpa seduh"}`}
                    {inc && i.custom && ` · ${lang === "en" ? "custom" : "kustom"}`}
                  </small>
                </span>
                {inc && <b>{rp(i.price * i.qty)}</b>}
              </div>
            ))}
            {inc && adj > 0 && (
              <div className="li"><span className="muted">{t("promoDisc")}</span><b className="ok">−{rp(adj)}</b></div>
            )}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{t("payment")}</h3>
          <div className="li"><span className="muted">{t("method")}</span><b>{methodLabel(tx.method, t)}</b></div>
          <div className="li"><span className="muted">{t("total")}</span><b>{rp(tx.total)}</b></div>
          {inc && tx.method === "cash" && (
            <>
              <div className="li"><span className="muted">{t("received")}</span><b>{rp(tx.cashReceived)}</b></div>
              <div className="li"><span className="muted">{t("change")}</span><b className="ok">{rp(tx.change)}</b></div>
              <ChangeSourceRows tx={tx} />
            </>
          )}
        </div>

        {inc && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{t("extras")}</h3>
            <div className="li"><span className="muted">{t("mixOrder")}</span><b>{isMix(tx) ? t("yes") : t("no")}</b></div>
            <div className="li"><span className="muted">🛍️ {t("plastic")}</span><b>{pk.plastic || 0}</b></div>
            <div className="li"><span className="muted">🥤 {t("cup")}</span><b>{pk.cup || 0}</b></div>
          </div>
        )}

        {tx.note && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>{t("note")}</h3>
            <p>{tx.note}</p>
          </div>
        )}

        <button className="btn gold" style={{ marginTop: 0, marginBottom: 10 }} disabled={pdfBusy} onClick={savePdf}>
          <Ic n="download" s={18} /> {pdfBusy ? t("makingPdf") : t("downloadPdf")}
        </button>

        <div className="row-actions-2">
          <button className="btn ghost" onClick={() => onEdit(tx)}><Ic n="edit" s={16} /> {t("edit")}</button>
          <button className="btn ghost" style={{ color: "var(--err)" }} onClick={() => onDelete(tx, back)}><Ic n="trash" s={16} /> {t("delete")}</button>
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
  lang: "id",
  hideNominal: false,
  hidePengeluaran: false,
  hideLaba: false,
  hideTransaksi: false,
  hideKembalian: false,
  hideChart: false,
  kasirCols: 2,
  maxRiwayatBeranda: 5,
  filterJenis: "all",
  filterKategori: "all",
};

// Deteksi PC: layar lebar + mouse (HP & tablet sentuh tidak ikut terblokir)
const PC_QUERY = "(min-width: 1100px) and (hover: hover) and (pointer: fine)";
function useIsPc() {
  const [pc, setPc] = useState(() => window.matchMedia(PC_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PC_QUERY);
    const on = (e) => setPc(e.matches);
    setPc(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return pc;
}

function PcBlock({ lang }) {
  return (
    <div className="pc-block">
      <div className="pc-ic"><Ic n="monitor" s={44} /></div>
      <h1>{lang === "en" ? "Not compatible with PC" : "Tidak compatible untuk PC"}</h1>
      <p>
        {lang === "en"
          ? "Please open this app on your phone or tablet"
          : "Silakan buka aplikasi ini di HP atau tablet"}
      </p>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("pos_pass"));
  const [suppliers, setSuppliers] = useState([]);
  const [tab, setTab] = useState("home");
  const [backTab, setBackTab] = useState("riwayat");
  const [detailId, setDetailId] = useState(null);
  const [products, setProducts] = useState([]);
  const [txs, setTxs] = useState([]);
  const [showLogout, setShowLogout] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [closed, setClosed] = useState(false);
  const [fund, setFund] = useState(null);
  const [showFund, setShowFund] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [confirmBox, setConfirmBox] = useState(null);
  const isPc = useIsPc();
  
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

  // ===== Bahasa =====
  const lang = settings.lang === "en" ? "en" : "id";
  const t = useMemo(() => makeT(lang), [lang]);
  const ctx = useMemo(() => ({ t, lang, locale: lang === "en" ? "en-US" : "id-ID" }), [t, lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const logout = async () => {
    try {
      await req("/logout", "POST");
    } catch (_) {
      // ignore error saat logout
    }
    localStorage.removeItem("pos_pass");
    setShowLogout(false);
    setAuthed(false);
    setTab("home");
  };
  const lastChange = useRef(0);
  const touch = () => { lastChange.current = Date.now(); };

  const reload = async () => {
    const startedAt = Date.now();
    try {
      const [p, tr, s, fd, sp] = await Promise.all([
        req("/products"),
        req("/transactions"),
        req("/status").catch((e) => { if (e.status === 401) throw e; return null; }),
        req("/change-fund").catch((e) => { if (e.status === 401) throw e; return null; }),
        req("/suppliers").catch((e) => { if (e.status === 401) throw e; return null; }),
      ]);
      if (s) setClosed(!!s.closed);
      if (startedAt < lastChange.current) return; // data lama, sudah ada perubahan yang lebih baru
      if (fd) setFund(fd);
      if (Array.isArray(sp)) setSuppliers(sp);
      setProducts(Array.isArray(p) ? p.filter((x) => x && x.name) : []);
      setTxs(Array.isArray(tr) ? tr : []);
    } catch (e) {
      if (e.status === 401) logout();
      else toast.error(e.message);
    }
  };

  const patchTx = (x) => { touch(); setTxs((l) => upsert(l, x)); };
  const patchProduct = (p) => { touch(); setProducts((l) => upsert(l, p).sort((a, b) => a.name.localeCompare(b.name))); };
  const removeProduct = (id) => { touch(); setProducts((l) => l.filter((x) => x._id !== id)); };

  // Reload tiap kali pindah halaman / setelah login
  useEffect(() => {
    if (authed) reload();
  }, [authed, tab]);

  const openDetail = (x) => {
    setBackTab(tab === "detail" ? backTab : tab);
    setDetailId(x._id);
    setTab("detail");
  };

  const deleteTx = (x, after) =>
  setConfirmBox({
    title: t("delTxTitle"),
    desc: t("delTxDesc"),
    okText: t("yesDelete"),
    refund: { defaultMode: "full" },
    onOk: async (mode) => {
      try {
        await req(`/transactions/${x._id}`, "DELETE", { mode });
        touch(); setTxs((l) => l.filter((y) => y._id !== x._id));
        toast.success(t("txDeleted"));
        after?.();
        await reload();
      } catch (e) {
        toast.error(e.message);
      }
    },
  });

  const closeDay = () =>
    confirmToast({
      title: t("closeDayTitle"),
      desc: t("closeDayDesc"),
      okText: t("yesClose"),
      cancelText: t("cancel"),
      onOk: async () => {
        try {
          await req("/close-day", "POST");
          setClosed(true);
          await reload();
          toast.success(t("dayClosed"));
        } catch (e) {
          toast.error(e.message);
        }
      },
    });

    const openDay = () => setShowOpen(true);

  const confirmOpenDay = async (changeFund) => {
    try {
      await req("/open-day", "POST", changeFund === undefined ? undefined : { changeFund });
      setClosed(false);
      setShowOpen(false);
      await reload();
      toast.success(t("shopOpened"));
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (isPc) return <PcBlock lang={lang} />;

  if (!authed) return <LangCtx.Provider value={ctx}><Login onOk={() => setAuthed(true)} /></LangCtx.Provider>;

  const titles = {
    kasir: [t("menuCashier"), t("cashierSub")],
    produk: [t("menuProducts"), t("productsSub")],
    keluar: [t("expense"), t("expenseSub")],
    riwayat: [t("menuHistory"), t("historySub")],
  };

  const nav = [
    { key: "home", label: t("navHome"), img: "/beranda.png" },
    { key: "produk", label: t("menuProducts"), img: "/produk.png" },
    { key: "kasir", label: t("menuCashier"), img: "/kasir2.png" },
    { key: "keluar", label: t("menuShopping"), img: "/keranjang.png" },
    { key: "riwayat", label: t("menuHistory"), img: "/riwayat.png" },
  ];
  const activeKey = tab === "detail" ? backTab : tab;
  const detailTx = txs.find((x) => x._id === detailId);

  return (
    <LangCtx.Provider value={ctx}>
      <div className="app">
        {tab === "home" ? (
          <Beranda txs={txs} products={products} suppliers={suppliers} go={setTab} closeDay={closeDay} openDay={openDay} closed={closed} askLogout={() => setShowLogout(true)} openDetail={openDetail} settings={settings} setSettings={setSettings} fund={fund} openFund={() => setShowFund(true)} />
        ) : tab === "setting" ? (
          <Setting settings={settings} setSettings={setSettings} go={setTab} txs={txs} onReset={() => { touch(); setTxs([]); reload(); }} />
        ) : tab === "logs" ? (
          <ActivityLogPage go={setTab} />
        ) : tab === "detail" ? (
          <Detail tx={detailTx} back={() => setTab(backTab)} onEdit={setEditTx} onDelete={deleteTx} />
        ) : tab === "suppliers" ? (
          <Penjual suppliers={suppliers} products={products} setSuppliers={setSuppliers} go={setTab} />
        ) : (
          <>
            <Top title={titles[tab][0]} sub={titles[tab][1]} />
            <div className="page pull">
              {tab === "kasir" && <Kasir products={products} reload={reload} patchTx={patchTx} closed={closed} openDay={openDay} fund={fund} hideFund={settings.hideNominal || settings.hideKembalian} cols={settings.kasirCols === 1 ? 1 : 2} setCols={(n) => setSettings((p) => ({ ...p, kasirCols: n }))} />}
              {tab === "produk" && <Produk products={products} suppliers={suppliers} go={setTab} reload={reload} closeDay={closeDay} txs={txs} openDay={openDay} closed={closed} patchProduct={patchProduct} removeProduct={removeProduct} />}
              {tab === "keluar" && <Pengeluaran products={products} reload={reload} patchTx={patchTx} closed={closed} openDay={openDay} go={setTab} />}
              {tab === "riwayat" && (
                <Riwayat
                  txs={txs}
                  onEdit={setEditTx}
                  onDelete={deleteTx}
                  openDetail={openDetail}
                  onRemoved={(ids) => {
                    touch();
                    setTxs((l) => l.filter((x) => !ids.includes(x._id)));
                    reload();
                  }}
                />
              )}
            </div>
          </>
        )}

        <nav className="nav">
          {nav.map((n) => (
            <button
              key={n.key}
              className={`btn-nav${activeKey === n.key ? " on" : ""}${n.key === "kasir" ? " mid" : ""}`}
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

        {showFund && (
          <ChangeFundModal
            fund={fund}
            onClose={() => setShowFund(false)}
            onSaved={(f) => { touch(); setFund(f); }}
          />
        )}

        {showOpen && (
          <OpenDayModal
            fund={fund}
            onClose={() => setShowOpen(false)}
            onConfirm={confirmOpenDay}
          />
        )}

        {confirmBox && (
          <ConfirmModal
            {...confirmBox}
            cancelText={t("cancel")}
            onClose={() => setConfirmBox(null)}
          />
        )}

        {showLogout && (
          <div className="modal-wrap center-m" onClick={() => setShowLogout(false)}>
            <div className="modal success" onClick={(e) => e.stopPropagation()}>
              <div className="logout-ic"><Ic n="logout" s={30} /></div>
              <h3>{t("logoutTitle")}</h3>
              <p className="muted small">{t("logoutDesc")}</p>
              <div className="row-actions-2" style={{ marginTop: 18 }}>
                <button className="btn ghost" onClick={() => setShowLogout(false)}>{t("cancel")}</button>
                <button className="btn gold" style={{ background: "var(--err)" }} onClick={logout}>{t("yesLogout")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LangCtx.Provider>
  );
}