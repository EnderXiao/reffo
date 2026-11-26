import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Activity01Icon, AiBrain01Icon, FileExclamationPointIcon, RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import DitherWave from "@/components/react-bits/dither-wave";
import ErrorTable from "@/components/blocks/error-table";
import { StackedBars } from "@/components/charts/bencho/StackedBars";
import BarChart from "@/components/charts/BarChart";
import PieChart from "@/components/charts/PieChart";
import ChartRenderer from "@/components/charts/ChartRenderer";
import DetailModal from "@/components/DetailModal";
import ErrorDetails from "@/components/ErrorDetails";
import DiagnosticsTab from "@/components/DiagnosticsTab";
import { fetchErrors, fetchIssues, fetchQuery, fetchPages, fetchPage, fetchAnalytics, fetchDaySeries, fetchTrackingPages, fetchTrackingRequirements, createTrackingRequirement, updateTrackingRequirementStatus, isAbortError, requestMessage, type ChartDatum, type ChartConfig, type DashboardPage, type DashboardSession, type ErrorEvent, type AnalyticsEvent, type TrendSeriesPoint, type TrackingRequirement, type Issue } from "@/services/dashboard";

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

type TabKey = "errors" | "analytics" | "page" | "requirements" | "implemented" | "diagnostics";

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

export default function App({ session, onLogout }: { session: DashboardSession; onLogout: () => void }) {
  const canWrite = session.role === "owner" && session.permissions.canWrite;
  const [tab, setTab] = useState<TabKey>("errors");
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [errorSeries, setErrorSeries] = useState<TrendSeriesPoint[]>([]);
  const [analyticsSeries, setAnalyticsSeries] = useState<TrendSeriesPoint[]>([]);
  const [errorCats, setErrorCats] = useState<string[]>([]);
  const [analyticsCats, setAnalyticsCats] = useState<string[]>([]);
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
  const [reqPages, setReqPages] = useState<string[]>([]);
  const [reqListPage, setReqListPage] = useState(1);
  const [reqHasMore, setReqHasMore] = useState(false);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState('');
  const [reqPagesError, setReqPagesError] = useState('');
  const [reqRevision, setReqRevision] = useState(0);
  const [debouncedReqSearch, setDebouncedReqSearch] = useState('');
  const trackingActive = !selectedPage && (tab === 'requirements' || tab === 'implemented');
  const trackingStatus = tab === 'implemented' ? 'implemented' : reqStatusFilter === 'all' ? undefined : reqStatusFilter;

  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshCooling, setRefreshCooling] = useState(true);
  const [dataError, setDataError] = useState('');
  const [listError, setListError] = useState('');
  const [traceError, setTraceError] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [writing, setWriting] = useState(false);
  const lastRefresh = useRef(Date.now());
  const writeController = useRef<AbortController>();

  useEffect(() => () => writeController.current?.abort(), []);

  useEffect(() => {
    const timer = setTimeout(() => setRefreshCooling(false), 3_000);
    return () => clearTimeout(timer);
  }, [revision]);

  function refresh() {
    if (refreshing || Date.now() - lastRefresh.current < 3_000) return;
    lastRefresh.current = Date.now();
    setRefreshCooling(true);
    setRevision((value) => value + 1);
  }

  // Pagination only reloads the error list; aggregates are refreshed explicitly.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    void fetchErrors({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setErrors(result.errors); setHasMore(result.hasMore); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setListError(requestMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setRefreshing(true);
    setDataError('');
    function apply<T>(promise: Promise<T>, update: (data: T) => void) {
      return promise.then((data) => { if (!signal.aborted) update(data); });
    }
    void Promise.allSettled([
      apply(fetchIssues(signal), (result) => setIssues(result.issues)),
      apply(fetchQuery({ source: "analytics", groupBy: "event_name", limit: 10 }, signal), (result) => setEventDist(result.rows)),
      apply(fetchDaySeries({ source: "errors", dimension: "fingerprint", range: 7, topN: 3 }, signal), (result) => { setErrorSeries(result.rows); setErrorCats(collectCategories(result.rows)); }),
      apply(fetchDaySeries({ source: "analytics", dimension: "event_name", range: 7, topN: 3 }, signal), (result) => { setAnalyticsSeries(result.rows); setAnalyticsCats(collectCategories(result.rows)); }),
      apply(fetchAnalytics({ limit: 50 }, signal), (result) => setAnalyticsList(result.events)),
      apply(fetchPages(signal), (result) => setPages(result.pages)),
    ]).then((results) => {
      if (signal.aborted) return;
      const failure = results.find((result) => result.status === 'rejected' && !isAbortError(result.reason));
      if (failure?.status === 'rejected') setDataError(requestMessage(failure.reason));
      setRefreshing(false);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    setPageCharts([]);
    setPageError('');
    if (!selectedPage) { setPageLoading(false); return; }
    const controller = new AbortController();
    setPageLoading(true);
    void fetchPage(selectedPage.id, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPageCharts(result.charts); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setPageError(requestMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setPageLoading(false); });
    return () => controller.abort();
  }, [selectedPage, revision]);

  useEffect(() => {
    const query = traceSearch.trim();
    setTraceResult(null);
    setTraceError('');
    if (!query) { setTraceLoading(false); return; }
    const controller = new AbortController();
    setTraceLoading(true);
    const timer = setTimeout(() => {
      void fetchErrors({ limit: PAGE_SIZE, traceId: query }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setTraceResult(result.errors); })
        .catch((error: unknown) => { if (!controller.signal.aborted) { setTraceError(requestMessage(error)); setTraceResult([]); } })
        .finally(() => { if (!controller.signal.aborted) setTraceLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [traceSearch, revision]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedReqSearch(reqSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [reqSearch]);

  useEffect(() => {
    if (!trackingActive) return;
    const controller = new AbortController();
    setReqPagesError('');
    void fetchTrackingPages(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setReqPages(result.pages); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setReqPagesError(requestMessage(error)); });
    return () => controller.abort();
  }, [trackingActive, revision, reqRevision]);

  useEffect(() => {
    if (!trackingActive) return;
    setReqLoading(true);
    setReqError('');
    setRequirements([]);
    setReqHasMore(false);
    if (reqSearch.trim() !== debouncedReqSearch) return;
    const controller = new AbortController();
    void fetchTrackingRequirements({
      status: trackingStatus,
      page: reqPageFilter ?? undefined,
      search: debouncedReqSearch || undefined,
      limit: PAGE_SIZE,
      offset: (reqListPage - 1) * PAGE_SIZE,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      // Return directly to the first page if concurrent changes emptied this page.
      if (result.requirements.length === 0 && reqListPage > 1) {
        setReqListPage(1);
        return;
      }
      setRequirements(result.requirements);
      setReqHasMore(result.hasMore);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setReqError(requestMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setReqLoading(false);
    });
    return () => controller.abort();
  }, [trackingActive, trackingStatus, reqPageFilter, reqSearch, debouncedReqSearch, reqListPage, revision, reqRevision]);

  async function saveRequirement(input?: TrackingRequirement) {
    if (!canWrite || writing) return;
    const controller = new AbortController();
    writeController.current = controller;
    setWriting(true);
    setMutationError('');
    try {
      if (input) {
        await updateTrackingRequirementStatus(input.id, input.status === 'implemented' ? 'pending' : 'implemented', controller.signal);
      } else {
        if (!reqForm.eventName.trim() || !reqForm.page.trim() || !reqForm.description.trim()) {
          setMutationError('请填写埋点 id、触发页面和业务描述');
          return;
        }
        await createTrackingRequirement({
          eventName: reqForm.eventName.trim(),
          params: reqForm.params.split(',').map((param) => param.trim()).filter(Boolean),
          page: reqForm.page.trim(),
          description: reqForm.description.trim(),
        }, controller.signal);
        if (controller.signal.aborted) return;
        setReqForm({ eventName: '', params: '', page: '', description: '' });
        setShowReqForm(false);
      }
      if (!controller.signal.aborted) setReqRevision((value) => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) setMutationError(requestMessage(error));
    } finally {
      if (!controller.signal.aborted) setWriting(false);
    }
  }

  const todayCount = errors.filter((e) => e.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const totalAnalytics = eventDist.reduce((s, d) => s + d.value, 0);
  const activeTab: TabKey = selectedPage ? "page" : tab;
  const trackingPagination = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-[12px] text-white/70">
      <span role="status">第 {reqListPage} 页 · 本页 {requirements.length} 条{reqHasMore ? ' · 还有更多' : ''}</span>
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 disabled:opacity-40" disabled={reqListPage <= 1 || reqLoading || writing} onClick={() => setReqListPage((value) => Math.max(1, value - 1))}>上一页</button>
        <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 disabled:opacity-40" disabled={!reqHasMore || reqLoading || writing || reqListPage * PAGE_SIZE > 10_000} onClick={() => setReqListPage((value) => value + 1)}>下一页</button>
      </div>
    </div>
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden text-white">
      <DitherWave className="absolute inset-0" speed={0.3} primaryColor="#6d28d9" secondaryColor="#3b0764" tertiaryColor="#a78bfa" opacity={0.7} />
      <div className="relative z-10 flex h-full flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <HugeiconsIcon icon={Activity01Icon} size={22} strokeWidth={1.8} aria-hidden="true" className="text-white/90" />
            <h1 className="text-[18px] font-[550] tracking-tight text-white">Reffo 看板</h1>
            <span className="whitespace-nowrap rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/80">{session.environment} · {session.role}{!canWrite && " · 只读"}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-white/10 p-1 backdrop-blur-xl">
              <button type="button" aria-selected={activeTab === "errors"} className={glassTab} onClick={() => { setTab("errors"); setSelectedPage(null); }}>
                <HugeiconsIcon icon={FileExclamationPointIcon} size={15} strokeWidth={1.8} aria-hidden="true" />
                错误监控
              </button>
              <button type="button" aria-selected={activeTab === "analytics"} className={glassTab} onClick={() => { setTab("analytics"); setSelectedPage(null); }}>
                <HugeiconsIcon icon={Activity01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
                埋点分析
              </button>
              <button type="button" aria-selected={activeTab === "requirements"} className={glassTab} onClick={() => { if (tab !== "requirements") setReqListPage(1); setTab("requirements"); setSelectedPage(null); }}>
                埋点需求
              </button>
              <button type="button" aria-selected={activeTab === "implemented"} className={glassTab} onClick={() => { if (tab !== "implemented") setReqListPage(1); setTab("implemented"); setSelectedPage(null); }}>
                已上线埋点
              </button>
              <button type="button" aria-selected={activeTab === "diagnostics"} className={glassTab} onClick={() => { setTab("diagnostics"); setSelectedPage(null); }}>
                <HugeiconsIcon icon={AiBrain01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
                AI 诊断
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
            <button type="button" aria-label="刷新" title="刷新间隔至少 3 秒" disabled={refreshing || refreshCooling} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 backdrop-blur-xl hover:text-white disabled:opacity-40" onClick={refresh}>
              <HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button type="button" className="h-9 rounded-full border border-white/15 bg-white/10 px-3 text-[12px] text-white/80 hover:text-white" onClick={onLogout}>退出</button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {(dataError || listError || traceError || pageError || mutationError || (trackingActive && (reqError || reqPagesError))) && (
            <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/25 bg-[#1a1430]/85 p-3 text-[13px] text-amber-100 backdrop-blur-xl">
              <span>{[dataError, listError, traceError, pageError, mutationError, ...(trackingActive ? [reqError, reqPagesError] : [])].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join('；')}</span>
              <button type="button" className="rounded-lg border border-white/20 px-3 py-1 disabled:opacity-40" disabled={refreshing || refreshCooling} onClick={refresh}>刷新重试</button>
            </div>
          )}
          {activeTab === "page" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {pageCharts.map((chart) => (
                <GlassCard key={chart.id} title={chart.title} caption={chart.chart_type} className={chart.chart_type === "bar" || chart.chart_type === "funnel" || chart.chart_type === "table" ? "md:col-span-2" : ""}>
                  <ChartRenderer chart={chart} refreshKey={revision} />
                </GlassCard>
              ))}
              {pageLoading && <p role="status" className="col-span-full py-12 text-center text-[13px] text-white/75">图表加载中…</p>}
              {!pageLoading && !pageError && pageCharts.length === 0 && <p className="col-span-full py-12 text-center text-[13px] text-white/75">该页面暂无图表，可通过 MCP 添加</p>}
            </div>
          ) : tab === "errors" ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <GlassCard title="错误总数" caption="当前页"><div className="text-[28px] font-[500] tabular-nums text-white">{errors.length}</div></GlassCard>
              <GlassCard title="今日错误" caption="今日"><div className="text-[28px] font-[500] tabular-nums text-white">{todayCount}</div></GlassCard>
              <GlassCard title="活跃 Issue" caption="分组"><div className="text-[28px] font-[500] tabular-nums text-white">{issues.length}</div></GlassCard>
              <GlassCard title="最高频错误" caption="次数"><div className="text-[28px] font-[500] tabular-nums text-white">{issues[0] ? issues[0].count + "×" : "—"}</div></GlassCard>

              <GlassCard title="错误趋势" caption="每日 top 3 · 悬停看明细" className="col-span-2"><StackedBars data={errorSeries} categories={errorCats} /></GlassCard>
              <GlassCard title="错误列表" caption="分页" className="col-span-2"><ErrorTable errors={traceResult ?? errors} loading={loading || traceLoading} hasMore={hasMore && !traceSearch.trim()} page={traceSearch.trim() ? 1 : page} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} onRowClick={setSelectedError} /></GlassCard>
            </div>
          ) : tab === "requirements" ? (
            <div className="flex h-full flex-col gap-4">
              <GlassCard>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  <span className="mr-1 text-[12px] font-[500] text-white/60">状态</span>
                  {(["all", "pending", "implemented"] as const).map((s) => (
                    <button key={s} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqStatusFilter === s ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => { setReqStatusFilter(s); setReqListPage(1); }}>
                      {s === "all" ? "全部" : s === "pending" ? "待实现" : "已上线"}
                    </button>
                  ))}
                  <span className="mx-2 h-4 w-px bg-white/15" />
                  <span className="text-[12px] font-[500] text-white/60">页面</span>
                  <button type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === null ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => { setReqPageFilter(null); setReqListPage(1); }}>全部</button>
                  {reqPages.map((pg) => (
                    <button key={pg} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === pg ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => { setReqPageFilter(reqPageFilter === pg ? null : pg); setReqListPage(1); }}>
                      {pg}
                    </button>
                  ))}
                  <div className="ms-auto flex items-center gap-2">
                    <input className="h-8 w-[200px] rounded-lg border border-white/25 bg-white/10 px-3 text-[12px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 focus:border-white/45" placeholder="搜索事件名 / 描述" value={reqSearch} onChange={(e) => { setReqSearch(e.target.value); setReqListPage(1); }} />
                    {canWrite && <button type="button" className="h-8 shrink-0 rounded-lg border border-white/25 bg-white/15 px-3 text-[12px] font-[500] text-white transition-colors hover:bg-white/25" onClick={() => { setMutationError(''); setShowReqForm(true); }}>+ 新增埋点</button>}
                  </div>
                </div>
              </GlassCard>
              <GlassCard title={"埋点需求（本页 " + requirements.length + "）"} caption={canWrite ? "点击状态徽章切换 pending / implemented" : "只读权限"}>
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
                      {reqLoading ? (
                        <tr><td colSpan={5} role="status" className="py-8 text-center text-[13px] text-white/60">加载中…</td></tr>
                      ) : reqError ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-amber-200">台账加载失败，请刷新重试</td></tr>
                      ) : requirements.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-white/60">没有匹配的埋点需求</td></tr>
                      ) : (
                        requirements.map((r) => (
                          <tr key={r.id} className="transition-colors hover:bg-white/5">
                            <td className="px-3 py-2.5 font-mono text-[12.5px] font-[500] text-white">{r.event_name}</td>
                            <td className="px-3 py-2.5 text-[12px] text-white/70">{r.params.length > 0 ? r.params.join(", ") : "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-white/70">{pageLabel(r.page)}</td>
                            <td className="max-w-[360px] px-3 py-2.5 text-[12px] text-white/60">{r.description}</td>
                            <td className="px-3 py-2.5">
                              <button type="button" disabled={!canWrite || writing} title={canWrite ? '切换状态' : '当前账号仅可查看'} className={"shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-[500] transition-colors disabled:cursor-default disabled:opacity-75 " + (r.status === "implemented" ? "bg-emerald-400/20 text-emerald-300 hover:enabled:bg-emerald-400/30" : "bg-amber-400/20 text-amber-300 hover:enabled:bg-amber-400/30")} onClick={() => { void saveRequirement(r); }}>
                                {r.status === "implemented" ? "已上线" : "待实现"}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {trackingPagination}
              </GlassCard>
            </div>
          ) : tab === "implemented" ? (
            <div className="flex h-full flex-col gap-4">
              <GlassCard>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-[500] text-white/60">页面</span>
                  <button type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === null ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => { setReqPageFilter(null); setReqListPage(1); }}>全部</button>
                  {reqPages.map((pg) => (
                    <button key={pg} type="button" className={"shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors " + (reqPageFilter === pg ? "bg-white/20 text-white" : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")} onClick={() => { setReqPageFilter(reqPageFilter === pg ? null : pg); setReqListPage(1); }}>
                      {pg}
                    </button>
                  ))}
                  <div className="ms-auto flex flex-wrap items-center gap-3">
                    <input className="h-8 w-[200px] rounded-lg border border-white/25 bg-white/10 px-3 text-[12px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 focus:border-white/45" placeholder="搜索事件名 / 描述" value={reqSearch} onChange={(e) => { setReqSearch(e.target.value); setReqListPage(1); }} />
                    <span className="text-[12px] tabular-nums text-white/60">本页 {requirements.length} 个 · 对照近7天实际收到的埋点数据</span>
                  </div>
                </div>
              </GlassCard>
              <GlassCard title={"已上线埋点（本页 " + requirements.length + "）"}>
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
                      {reqLoading ? (
                        <tr><td colSpan={5} role="status" className="py-8 text-center text-[13px] text-white/60">加载中…</td></tr>
                      ) : reqError ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-amber-200">台账加载失败，请刷新重试</td></tr>
                      ) : requirements.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-[13px] text-white/60">暂无已上线埋点</td></tr>
                      ) : (
                        requirements.map((r) => {
                          const received = r.received_count ?? 0;
                          return (
                            <tr key={r.id} className="transition-colors hover:bg-white/5">
                              <td className="px-3 py-2.5 font-mono text-[12.5px] font-[500] text-white">{r.event_name}</td>
                              <td className="px-3 py-2.5 text-[12px] text-white/70">{r.params.length > 0 ? r.params.join(", ") : "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-white/70">{pageLabel(r.page)}</td>
                              <td className="max-w-[360px] px-3 py-2.5 text-[12px] text-white/60">{r.description}</td>
                              <td className={"px-3 py-2.5 tabular-nums " + (received ? "text-emerald-300" : "text-white/50")}>
                                {received > 0 ? received + " 次" : "近7天暂无"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {trackingPagination}
              </GlassCard>
            </div>
          ) : tab === "diagnostics" ? (
            <DiagnosticsTab canWrite={canWrite} />
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

    {selectedError && <ErrorDetails error={selectedError} onClose={() => setSelectedError(null)} />}

    {showReqForm && canWrite && (
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
          {mutationError && <p role="alert" className="text-[13px] text-amber-200">{mutationError}</p>}
          <button type="button" disabled={!canWrite || writing} className="h-10 w-full rounded-xl bg-white/15 text-[13px] font-[500] text-white transition-colors hover:bg-white/25 disabled:opacity-40" onClick={() => { void saveRequirement(); }}>{writing ? '提交中…' : '提交需求'}</button>
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
