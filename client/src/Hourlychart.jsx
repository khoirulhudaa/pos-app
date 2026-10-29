import { useMemo, useState } from "react";
import { useT } from "./i18n";

const BLUE = "#0a66c2";
const GOLD = "#fbb02d";

// Line chart jumlah penjualan per jam (SVG murni, tanpa library)
export default function HourlyChart({ txs }) {
  const { t } = useT();
  const [mode, setMode] = useState("tx"); // tx = jumlah transaksi, items = jumlah item terjual
  const [sel, setSel] = useState(null);

  const sales = useMemo(() => txs.filter((x) => x.type === "income"), [txs]);

  const { data, from } = useMemo(() => {
    const counts = Array(24).fill(0);
    const hrs = [];
    sales.forEach((x) => {
      const h = new Date(x.createdAt).getHours();
      hrs.push(h);
      counts[h] += mode === "tx" ? 1 : (x.items || []).reduce((s, i) => s + (i.qty || 0), 0);
    });
    const from = Math.min(7, ...hrs);
    const to = Math.max(21, ...hrs);
    const data = [];
    for (let h = from; h <= to; h++) data.push({ h, v: counts[h] });
    return { data, from };
  }, [sales, mode]);

  const total = data.reduce((s, d) => s + d.v, 0);
  const maxV = Math.max(...data.map((d) => d.v), 0);
  const yMax = maxV <= 4 ? 4 : Math.ceil(maxV / 4) * 4;
  const peakIdx = maxV > 0 ? data.findIndex((d) => d.v === maxV) : -1;
  const active = sel != null && data[sel] ? sel : peakIdx;

  const W = 320, H = 170, pl = 26, pr = 12, pt = 14, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = (i) => pl + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const y = (v) => pt + ih * (1 - v / yMax);
  const pad = (h) => String(h).padStart(2, "0");

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const unit = mode === "tx" ? t("chartUnitTx") : t("chartUnitItems");
  const ticks = [0, 1, 2, 3, 4].map((k) => (yMax / 4) * k);

  return (
    <div className="card hc">
      <div className="hc-h">
        <h3>{t("chartTitle")}</h3>
        <div className="hc-seg">
          <button className={mode === "tx" ? "on" : ""} onClick={() => setMode("tx")}>{t("chartTx")}</button>
          <button className={mode === "items" ? "on" : ""} onClick={() => setMode("items")}>{t("chartItems")}</button>
        </div>
      </div>

      {total === 0 ? (
        <p className="muted small center" style={{ margin: "18px 0" }}>{t("chartEmpty")}</p>
      ) : (
        <>
          <div className="hc-info">
            <span>{active === peakIdx ? t("chartPeak") : `${pad(data[active].h)}:00`}</span>
            <b>
              {pad(data[active].h)}:00 · {data[active].v} {unit}
            </b>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("chartTitle")}>
            <defs>
              <linearGradient id="hcFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BLUE} stopOpacity="0.28" />
                <stop offset="100%" stopColor={BLUE} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {ticks.map((tv) => (
              <g key={tv}>
                <line x1={pl} x2={W - pr} y1={y(tv)} y2={y(tv)} stroke="#e2e8f0" strokeDasharray={tv === 0 ? "0" : "3 4"} />
                <text x={pl - 6} y={y(tv) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{tv}</text>
              </g>
            ))}
            {data.map((d, i) =>
              (d.h - from) % 2 === 0 ? (
                <text key={d.h} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{pad(d.h)}</text>
              ) : null
            )}
            <path d={area} fill="url(#hcFill)" />
            <path d={line} fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            {active >= 0 && (
              <line x1={x(active)} x2={x(active)} y1={pt} y2={y(0)} stroke={GOLD} strokeWidth="1" strokeDasharray="3 3" />
            )}
            {data.map((d, i) => (
              <g key={d.h} onClick={() => setSel(i)} style={{ cursor: "pointer" }}>
                <circle cx={x(i)} cy={y(d.v)} r="11" fill="transparent" />
                {(d.v > 0 || i === active) && (
                  <circle
                    cx={x(i)}
                    cy={y(d.v)}
                    r={i === active ? 4.5 : 3}
                    fill={i === active ? GOLD : "#fff"}
                    stroke={i === active ? "#fff" : BLUE}
                    strokeWidth="2"
                  />
                )}
              </g>
            ))}
          </svg>
        </>
      )}
    </div>
  );
}