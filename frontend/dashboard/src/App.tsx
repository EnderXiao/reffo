import { useEffect, useState } from "react";
import ErrorTable from "@/components/blocks/error-table";
import { fetchErrors, fetchErrorByTraceId, fetchIssues, fetchTrend, type ErrorEvent, type Issue, type TrendPoint } from "@/services/dashboard";

const PAGE_SIZE = 20;

function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const w = 640;
  const h = 160;
  const pad = 24;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: pad + i * step,
    y: h - pad - (p.count / max) * (h - pad * 2),
    ...p,
  }));
  const line = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x + " " + c.y).join(" ");
  return (
    <svg viewBox={"0 0 " + w + " " + h} className="w-full" role="img" aria-label="错误趋势">
      {coords.map((c) => (
        <line key={"g" + c.date} x1={c.x} y1={pad} x2={c.x} y2={h - pad} stroke="currentColor" strokeOpacity={0.08} />
      ))}
      <polyline points={line} fill="none" stroke="oklch(60% 0.236 26)" strokeWidth={2} />
      {coords.map((c) => (
        <g key={c.date}>
          <circle cx={c.x} cy={c.y} r={3} fill="oklch(60% 0.236 26)" />
          <text x={c.x} y={h - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.55}>
            {c.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function App() {
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [traceSearch, setTraceSearch] = useState("");
  const [traceResult, setTraceResult] = useState<ErrorEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchErrors({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setErrors(r.errors);
        setHasMore(r.hasMore);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    void fetchIssues().then((r) => setIssues(r.issues)).catch(() => undefined);
    void fetchTrend(7).then((r) => setTrend(r.trend)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = traceSearch.trim();
    if (!q) { setTraceResult(null); return; }
    const timer = setTimeout(() => {
      void fetchErrorByTraceId(q).then((r) => setTraceResult(r.errors)).catch(() => setTraceResult([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [traceSearch]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-neutral-900 dark:text-neutral-100">
      <h1 className="mb-4 text-[22px] font-[550] tracking-tight">Reffo 数据看板</h1>

      <section className="mb-6 rounded-lg border border-neutral-900/10 p-4 dark:border-neutral-100/14">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-[16px] font-[450]">错误趋势（近 7 天）</h2>
        </div>
        <TrendChart points={trend} />
      </section>

      <section className="mb-6">
        <ErrorTable
          errors={traceResult ?? errors}
          loading={loading}
          hasMore={hasMore && !traceResult}
          page={page}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      </section>

      <section className="rounded-lg border border-neutral-900/10 p-4 dark:border-neutral-100/14">
        <h2 className="mb-3 text-[16px] font-[450]">错误分组（Issue）</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-neutral-900/60 dark:text-neutral-100/60">按 traceId 定位：</span>
          <input
            className="h-7 w-[280px] rounded-md border border-neutral-900/12 bg-white px-2 text-[14px] outline-none dark:bg-neutral-900 dark:border-neutral-100/14"
            placeholder="粘贴 traceId 查询关联错误与埋点"
            value={traceSearch}
            onChange={(e) => setTraceSearch(e.target.value)}
          />
        </div>
        {issues.length === 0 ? (
          <p className="mt-3 text-[13px] text-neutral-900/50">暂无错误分组</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-900/8 dark:divide-neutral-100/8">
            {issues.slice(0, 10).map((issue) => (
              <li key={issue.fingerprint} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="tabular-nums text-neutral-900/60 dark:text-neutral-100/60">{issue.count}×</span>
                <span className="min-w-0 flex-1 truncate">{issue.latestMessage}</span>
                <span className="max-w-[280px] truncate text-neutral-900/50 dark:text-neutral-100/50">{issue.latestPath}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
