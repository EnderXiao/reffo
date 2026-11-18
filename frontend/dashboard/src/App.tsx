import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Activity01Icon, FileExclamationPointIcon, RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import DitherWave from "@/components/react-bits/dither-wave";
import ErrorTable from "@/components/blocks/error-table";
import StatCard from "@/components/charts/StatCard";
import LineChart from "@/components/charts/LineChart";
import { StackedBars } from "@/components/charts/bencho/StackedBars";
import BarChart from "@/components/charts/BarChart";
import PieChart from "@/components/charts/PieChart";
import ChartRenderer from "@/components/charts/ChartRenderer";
import DetailModal from "@/components/DetailModal";
import { fetchErrors, fetchIssues, fetchQuery, fetchPages, fetchPage, fetchAnalytics, fetchDaySeries, fetchTrackingRequirements, createTrackingRequirement, updateTrackingRequirementStatus, type ChartDatum, type ChartConfig, type DashboardPage, type ErrorEvent, type AnalyticsEvent, type TrendSeriesPoint, type TrackingRequirement, type Issue } from "@/services/dashboard";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const glassCard = "relative overflow-hidden rounded-2xl border border-white/25 bg-[#1a1430]/75 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.5)]";
const glassTab = "flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[14px] font-[450] text-white/70 transition-colors hover:text-white aria-selected:bg-white/15 aria-selected:text-white";
const PAGE_SIZE = 20;

// 页面字段归一化：服务层/文件路径归入业务页面分类
function pageLabel(page: string): string {
  const map: Record<string, string> = {
    "pages/auth": "登录/注册页",
    "pages/create": "创建页",
    "pages/result": "结果页",
    "首页任务卡片": "首页",
  };
  return map[page] ?? page;
}

function collectCategories(series: TrendSeriesPoint[], topN = 3): string[] {
  const freq = new Map<string, number>();
  series.forEach((d) => d.series.forEach((s) => freq.set(s.key, (freq.get(s.key) ?? 0) + s.value)));
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);
}

type TabKey = "errors" | "analytics" | "page" | "requirements" | "implemented";

function GlassCard({ title, caption, children, className }: { title?: string; caption?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx(glassCard, "p-5", className)}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-[500] tracking-tight text-white">{title}</h2>
          {caption && <span className="text-[12px] font-[450] tabular-nums text-white/85">{caption}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("errors");
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [errorTrend, setErrorTrend] = useState<ChartDatum[]>([]);
  const [errorSeries, setErrorSeries] = useState<TrendSeriesPoint[]>([]);
  const [analyticsSeries, setAnalyticsSeries] = useState<TrendSeriesPoint[]>([]);
  const [errorCats, setErrorCats] = useState<string[]>([]);
  const [analyticsCats, setAnalyticsCats] = useState<string[]>([]);
  const [analyticsTrend, setAnalyticsTrend] = useState<ChartDatum[]>([]);
  const [eventDist, setEventDist] = useState<ChartDatum[]>([]);
  const [traceSearch, setTraceSearch] = useState("");
  const [traceResult, setTraceResult] = useState<ErrorEvent[] | null>(null);
  const [pages, setPages] = useState<DashboardPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<DashboardPage | null>(null);
  const [pageCharts, setPageCharts] = useState<ChartConfig[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AnalyticsEvent | null>(null);
  const [analyticsList, setAnalyticsList] = useState<AnalyticsEvent[]>([]);
  const [requirements, setRequirements] = useState<TrackingRequirement[]>([]);
  const [reqForm, setReqForm] = useState({ eventName: "", params: "", page: "", description: "" });
  const [reqPageFilter, setReqPageFilter] = useState<string | null>(null);
  const [reqStatusFilter, setReqStatusFilter] = useState<"all" | "pending" | "implemented">("all");
  const [reqSearch, setReqSearch] = useState("");
  const [showReqForm, setShowReqForm] = useState(false);
  const [implPageFilter, setImplPageFilter] = useState<string | null>(null);

  const loadAll = () => {
    fetchErrors({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => { setErrors(r.errors); setHasMore(r.hasMore); setLoading(false); })
      .catch(() => setLoading(false));
    void fetchIssues().then((r) => setIssues(r.issues)).catch(() => undefined);
    void fetchQuery({ source: "errors", groupBy: "day", range: 7 }).then((r) => setErrorTrend(r.rows)).catch(() => undefined);
    void fetchQuery({ source: "analytics", groupBy: "day", range: 7 }).then((r) => setAnalyticsTrend(r.rows)).catch(() => undefined);
    void fetchQuery({ source: "analytics", groupBy: "event_name", limit: 10 }).then((r) => setEventDist(r.rows)).catch(() => undefined);
    void fetchDaySeries({ source: "errors", dimension: "fingerprint", range: 7, topN: 3 }).then((r) => { setErrorSeries(r.rows); setErrorCats(collectCategories(r.rows)); }).catch(() => undefined);
    void fetchDaySeries({ source: "analytics", dimension: "event_name", range: 7, topN: 3 }).then((r) => { setAnalyticsSeries(r.rows); setAnalyticsCats(collectCategories(r.rows)); }).catch(() => undefined);
    void fetchAnalytics({ limit: 50 }).then((r) => setAnalyticsList(r.events)).catch(() => undefined);
    void fetchTrackingRequirements().then((r) => setRequirements(r.requirements)).catch(() => undefined);
  };

  useEffect(() => { setLoading(true); loadAll(); void fetchPages().then((r) => setPages(r.pages)).catch(() => undefined); }, [page]);

  useEffect(() => {
    if (!selectedPage) { setPageCharts([]); return; }
    void fetchPage(selectedPage.id).then((r) => setPageCharts(r.charts)).catch(() => undefined);
  }, [selectedPage]);

  useEffect(() => {
    const q = traceSearch.trim();
    if (!q) { setTraceResult(null); return; }
    const timer = setTimeout(() => {
      void fetchErrors({ limit: 20, traceId: q }).then((r) => setTraceResult(r.errors)).catch(() => setTraceResult([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [traceSearch]);

  const todayCount = errors.filter((e) => e.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const totalAnalytics = eventDist.reduce((s, d) => s + d.value, 0);
  const activeTab: TabKey = selectedPage ? "page" : tab;
  const reqPages = Array.from(new Set(requirements.map((r) => pageLabel(r.page))));
  const filteredReqs = requirements.filter((r) => (
    (!reqPageFilter || pageLabel(r.page) === reqPageFilter) &&
    (reqStatusFilter === "all" || r.status === reqStatusFilter) &&
    (!reqSearch.trim() || r.event_name.toLowerCase().includes(reqSearch.trim().toLowerCase()) || r.description.includes(reqSearch.trim()))
  ));
  const implementedReqs = requirements.filter((r) => r.status === "implemented" && (!implPageFilter || pageLabel(r.page) === implPageFilter));

  return (
    <div className="relative h-dvh w-full overflow-hidden text-white">
      <DitherWave className="absolute inset-0" speed={0.3} primaryColor="#6d28d9" secondaryColor="#3b0764" tertiaryColor="#a78bfa" opacity={0.7} />
      <div className="relative z-10 flex h-full flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <HugeiconsIcon icon={Activity01Icon} size={22} strokeWidth={1.8} aria-hidden="true" className="text-white/90" />
            <h1 className="text-[18px] font-[550] tracking-tight text-white">Reffo 看板</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/10 p-1 backdrop-blur-xl">
              <button type="button" aria-selected={activeTab === "errors"} className={glassTab} onClick={() => { setTab("errors"); setSelectedPage(null); }}>
                <HugeiconsIcon icon={FileExclamationPointIcon} size={15} strokeWidth={1.8} aria-hidden="true" />
                错误监控
              </button>
              <button type="button" aria-selected={activeTab === "analytics"} className={glassTab} onClick={() => { setTab("analytics"); setSelectedPage(null); }}>
                <HugeiconsIcon icon={Activity01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
                埋点分析
              </button>
              <button type="button" aria-selected={activeTab === "requirements"} className={glassTab} onClick={() => { setTab("requirements"); setSelectedPage(null); }}>
                埋点需求
              </button>
              <button type="button" aria-selected={activeTab === "implemented"} className={glassTab} onClick={() => { setTab("implemented"); setSelectedPage(null); }}>
                已上线埋点
              </button>
              {pages.map((p) => (
                <button key={p.id} type="button" aria-selected={selectedPage?.id === p.id} className={glassTab} onClick={() => setSelectedPage(p)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="relative flex items-center">
              <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-3 text-white/75" />
              <input className="h-9 w-[240px] rounded-xl border border-white/25 bg-white/10 pl-9 pr-3 text-[14px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 transition-colors hover:border-white/35 focus:border-white/45" placeholder="按 traceId 搜索" value={traceSearch} onChange={(e) => setTraceSearch(e.target.value)} />
            </div>
            <button type="button" aria-label="刷新" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 backdrop-blur-xl hover:text-white" onClick={() => { setLoading(true); loadAll(); }}>
              <HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {activeTab === "page" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {pageCharts.map((chart) => (
                <GlassCard key={chart.id} title={chart.title} caption={chart.chart_type} className={chart.chart_type === "bar" || chart.chart_type === "funnel" || chart.chart_type === "table" ? "md:col-span-2" : ""}>
                  <ChartRenderer chart={chart} />
                </GlassCard>
              ))}
              {pageCharts.length === 0 && <p className="col-span-full py-12 text-center text-[13px] text-white/75">该页面暂无图表，可通过 MCP 添加</p>}
            </div>
          ) : tab === "errors" ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <GlassCard title="错误总数" caption="当前页"><div className="text-[28px] font-[500] tabular-nums text-white">{errors.length}</div></GlassCard>
              <GlassCard title="今日错误" caption="今日"><div className="text-[28px] font-[500] tabular-nums text-white">{todayCount}</div></GlassCard>
              <GlassCard title="活跃 Issue" caption="分组"><div className="text-[28px] font-[500] tabular-nums text-white">{issues.length}</div></GlassCard>
              <GlassCard title="最高频错误" caption="次数"><div className="text-[28px] font-[500] tabular-nums text-white">{issues[0] ? issues[0].count + "×" : "—"}</div></GlassCard>

              <GlassCard title="错误趋势" caption="每日 top 3 · 悬停看明细" className="col-span-2"><StackedBars data={errorSeries} categories={errorCats} /></GlassCard>
              <GlassCard title="错误列表" caption="分页" className="col-span-2"><ErrorTable errors={traceResult ?? errors} loading={loading} hasMore={hasMore && !traceResult} page={page} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} onRowClick={setSelectedError} /></GlassCard>
            </div>
          ) : tab === "requirements" ? (
            <div className="flex h-full flex-col gap-4">
              <GlassCard>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  <span className="mr-1 text-[12px] font-[500] text-white/60">状态</span>
                  {(["all", "pending", "implemented"] as const).map((s) => (
                    <button key={s} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqStatusFilter === s ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => setReqStatusFilter(s)}>
                      {s === "all" ? "全部" : s === "pending" ? "待实现" : "已上线"}
                    </button>
                  ))}
                  <span className="mx-2 h-4 w-px bg-white/15" />
                  <span className="text-[12px] font-[500] text-white/60">页面</span>
                  <button type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === null ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => setReqPageFilter(null)}>全部</button>
                  {reqPages.map((pg) => (
                    <button key={pg} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === pg ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => setReqPageFilter(reqPageFilter === pg ? null : pg)}>
                      {pg}
                    </button>
                  ))}
                  <div className="ms-auto flex items-center gap-2">
                    <input className="h-8 w-[200px] rounded-lg border border-white/25 bg-white/10 px-3 text-[12px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 focus:border-white/45" placeholder="搜索事件名 / 描述" value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} />
                    <button type="button" className="h-8 shrink-0 rounded-lg border border-white/25 bg-white/15 px-3 text-[12px] font-[500] text-white transition-colors hover:bg-white/25" onClick={() => setShowReqForm(true)}>+ 新增埋点</button>
                  </div>
                </div>
              </GlassCard>
              <GlassCard title={"埋点需求（" + filteredReqs.length + "）"} caption="点击状态徽章切换 pending / implemented">
                <div className="max-h-[calc(100vh-320px)] overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
                    <thead>
                      <tr>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">事件名</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">参数</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">页面</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">业务描述</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredReqs.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-white/60">没有匹配的埋点需求</td></tr>
                      ) : (
                        filteredReqs.map((r) => (
                          <tr key={r.id} className="transition-colors hover:bg-white/5">
                            <td className="px-3 py-2.5 font-mono text-[12.5px] font-[500] text-white">{r.event_name}</td>
                            <td className="px-3 py-2.5 text-[12px] text-white/70">{r.params.length > 0 ? r.params.join(", ") : "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-white/70">{pageLabel(r.page)}</td>
                            <td className="max-w-[360px] px-3 py-2.5 text-[12px] text-white/60">{r.description}</td>
                            <td className="px-3 py-2.5">
                              <button type="button" className={"shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-[500] transition-colors " + (r.status === "implemented" ? "bg-emerald-400/20 text-emerald-300 hover:bg-emerald-400/30" : "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30")} onClick={() => {
                                const next = r.status === "implemented" ? "pending" : "implemented";
                                void updateTrackingRequirementStatus(r.id, next).then(() => {
                                  void fetchTrackingRequirements().then((x) => setRequirements(x.requirements)).catch(() => undefined);
                                }).catch(() => undefined);
                              }}>
                                {r.status === "implemented" ? "已上线" : "待实现"}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          ) : tab === "implemented" ? (
            <div className="flex h-full flex-col gap-4">
              <GlassCard>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-[500] text-white/60">页面</span>
                  <button type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (implPageFilter === null ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => setImplPageFilter(null)}>全部</button>
                  {reqPages.map((pg) => (
                    <button key={pg} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (implPageFilter === pg ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => setImplPageFilter(implPageFilter === pg ? null : pg)}>
                      {pg}
                    </button>
                  ))}
                  <span className="ms-auto text-[12px] tabular-nums text-white/60">共 {implementedReqs.length} 个 · 对照实际收到的埋点数据</span>
                </div>
              </GlassCard>
              <GlassCard title={"已上线埋点（" + implementedReqs.length + "）"}>
                <div className="max-h-[calc(100vh-320px)] overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
                    <thead>
                      <tr>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">事件名</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">参数</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">页面</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">业务描述</th>
                        <th className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70">实际上报</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {implementedReqs.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-white/60">暂无已上线埋点</td></tr>
                      ) : (
                        implementedReqs.map((r) => {
                          const received = eventDist.find((e) => e.key === r.event_name);
                          return (
                            <tr key={r.id} className="transition-colors hover:bg-white/5">
                              <td className="px-3 py-2.5 font-mono text-[12.5px] font-[500] text-white">{r.event_name}</td>
                              <td className="px-3 py-2.5 text-[12px] text-white/70">{r.params.length > 0 ? r.params.join(", ") : "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-white/70">{pageLabel(r.page)}</td>
                              <td className="max-w-[360px] px-3 py-2.5 text-[12px] text-white/60">{r.description}</td>
                              <td className={"px-3 py-2.5 tabular-nums " + (received ? "text-emerald-300" : "text-white/50")}>
                                {received ? received.value + " 次" : "暂无"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <GlassCard title="埋点总数" caption="聚合"><div className="text-[28px] font-[500] tabular-nums text-white">{totalAnalytics}</div></GlassCard>
              <GlassCard title="事件种类" caption="去重"><div className="text-[28px] font-[500] tabular-nums text-white">{eventDist.length}</div></GlassCard>
              <GlassCard title="最高频事件" caption="次数"><div className="text-[28px] font-[500] tabular-nums text-white">{eventDist[0] ? eventDist[0].value + "×" : "—"}</div></GlassCard>
              <GlassCard title="今日埋点" caption="今日"><div className="text-[28px] font-[500] tabular-nums text-white">—</div></GlassCard>

              <GlassCard title="埋点趋势" caption="每日 top 3 · 悬停看明细" className="col-span-2"><StackedBars data={analyticsSeries} categories={analyticsCats} /></GlassCard>
              <GlassCard title="事件占比" caption="饼图"><PieChart data={eventDist} /></GlassCard>
              <GlassCard title="事件分布" caption="柱状"><BarChart data={eventDist} /></GlassCard>
              <GlassCard title="埋点明细" caption="点击查看上下文" className="col-span-2">
                <div className="divide-y divide-white/10">
                  {analyticsList.length === 0 ? (
                    <p className="py-6 text-center text-[13px] text-white/75">暂无埋点</p>
                  ) : (
                    analyticsList.map((ev, i) => (
                      <button key={i} type="button" className="flex w-full items-center gap-3 px-2 py-2.5 text-left text-[13px] transition-colors hover:bg-white/5" onClick={() => setSelectedEvent(ev)}>
                        <span className="min-w-0 flex-1 truncate text-white">{ev.event_name}</span>
                        <span className="text-white/75">{ev.session_id.slice(0, 8)}</span>
                        <span className="tabular-nums text-white/75">{new Date(ev.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </button>
                    ))
                  )}
                </div>
              </GlassCard>
            </div>
          )}
        </main>
      </div>

    {selectedError && (
      <DetailModal title="错误详情" onClose={() => setSelectedError(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><span className="font-[450] text-neutral-100">路径：</span><span className="break-all text-white">{selectedError.path}</span></div>
            <div><span className="font-[450] text-neutral-100">方法：</span><span className="text-white">{selectedError.method}</span></div>
            <div><span className="font-[450] text-neutral-100">状态：</span><span className="text-white">{selectedError.status ?? "—"}</span></div>
            <div><span className="font-[450] text-neutral-100">错误码：</span><span className="text-white">{selectedError.error_code ?? "—"}</span></div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">Trace ID</div>
            <div className="break-all rounded-lg bg-black/50 p-2.5 font-mono text-[12px] leading-relaxed text-white">{selectedError.trace_id}</div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">错误信息</div>
            <div className="break-all rounded-lg bg-black/50 p-2.5 text-[13px] leading-relaxed text-white">{selectedError.error_message}</div>
          </div>
          {selectedError.error_stack && (
            <div>
              <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">调用栈</div>
              <pre className="max-h-[300px] overflow-x-auto overflow-y-auto rounded-lg bg-black/50 p-3 font-mono text-[13px] leading-6 whitespace-pre text-neutral-100">{selectedError.error_stack}</pre>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">上下文</div>
            <pre className="max-h-[200px] overflow-auto rounded-lg bg-black/50 p-3 text-[13px] leading-6 whitespace-pre-wrap break-words text-neutral-100">{Object.keys(selectedError.context ?? {}).length > 0 ? JSON.stringify(selectedError.context, null, 2) : '暂无上下文数据'}</pre>
          </div>
        </div>
      </DetailModal>
    )}

    {showReqForm && (
      <DetailModal title="新增埋点需求" onClose={() => setShowReqForm(false)}>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">埋点 id</div>
            <input className="h-10 w-full rounded-xl border border-white/20 bg-black/40 px-3 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/40" placeholder="如 click_xxx / view_xxx" value={reqForm.eventName} onChange={(e) => setReqForm((f) => ({...f, eventName: e.target.value}))} />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">上报参数（逗号分隔）</div>
            <input className="h-10 w-full rounded-xl border border-white/20 bg-black/40 px-3 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/40" placeholder="如 task_id, company" value={reqForm.params} onChange={(e) => setReqForm((f) => ({...f, params: e.target.value}))} />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">触发页面</div>
            <input className="h-10 w-full rounded-xl border border-white/20 bg-black/40 px-3 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/40" placeholder="如 首页 / pages/create" value={reqForm.page} onChange={(e) => setReqForm((f) => ({...f, page: e.target.value}))} />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">业务逻辑描述</div>
            <textarea className="min-h-[100px] w-full rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/40" placeholder="什么时候触发、上报什么" value={reqForm.description} onChange={(e) => setReqForm((f) => ({...f, description: e.target.value}))} />
          </div>
          <button type="button" className="h-10 w-full rounded-xl bg-white/15 text-[13px] font-[500] text-white transition-colors hover:bg-white/25" onClick={() => {
            if (!reqForm.eventName.trim() || !reqForm.page.trim() || !reqForm.description.trim()) return;
            void createTrackingRequirement({
              eventName: reqForm.eventName.trim(),
              params: reqForm.params.split(",").map((p) => p.trim()).filter(Boolean),
              page: reqForm.page.trim(),
              description: reqForm.description.trim(),
            }).then(() => {
              setReqForm({ eventName: "", params: "", page: "", description: "" });
              setShowReqForm(false);
              void fetchTrackingRequirements().then((r) => setRequirements(r.requirements)).catch(() => undefined);
            }).catch(() => undefined);
          }}>提交需求</button>
        </div>
      </DetailModal>
    )}

    {selectedEvent && (
      <DetailModal title="埋点详情" onClose={() => setSelectedEvent(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><span className="font-[450] text-neutral-100">事件：</span><span className="text-white">{selectedEvent.event_name}</span></div>
            <div><span className="font-[450] text-neutral-100">时间：</span><span className="text-white">{new Date(selectedEvent.created_at).toLocaleString("zh-CN")}</span></div>
            <div className="col-span-2"><span className="font-[450] text-neutral-100">Session：</span><span className="break-all text-white">{selectedEvent.session_id}</span></div>
            {selectedEvent.trace_id && <div className="col-span-2"><span className="font-[450] text-neutral-100">Trace：</span><span className="break-all text-white">{selectedEvent.trace_id}</span></div>}
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">属性</div>
            <pre className="max-h-[300px] overflow-auto rounded-lg bg-black/50 p-3 text-[13px] leading-6 whitespace-pre-wrap break-words text-neutral-100">{JSON.stringify(selectedEvent.properties ?? {}, null, 2)}</pre>
          </div>
        </div>
      </DetailModal>
    )}
    </div>
  );
}
