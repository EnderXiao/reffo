import { useState } from "react";
import { ChartDatum } from "./types";

// 看板紫色系配色，与 dither-wave 背景协调
export const CHART_PALETTE = ["#a78bfa", "#8b5cf6", "#c4b5fd", "#ddd6fe", "#7c3aed", "#b39df0"];

/**
 * 柱状图：Y 轴刻度 + 水平网格线 + 渐变柱 + hover 高亮与 tooltip（bencho 风格丝滑悬停）。
 */
export default function BarChart({ data, color = "#a78bfa" }: { data: ChartDatum[]; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return <div className="py-8 text-center text-[13px] text-white/60">暂无数据</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640;
  const H = 240;
  const padL = 34;
  const padR = 12;
  const padT = 18;
  const padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const barW = data.length > 0 ? Math.min(64, plotW / data.length - 14) : 0;
  const gap = plotW / Math.max(1, data.length);
  const ticks = [0, 0.5, 1];

  return (
    <svg viewBox={"0 0 " + W + " " + H} className="w-full" role="img" aria-label="柱状图">
      <defs>
        <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = padT + plotH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#ffffff" strokeOpacity={0.3} strokeDasharray="3 4" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={10.5} fill="#ffffff" fillOpacity={0.7}>
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const bh = Math.max(2, (d.value / max) * plotH);
        const x = padL + i * gap + (gap - barW) / 2;
        const y = padT + plotH - bh;
        const isHover = hover === i;
        return (
          <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
            {isHover && (
              <rect x={x - 6} y={padT - 2} width={barW + 12} height={plotH + 2} rx={8} fill="#ffffff" fillOpacity={0.09} />
            )}
            <rect
              x={x} y={y} width={barW} height={bh} rx={7}
              fill="url(#bar-grad)"
              opacity={isHover ? 1 : 0.88}
              style={{ transition: "opacity 160ms ease, filter 160ms ease", filter: isHover ? "brightness(1.25)" : "none" }}
            />
            {isHover && (
              <g>
                <rect x={Math.min(Math.max(x + barW / 2 - 34, padL), W - padR - 68)} y={Math.max(y - 34, 2)} width={68} height={24} rx={8} fill="#241a45" stroke="#ffffff" strokeOpacity={0.5} />
                <text x={Math.min(Math.max(x + barW / 2, padL + 34), W - padR - 34)} y={Math.max(y - 18, 18)} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff">
                  {d.value}
                </text>
              </g>
            )}
            <text x={x + barW / 2} y={y - 7} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff" fillOpacity={isHover ? 1 : 0.85} style={{ transition: "opacity 160ms ease" }}>
              {d.value}
            </text>
            <text x={x + barW / 2} y={H - padB + 20} textAnchor="middle" fontSize={10.5} fill="#ffffff" fillOpacity={isHover ? 0.95 : 0.7} style={{ transition: "opacity 160ms ease" }}>
              {d.key.length > 16 ? d.key.slice(0, 15) + "…" : d.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
