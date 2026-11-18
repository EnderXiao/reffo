import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import type { TrendSeriesPoint } from "@/services/dashboard";
import "./StackedBars.css";

/* ══ Stacked bars（改编自 Bencho，MIT License，cabralorenzo/bencho） ═══════
   https://github.com/cabralorenzo/bencho/blob/main/blocks/stacked-bars/StackedBars.tsx
   改编点：数据由外部注入（按天 × top N 维度），framer-motion 换成 motion/react，
   移除 Day/Week 切换与 escalated 条，深色主题由 CSS 变量覆盖。 */

const PAD = 0;
const CH = 104;
const BH = 22;
const SEG_GAP = 2;
const LIFT = 2;
const TIP_W = 132;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export function StackedBars({
  data,
  categories,
  unit = "次",
  bars = 7,
  gap = 4,
}: {
  data: TrendSeriesPoint[];
  categories: string[];
  unit?: string;
  bars?: number;
  gap?: number;
}) {
  const n = Math.max(2, Math.min(Math.round(bars), data.length));
  const [at, setAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const plot = useRef<HTMLDivElement | null>(null);

  /* 响应式宽度：跟随外层卡片实际宽度 */
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w > 0]);

  /* 首次渲染后一帧触发生长动画（headless 环境 IntersectionObserver 不可靠） */
  useEffect(() => {
    if (seen) return;
    const raf = requestAnimationFrame(() => setSeen(true));
    return () => cancelAnimationFrame(raf);
  }, [seen]);

  /* 数据 → 柱：每个类目一列，val 按 categories 顺序堆叠 */
  const barsData = useMemo(() => {
    const slice = data.slice(-n);
    return slice.map((d) => {
      const valMap = new Map(d.series.map((s) => [s.key, s.value]));
      return {
        vals: categories.map((c) => valMap.get(c) ?? 0),
        label: d.key.slice(5),
        short: d.key.slice(5),
      };
    });
  }, [data, categories, n]);

  const W = w > 0 ? w : 300;
  const CW = W - PAD * 2;
  const g = Math.max(1, Math.min(gap, (CW - 3 * n) / (n - 1)));
  const bw = (CW - g * (n - 1)) / n;
  const r = Math.min(2.5, bw / 2);
  const totals = barsData.map((b) => b.vals.reduce((s, v) => s + v, 0));
  const maxT = Math.max(1, ...totals);
  const scale = (CH - LIFT - 2 - SEG_GAP * (categories.length - 1)) / maxT;
  const layout = barsData.map((b) => {
    let y = 0;
    const segs = b.vals.map((v) => {
      const h = Math.max(2, v * scale);
      const s = { bottom: y, h };
      y += h + SEG_GAP;
      return s;
    });
    return { segs, top: y - SEG_GAP };
  });

  const total = totals.reduce((s, v) => s + v, 0);
  const [gen, setGen] = useState(0);
  const last = useRef(total);
  useEffect(() => {
    if (last.current === total) return;
    last.current = total;
    setGen((i) => i + 1);
  }, [total]);

  /* ring 与 tooltip：出现时一次到位，之后弹簧跟随 */
  const ringX = useMotionValue(0);
  const ringY = useMotionValue(0);
  const ringH = useMotionValue(0);
  const tipX = useMotionValue(0);
  const was = useRef<number | null>(null);
  useEffect(() => {
    if (at === null || at >= n) { was.current = null; return; }
    const L = layout[at];
    const left = at * (bw + g);
    const x = left - 3;
    const up = seen ? L.top : 0;
    const y = CH - LIFT - up - 3;
    const h = up + LIFT + 1 + LIFT + 6;
    const right = left + bw + 8;
    const tx = right + TIP_W <= CW || left - 8 - TIP_W < 0
      ? Math.min(CW - TIP_W, right)
      : left - 8 - TIP_W;
    const go = (mv: typeof ringX, v: number) => {
      if (was.current === null) mv.set(v);
      else animate(mv, v, SPRING);
    };
    go(ringX, x); go(ringY, y); go(ringH, h); go(tipX, tx);
    was.current = at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, n, bw, g, seen, w]);

  const pick = (e: React.PointerEvent) => {
    const b = plot.current?.getBoundingClientRect();
    if (!b || b.width === 0) return;
    const i = Math.floor(((e.clientX - b.left) / b.width) * n);
    setAt(Math.max(0, Math.min(n - 1, i)));
  };

  const cur = at !== null && at < n ? barsData[at] : null;
  const top2 = cur
    ? cur.vals.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v).slice(0, 2).filter((x) => x.v > 0)
    : [];

  if (barsData.length === 0 || categories.length === 0) {
    return <div className="py-8 text-center text-[13px] text-white/60">暂无数据</div>;
  }

  return (
    <div
      ref={root}
      className="stb"
      data-colour="on"
      data-scrub={cur ? "" : undefined}
      style={{ ["--stb-r" as string]: r + "px", ["--stb-rr" as string]: r + 3 + "px" } as CSSProperties}
    >
      <div className="stb-figure">
        <span className="stb-num" aria-label={fmt(total)}>
          {fmt(total).split("").map((ch, i) => (
            <span key={gen + "-" + i} className="stb-digit" data-pop={gen > 0 || undefined} style={{ ["--i" as string]: i } as CSSProperties} aria-hidden>
              {ch}
            </span>
          ))}
        </span>
        <span className="stb-unit">{unit}</span>
      </div>

      <div
        ref={plot}
        className="stb-plot"
        style={{ height: CH + 1 + BH }}
        onPointerDown={(e) => {
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* scripted */ }
          pick(e);
        }}
        onPointerMove={pick}
        onPointerUp={(e) => {
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* scripted */ }
          if (e.pointerType !== "mouse") setAt(null);
        }}
        onPointerCancel={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
      >
        <span className="stb-base" style={{ top: CH }} />
        {barsData.map((_, i) => (
          <div
            key={i}
            className="stb-col"
            data-on={at === i || undefined}
            style={{ left: i * (bw + g), width: bw, ["--i" as string]: i } as CSSProperties}
          >
            {layout[i].segs.map((s, k) => (
              <span
                key={k}
                className="stb-bar"
                style={{
                  ["--c" as string]: "var(--stb-c" + (k + 1) + ")",
                  bottom: BH + 1 + LIFT + (seen ? s.bottom : 0),
                  height: seen ? s.h : 0,
                } as CSSProperties}
              />
            ))}
          </div>
        ))}

        <motion.span
          className="stb-ring"
          aria-hidden
          style={{ x: ringX, y: ringY, height: ringH, width: bw + 6 }}
        />

        <motion.div className="stb-tip" style={{ x: tipX, width: TIP_W }} aria-hidden={!cur}>
          {cur && (
            <>
              <div className="stb-tip-head">
                <span>{cur.label}</span>
                <b>{fmt(totals[at!])}</b>
              </div>
              {top2.map(({ v, k }) => (
                <div className="stb-tip-row" key={categories[k]}>
                  <i style={{ ["--c" as string]: "var(--stb-c" + (k + 1) + ")" } as CSSProperties} />
                  <span>{categories[k]}</span>
                  <b>{fmt(v)}</b>
                </div>
              ))}
            </>
          )}
        </motion.div>
      </div>

      <div className="stb-axis">
        {barsData.map((b, i) => (
          <span key={i}>{b.short}</span>
        ))}
      </div>
    </div>
  );
}
