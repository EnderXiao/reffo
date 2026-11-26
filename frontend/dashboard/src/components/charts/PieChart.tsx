import { useState } from "react";
import { ChartDatum } from "./types";
import { CHART_PALETTE } from "./BarChart";

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  return "M" + cx + " " + cy + " L" + x1 + " " + y1 + " A" + r + " " + r + " 0 " + large + " 1 " + x2 + " " + y2 + " Z";
}

/**
 * 环形图：紫色系配色 + hover 扇区放大 + 中心联动显示 hover 项详情 + 图例 hover 联动。
 */
export default function PieChart({ data, donut = true }: { data: ChartDatum[]; donut?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0 || data.reduce((s, d) => s + d.value, 0) === 0) {
    return <div className="py-8 text-center text-[13px] text-white/60">暂无数据</div>;
  }
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 120;
  const cy = 120;
  const r = 92;
  const innerR = donut ? 58 : 0;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const outer = arcPath(cx, cy, r, start, end);
    const inner = innerR > 0 ? arcPath(cx, cy, innerR, end, start) : "";
    return { ...d, i, d: innerR > 0 ? outer + " " + inner : outer, color: CHART_PALETTE[i % CHART_PALETTE.length], start, end };
  });
  const active = hover != null ? slices[hover] : null;
  const centerLabel = active ? active.key : "总计";
  const centerValue = active ? String(active.value) : String(total);
  const centerSub = active ? Math.round((active.value / total) * 100) + "%" : "事件数";

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 240 240" className="h-56 w-56 shrink-0" role="img" aria-label="环形图">
        {slices.map((s) => {
          const isHover = hover === s.i;
          const scale = isHover ? 1.04 : 1;
          const origin = cx + " " + cy;
          return (
            <path
              key={s.key}
              d={s.d}
              fill={s.color}
              fillRule={innerR > 0 ? "evenodd" : undefined}
              opacity={hover != null && !isHover ? 0.45 : 0.95}
              style={{
                transform: "scale(" + scale + ")",
                transformOrigin: origin,
                transformBox: "view-box",
                transition: "transform 200ms cubic-bezier(0.2,0,0,1), opacity 200ms ease",
              }}
              onMouseEnter={() => setHover(s.i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            >
              <title>{s.key}: {s.value} ({Math.round((s.value / total) * 100)}%)</title>
            </path>
          );
        })}
        {donut && (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={28} fontWeight={600} fill="#ffffff">{centerValue}</text>
        )}
        {donut && (
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize={12} fill="#ffffff" fillOpacity={0.75}>{centerSub}</text>
        )}
        {donut && centerLabel.length > 12 && (
          <text x={cx} y={cy - 20} textAnchor="middle" fontSize={10} fill="#ffffff" fillOpacity={0.7}>{centerLabel.slice(0, 14) + "…"}</text>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => {
          const isHover = hover === s.i;
          return (
            <li
              key={s.key}
              className={"flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors " + (isHover ? "bg-white/10" : "hover:bg-white/5")}
              onMouseEnter={() => setHover(s.i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-white/90">{s.key}</span>
              <span className="tabular-nums text-white/80">{s.value} · {Math.round((s.value / total) * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
