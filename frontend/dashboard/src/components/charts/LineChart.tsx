import { useState } from "react";
import { ChartDatum } from "./types";

/**
 * 折线图：Y 轴刻度 + 网格线 + 渐变面积 + hover 竖线与点放大 + tooltip。
 */
export default function LineChart({ data, color = "#a78bfa" }: { data: ChartDatum[]; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return <div className="py-8 text-center text-[13px] text-white/60">暂无数据</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640;
  const H = 240;
  const padL = 34;
  const padR = 14;
  const padT = 16;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const coords = data.map((d, i) => ({ x: padL + i * step, y: padT + plotH - (d.value / max) * plotH, ...d }));
  const line = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x + " " + c.y).join(" ");
  const area = line + " L" + coords[coords.length - 1].x + " " + (padT + plotH) + " L" + padL + " " + (padT + plotH) + " Z";
  const ticks = [0, 0.5, 1];
  const active = hover != null ? coords[hover] : null;

  return (
    <svg viewBox={"0 0 " + W + " " + H} className="w-full" role="img" aria-label="折线图" onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="line-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = padT + plotH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#ffffff" strokeOpacity={0.22} strokeDasharray="3 4" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={10.5} fill="#ffffff" fillOpacity={0.7}>
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#line-area)" />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {active && (
        <g>
          <line x1={active.x} y1={padT} x2={active.x} y2={padT + plotH} stroke="#ffffff" strokeOpacity={0.3} strokeDasharray="2 3" />
          <rect x={Math.min(Math.max(active.x - 40, padL), W - padR - 80)} y={Math.max(active.y - 36, 2)} width={80} height={24} rx={8} fill="#241a45" stroke="#ffffff" strokeOpacity={0.5} />
          <text x={Math.min(Math.max(active.x, padL + 40), W - padR - 40)} y={Math.max(active.y - 20, 18)} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff">
            {active.key.slice(5) + " · " + active.value}
          </text>
        </g>
      )}
      {coords.map((c, i) => (
        <g key={c.key}>
          {hover === i && <circle cx={c.x} cy={c.y} r={9} fill={color} opacity={0.25} />}
          <circle
            cx={c.x} cy={c.y} r={hover === i ? 5 : 3.5}
            fill={hover === i ? "#ffffff" : color}
            stroke={color} strokeWidth={2}
            style={{ transition: "r 160ms ease" }}
            onMouseEnter={() => setHover(i)}
            className="cursor-pointer"
          />
          <text x={c.x} y={H - 10} textAnchor="middle" fontSize={10.5} fill="#ffffff" fillOpacity={hover === i ? 0.95 : 0.7} style={{ transition: "opacity 160ms ease" }}>
            {c.key.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}
