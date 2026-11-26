import { ChartDatum } from "./types";

export default function FunnelChart({ data }: { data: ChartDatum[] }) {
  const max = Math.max(1, data[0]?.value ?? 1);
  const h = 300;
  const pad = 20;
  const levels = data.length;
  const levelH = (h - pad * 2) / Math.max(1, levels);
  return (
    <svg viewBox={"0 0 600 " + h} className="w-full" role="img" aria-label="漏斗图">
      {data.map((d, i) => {
        const widthPct = d.value / max;
        const w = Math.max(60, widthPct * (600 - pad * 2));
        const x = (600 - w) / 2;
        const y = pad + i * levelH + 4;
        const ratio = i < levels - 1 ? (data[i + 1].value / max) * (600 - pad * 2) : w;
        const nextW = Math.max(60, ratio);
        const nextX = (600 - nextW) / 2;
        const nextY = y + levelH - 8;
        return (
          <g key={d.key}>
            <polygon
              points={x + "," + y + " " + (x + w) + "," + y + " " + (nextX + nextW) + "," + nextY + " " + nextX + "," + nextY}
              fill="oklch(60% 0.236 26)"
              opacity={0.25 + 0.6 * (1 - i / Math.max(1, levels - 1))}
            >
              <title>{d.key}: {d.value}</title>
            </polygon>
            <text x={600 / 2} y={y + levelH / 2} textAnchor="middle" fontSize={13} fill="currentColor" fontWeight={500}>
              {d.key} · {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
