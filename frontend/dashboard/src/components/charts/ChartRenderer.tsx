import { useEffect, useState } from "react";
import StatCard from "./StatCard";
import LineChart from "./LineChart";
import BarChart from "./BarChart";
import PieChart from "./PieChart";
import FunnelChart from "./FunnelChart";
import { fetchQuery, type ChartDatum } from "@/services/dashboard";

export interface ChartConfig {
  id: string;
  page_id: string;
  chart_type: string;
  title: string;
  data_query: Record<string, unknown>;
  position: number;
}

export default function ChartRenderer({ chart }: { chart: ChartConfig }) {
  const [data, setData] = useState<ChartDatum[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = chart.data_query as { source?: 'errors' | 'analytics'; groupBy?: string; range?: number; limit?: number };
    void fetchQuery(q).then((r) => setData(r.rows)).catch(() => setData([])).finally(() => setLoading(false));
  }, [chart]);

  if (loading) return <div className="py-8 text-center text-[13px] text-neutral-900/40 dark:text-neutral-100/40">加载中…</div>;

  switch (chart.chart_type) {
    case "stat": {
      const total = data.reduce((s, d) => s + d.value, 0);
      return <StatCard label={chart.title} value={String(total)} delta="聚合值" positive />;
    }
    case "line":
      return <LineChart data={data} />;
    case "bar":
      return <BarChart data={data} />;
    case "pie":
      return <PieChart data={data} />;
    case "funnel":
      return <FunnelChart data={data} />;
    case "table":
      return (
        <div className="divide-y divide-neutral-900/8 dark:divide-neutral-100/8">
          {data.map((d) => (
            <div key={d.key} className="flex items-center justify-between px-4 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{d.key}</span>
              <span className="tabular-nums text-neutral-900/60 dark:text-neutral-100/60">{d.value}</span>
            </div>
          ))}
        </div>
      );
    default:
      return <LineChart data={data} />;
  }
}
