import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import type { TrendSeriesPoint } from "@/services/dashboard";
import { getColumnCount, getHoverGeometry, getPlotGeometry, getStackLayout, observePlotWidth, pickColumn } from "./stacked-bars-layout";
import "./StackedBars.css";

/* ══ Stacked bars（改编自 Bencho，MIT License，cabralorenzo/bencho） ═══════
   https://github.com/cabralorenzo/bencho/blob/main/blocks/stacked-bars/StackedBars.tsx
   改编点：数据由外部注入（按天 × top N 维度），framer-motion 换成 motion/react，
   移除 Day/Week 切换与 escalated 条，深色主题由 CSS 变量覆盖。 */

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
  const count = getColumnCount(data.length, bars);
  const [at, setAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const [plot, setPlot] = useState<HTMLDivElement | null>(null);

  /* plot 挂载时立即测量；空数据切换、隐藏恢复和重新挂载都重新绑定。 */
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    setAt(null);
    if (!plot) return;
    let previousWidth = -1;
    return observePlotWidth(plot, (width) => {
      if (width === previousWidth) return;
      previousWidth = width;
      setAt(null);
      setW(width);
    });
  }, [plot]);

  /* 首次渲染后一帧触发生长动画（headless 环境 IntersectionObserver 不可靠） */
  useEffect(() => {
    if (seen) return;
    const raf = requestAnimationFrame(() => setSeen(true));
    return () => cancelAnimationFrame(raf);
  }, [seen]);

  /* 数据 → 柱：每个类目一列，val 按 categories 顺序堆叠 */
  const barsData = useMemo(() => {
    const slice = data.slice(data.length - count);
    return slice.map((d) => {
      const valMap = new Map(d.series.map((s) => [s.key, s.value]));
      return {
        vals: categories.map((c) => valMap.get(c) ?? 0),
        label: d.key.slice(5),
        short: d.key.slice(5),
      };
    });
  }, [data, categories, count]);

  const n = barsData.length;
  const geometry = useMemo(() => getPlotGeometry(w, n, gap), [w, n, gap]);
  const { barWidth: bw } = geometry;
  const r = Math.min(2.5, bw / 2);
  const { totals, layout } = useMemo(
    () => getStackLayout(barsData.map((bar) => bar.vals), CH - LIFT - 2, SEG_GAP),
    [barsData],
  );

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
  const ringW = useMotionValue(0);
  const tipX = useMotionValue(0);
  const hover = useMemo(() => at === null ? null : getHoverGeometry(geometry, at, TIP_W), [geometry, at]);
  const was = useRef<typeof geometry | null>(null);
  useLayoutEffect(() => {
    if (at === null || !hover) { was.current = null; return; }
    const up = seen ? layout[at].top : 0;
    const y = Math.max(0, CH - LIFT - up - 3);
    const h = up + LIFT + 1 + LIFT + 6;
    const animations: Array<{ stop: () => void }> = [];
    const go = (mv: typeof ringX, v: number) => {
      // A resize must move bars and overlays together; hover keeps the Bencho spring.
      if (was.current !== geometry) mv.set(v);
      else animations.push(animate(mv, v, SPRING));
    };
    go(ringX, hover.ringLeft); go(ringY, y); go(ringH, h); go(ringW, hover.ringWidth); go(tipX, hover.tipLeft);
    was.current = geometry;
    return () => animations.forEach((animation) => animation.stop());
  }, [at, hover, geometry, layout, seen, ringX, ringY, ringH, ringW, tipX]);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    // Refresh synchronously with picking if a resize arrives before ResizeObserver.
    setW(bounds.width);
    setAt(pickColumn(getPlotGeometry(bounds.width, n, gap), e.clientX - bounds.left));
  };

  const cur = at !== null && hover ? barsData[at] : null;
  const top2 = cur
    ? cur.vals.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v).slice(0, 2).filter((x) => x.v > 0)
    : [];

  if (barsData.length === 0 || categories.length === 0) {
    return <div className="py-8 text-center text-[13px] text-white/60">暂无数据</div>;
  }

  return (
    <div
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
        ref={setPlot}
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
            style={{ ...geometry.columns[i], ["--i" as string]: i } as CSSProperties}
          >
            {layout[i].segs.map((s, k) => s.h > 0 && (
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
          hidden={at !== null && layout[at]?.top === 0}
          aria-hidden
          style={{ x: ringX, y: ringY, height: ringH, width: ringW }}
        />

        <motion.div className="stb-tip" style={{ x: tipX, width: Math.min(TIP_W, geometry.width) }} aria-hidden={!cur}>
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
