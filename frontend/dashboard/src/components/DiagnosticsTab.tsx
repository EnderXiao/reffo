import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiBrain01Icon, ArrowLeft01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import {
  fetchDiagnosticSummary, fetchDiagnosticRuns, fetchDiagnosticRun, requestDiagnosticAnalysis,
  requestMessage,
  type DiagnosisSummary, type DiagnosticRunItem, type DiagnosticRunDetail, type DiagnosticAnalysisResult,
  type DiagnosticEvent, type DiagnosticProviderCall,
} from "@/services/dashboard";
import { rootCauseClassLabel, confidenceLabel, durationMsLabel, tokenLabel } from "@/components/diagnostics-format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const glassCard = "relative overflow-hidden rounded-2xl border border-white/25 bg-[#1a1430]/75 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.5)]";
const pill = "shrink-0 cursor-pointer rounded-full px-3 py-1 text-[12px] font-[450] transition-colors ";
const pillActive = "bg-white/20 text-white";
const pillIdle = "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white";
const PAGE_SIZE = 20;
const DAY_OPTIONS = [1, 3, 7, 14] as const;
type Days = (typeof DAY_OPTIONS)[number];

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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function eventKindTone(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.includes("success")) return "bg-emerald-400/20 text-emerald-300";
  if (lower.includes("fail") || lower.includes("error")) return "bg-rose-400/20 text-rose-300";
  return "bg-white/10 text-white/80";
}

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "bg-emerald-400/20 text-emerald-300";
  if (confidence === "medium") return "bg-amber-400/20 text-amber-300";
  return "bg-white/15 text-white/60";
}

function payloadText(payload: DiagnosticEvent["payload"]): string {
  return Object.entries(payload)
    .map(([key, value]) => {
      const text = value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return key + "=" + text;
    })
    .join(" · ");
}

function SummaryGrid({ summary, loading, error }: { summary: DiagnosisSummary | null; loading: boolean; error: string }) {
  const stats = [
    { title: "失败运行", caption: "窗口内", value: summary ? String(summary.failedRuns) : "—" },
    { title: "失败任务", caption: "窗口内", value: summary ? String(summary.failedJobs) : "—" },
    { title: "Provider 调用", caption: "窗口内", value: summary ? String(summary.providerAttempts) : "—" },
    { title: "调用失败率", caption: "providerFailures / attempts", value: summary ? (summary.failureRatePercent == null ? "—" : summary.failureRatePercent + "%") : "—" },
  ];
  const topList = (
    title: string,
    rows: { key: string; count: number }[] | undefined,
    mono = true,
  ) => (
    <GlassCard title={title} caption="按次数">
      {!summary ? (
        <p role="status" className="py-4 text-center text-[13px] text-white/60">{loading ? "加载中…" : error ? "加载失败" : "—"}</p>
      ) : rows && rows.length > 0 ? (
        <ol className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-[12.5px]">
              <span className={cx("min-w-0 flex-1 truncate text-white/85", mono && "font-mono")} title={row.key}>{row.key}</span>
              <span className="shrink-0 tabular-nums text-white/60">{row.count} 次</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-4 text-center text-[13px] text-white/60">暂无数据</p>
      )}
    </GlassCard>
  );
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <GlassCard key={stat.title} title={stat.title} caption={stat.caption}>
          <div className="text-[28px] font-[500] tabular-nums text-white">{stat.value}</div>
        </GlassCard>
      ))}
      <GlassCard title="窗口起始" caption="windowStart"><div className="text-[13px] text-white/90">{summary ? formatTime(summary.windowStart) : "—"}</div></GlassCard>
      {topList("高频错误码", summary?.topErrorCodes.map((row) => ({ key: row.code, count: row.count })))}
      {topList("高频失败类", summary?.topFailureClasses.map((row) => ({ key: row.class, count: row.count })))}
      {topList("高频模型", summary?.topModels.map((row) => ({ key: row.model, count: row.count })))}
    </div>
  );
}

function RunsTable({ runs, loading, error, onRowClick }: { runs: DiagnosticRunItem[]; loading: boolean; error: string; onRowClick: (run: DiagnosticRunItem) => void }) {
  return (
    <div className="max-h-[440px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
        <thead>
          <tr>
            {["运行 ID", "失败时间", "原因", "状态", "事件", "失败调用", "最大延迟", "模型", "错误码", "任务"].map((head) => (
              <th key={head} className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70 whitespace-nowrap">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {loading ? (
            <tr><td colSpan={10} role="status" className="py-8 text-center text-[13px] text-white/60">加载中…</td></tr>
          ) : error ? (
            <tr><td colSpan={10} className="py-8 text-center text-[13px] text-amber-200">失败运行加载失败，请刷新重试</td></tr>
          ) : runs.length === 0 ? (
            <tr><td colSpan={10} className="py-8 text-center text-[13px] text-white/60">暂无失败运行</td></tr>
          ) : (
            runs.map((run) => (
              <tr key={run.runId} className="cursor-pointer transition-colors hover:bg-white/5" onClick={() => onRowClick(run)}>
                <td className="max-w-[220px] truncate px-3 py-2.5 font-mono text-[12px] text-white" title={run.runId}>{run.runId}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-white/75">{formatTime(run.failedAt)}</td>
                <td className="max-w-[260px] truncate px-3 py-2.5 text-[12px] text-white/70" title={run.reason ?? undefined}>{run.reason ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-white/75">{run.status}</td>
                <td className="px-3 py-2.5 tabular-nums text-white/75">{run.eventCount}</td>
                <td className={"px-3 py-2.5 tabular-nums " + (run.failedCalls > 0 ? "text-rose-300" : "text-white/75")}>{run.failedCalls}</td>
                <td className="px-3 py-2.5 tabular-nums text-white/75">{durationMsLabel(run.maxLatencyMs)}</td>
                <td className="max-w-[200px] truncate px-3 py-2.5 text-[12px] text-white/70" title={run.models.join(", ")}>{run.models.join(", ") || "—"}</td>
                <td className="max-w-[200px] truncate px-3 py-2.5 font-mono text-[11.5px] text-rose-300/90" title={run.errorCodes.join(", ")}>{run.errorCodes.join(", ") || "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-[12px] text-white/60" title={run.jobId ? (run.jobStage ?? "") + " " + run.jobId : undefined}>{run.jobId ? ((run.jobStage ? run.jobStage + " · " : "") + run.jobId.slice(0, 8)) : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EventTimeline({ events }: { events: DiagnosticEvent[] }) {
  if (events.length === 0) return <p className="py-8 text-center text-[13px] text-white/60">暂无事件</p>;
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <div className="max-h-[420px] overflow-auto divide-y divide-white/10">
      {ordered.map((event) => {
        const stepName = typeof event.payload.stepName === "string" ? event.payload.stepName : null;
        const errorCode = typeof event.payload.errorCode === "string" ? event.payload.errorCode : null;
        return (
          <div key={event.id} className="px-2 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[11px] font-[500] text-white/85">{event.type}</span>
              {stepName && <span className="text-[13px] font-[500] text-white">{stepName}</span>}
              {errorCode && <span className="font-mono text-[12px] text-rose-300">{errorCode}</span>}
              <span className="ms-auto whitespace-nowrap text-[12px] tabular-nums text-white/60">{formatTime(event.occurredAt)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-white/55">
              {event.stepRunId && <span className="font-mono">step: {event.stepRunId}</span>}
              {event.attemptId && <span className="font-mono">attempt: {event.attemptId}</span>}
              {Object.keys(event.payload).length > 0 && <span className="min-w-0 truncate">{payloadText(event.payload)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProviderCallsTable({ calls }: { calls: DiagnosticProviderCall[] }) {
  if (calls.length === 0) return <p className="py-8 text-center text-[13px] text-white/60">暂无 Provider 调用</p>;
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-left text-[12.5px]">
        <thead>
          <tr>
            {["时间", "事件", "Provider", "模型", "阶段", "重试", "延迟", "tokens 入/出/推理", "错误码", "失败类", "HTTP"].map((head) => (
              <th key={head} className="sticky top-0 z-10 h-9 border-b border-white/10 bg-[#1a1430] px-3 text-[12px] font-[450] text-white/70 whitespace-nowrap">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {calls.map((call) => (
            <tr key={call.id} className="transition-colors hover:bg-white/5" title={call.callReason ?? undefined}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-white/70">{formatTime(call.occurredAt)}</td>
              <td className="px-3 py-2"><span className={cx("rounded-full px-2 py-0.5 text-[11px] font-[500] whitespace-nowrap", eventKindTone(call.eventKind))}>{call.eventKind}</span></td>
              <td className="px-3 py-2 text-white/85">{call.provider}</td>
              <td className="max-w-[180px] truncate px-3 py-2 font-mono text-[11.5px] text-white/85" title={call.model}>{call.model}</td>
              <td className="whitespace-nowrap px-3 py-2 text-white/70">{call.stage ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-white/70">{call.retryIndex}</td>
              <td className="px-3 py-2 tabular-nums text-white/75">{durationMsLabel(call.latencyMs)}</td>
              <td className="px-3 py-2 tabular-nums text-white/70">{tokenLabel(call.inputTokens)}/{tokenLabel(call.outputTokens)}/{tokenLabel(call.reasoningTokens)}</td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-rose-300/90">{call.errorCode ?? "—"}</td>
              <td className="max-w-[160px] truncate px-3 py-2 text-[11.5px] text-white/60" title={call.failureClass ?? undefined}>{call.failureClass ?? "—"}</td>
              <td className={"px-3 py-2 tabular-nums " + (call.providerStatus == null ? "text-white/50" : call.providerStatus >= 400 ? "text-rose-300" : "text-white/75")}>{call.providerStatus ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DiagnosticsTab({ canWrite }: { canWrite: boolean }) {
  const [days, setDays] = useState<Days>(7);
  const [summary, setSummary] = useState<DiagnosisSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [runs, setRuns] = useState<DiagnosticRunItem[]>([]);
  const [listPage, setListPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [errorFilter, setErrorFilter] = useState("");
  const [debouncedFilters, setDebouncedFilters] = useState({ model: "", error: "" });
  const [revision, setRevision] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiagnosticRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [analysis, setAnalysis] = useState<DiagnosticAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisController = useRef<AbortController | null>(null);

  useEffect(() => () => analysisController.current?.abort(), []);

  // 模型 / 错误码文本筛选 300ms 防抖，与看板其余搜索行为一致。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters({ model: modelFilter.trim(), error: errorFilter.trim() }), 300);
    return () => clearTimeout(timer);
  }, [modelFilter, errorFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError("");
    void fetchDiagnosticSummary(days, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setSummary(data); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setSummaryError(requestMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setSummaryLoading(false); });
    return () => controller.abort();
  }, [days, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    setRuns([]);
    setHasMore(false);
    if (modelFilter.trim() !== debouncedFilters.model || errorFilter.trim() !== debouncedFilters.error) {
      setListLoading(false);
      return () => controller.abort();
    }
    void fetchDiagnosticRuns({
      days,
      limit: PAGE_SIZE,
      offset: (listPage - 1) * PAGE_SIZE,
      model: debouncedFilters.model || undefined,
      error: debouncedFilters.error || undefined,
    }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        // 筛选变化清空当前页后回到第一页，避免停留在空页。
        if (result.runs.length === 0 && listPage > 1) { setListPage(1); return; }
        setRuns(result.runs);
        setHasMore(result.hasMore);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setListError(requestMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [days, listPage, modelFilter, errorFilter, debouncedFilters, revision]);

  useEffect(() => {
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    setAnalysis(null);
    setAnalysisError("");
    if (!selectedRunId) return;
    const controller = new AbortController();
    setDetailLoading(true);
    void fetchDiagnosticRun(selectedRunId, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setDetail(data); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(requestMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedRunId, revision]);

  function runAnalysis() {
    if (!selectedRunId || analyzing) return;
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysis(null);
    void requestDiagnosticAnalysis(selectedRunId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setAnalysis(result); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setAnalysisError(requestMessage(error)); })
      .finally(() => {
        if (!controller.signal.aborted) setAnalyzing(false);
        if (analysisController.current === controller) analysisController.current = null;
      });
  }

  const refreshButton = (
    <button type="button" aria-label="刷新 AI 诊断" title="重新拉取统计与列表" disabled={summaryLoading || listLoading || detailLoading || analyzing} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 transition-colors hover:text-white disabled:opacity-40" onClick={() => setRevision((value) => value + 1)}>
      <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );

  if (selectedRunId) {
    const job = detail?.job ?? null;
    const failure = job?.failure ?? null;
    const sample = detail?.failureSample ?? null;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-[13px] text-white/80 transition-colors hover:text-white" onClick={() => setSelectedRunId(null)}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
            返回列表
          </button>
          <h2 className="min-w-0 text-[15px] font-[500] tracking-tight text-white">运行详情 <span className="font-mono text-[12px] font-[450] text-white/60">{selectedRunId}</span></h2>
          {detailLoading && <span role="status" className="text-[12px] text-white/60">详情加载中…</span>}
          <div className="ms-auto">{refreshButton}</div>
        </div>
        {detailError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/25 bg-[#1a1430]/85 p-3 text-[13px] text-amber-100">
            <span>{detailError}</span>
            <button type="button" className="rounded-lg border border-white/20 px-3 py-1 disabled:opacity-40" disabled={summaryLoading || listLoading || detailLoading || analyzing} onClick={() => setRevision((value) => value + 1)}>重试</button>
          </div>
        )}
        {detail && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sample && (
                <GlassCard title="失败样例" caption="failureSample">
                  <dl className="grid grid-cols-2 gap-3 text-[13px]">
                    <div><dt className="text-[11px] uppercase tracking-wider text-white/50">原因</dt><dd className="mt-0.5 text-white/90">{sample.reason}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wider text-white/50">状态</dt><dd className="mt-0.5 font-mono text-white/90">{sample.status}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wider text-white/50">事件数</dt><dd className="mt-0.5 tabular-nums text-white/90">{sample.eventCount}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wider text-white/50">发生时间</dt><dd className="mt-0.5 tabular-nums text-white/90">{formatTime(sample.createdAt)}</dd></div>
                  </dl>
                </GlassCard>
              )}
              {job ? (
                <GlassCard title="关联任务" caption={"job " + job.id}>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-white/85">{job.status}</span>
                    <span className="text-white/70">阶段：<span className="text-white/90">{job.stage}</span></span>
                    <span className="text-white/70">创建：<span className="tabular-nums text-white/90">{formatTime(job.createdAt)}</span></span>
                    <span className="text-white/70">更新：<span className="tabular-nums text-white/90">{formatTime(job.updatedAt)}</span></span>
                  </div>
                  {job.error && <p className="mt-2 text-[12.5px] text-rose-300">{job.error}</p>}
                  {failure && (
                    <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3">
                      <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                        <span className="font-mono text-rose-300">{failure.code}</span>
                        <span className="text-white/80">阶段：{failure.stage}</span>
                        <span className={"rounded-full px-2 py-0.5 text-[11px] font-[500] " + (failure.retryable ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/70")}>{failure.retryable ? "可重试" : "不可重试"}</span>
                        <span className="text-white/80">动作：{failure.action}</span>
                        <span className="tabular-nums text-white/60">{formatTime(failure.occurredAt)}</span>
                      </div>
                      {failure.issueCodes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {failure.issueCodes.map((code) => <span key={code} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70">{code}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </GlassCard>
              ) : (
                <GlassCard title="关联任务" caption="job"><p className="py-4 text-center text-[13px] text-white/60">无关联任务</p></GlassCard>
              )}
            </div>
            <GlassCard title={"事件时间线（" + detail.events.length + "）"} caption="按发生时间正序">
              <EventTimeline events={detail.events} />
            </GlassCard>
            <GlassCard title={"Provider 调用（" + detail.providerCalls.length + "）"} caption="成功 / 失败着色">
              <ProviderCallsTable calls={detail.providerCalls} />
            </GlassCard>
          </>
        )}
        <GlassCard title="AI 分析" caption={analysis ? "模型 " + analysis.model : canWrite ? "调用后端诊断分析" : "只读"}>
          {!canWrite ? (
            <p className="py-4 text-center text-[13px] text-white/60">当前账号仅可查看，无 AI 分析权限</p>
          ) : analysis ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-[500]", confidenceTone(analysis.analysis.confidence))}>{confidenceLabel(analysis.analysis.confidence)}</span>
                <span className="text-[12.5px] text-white/60">根因分类：</span>
                <span className="text-[13px] text-white">{rootCauseClassLabel(analysis.analysis.rootCauseClass)}</span>
                <span className="font-mono text-[11px] text-white/45">{analysis.analysis.rootCauseClass}</span>
                <span className="ms-auto flex items-center gap-3 text-[11.5px] tabular-nums text-white/55">
                  <span>{analysis.events.length} 事件</span>
                  <span>{analysis.providerCalls.length} 调用</span>
                  <span>{formatTime(analysis.analyzedAt)}</span>
                </span>
              </div>
              <p className="rounded-xl bg-white/5 p-3 text-[13px] leading-relaxed text-white/90">{analysis.analysis.conclusion}</p>
              {analysis.analysis.confirmedEvidence.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-[500] text-emerald-300">已确认证据</div>
                  <ul className="space-y-0.5 text-[12.5px] text-white/80">{analysis.analysis.confirmedEvidence.map((item) => <li key={item} className="flex gap-2"><span className="shrink-0">✓</span><span>{item}</span></li>)}</ul>
                </div>
              )}
              {analysis.analysis.uncertainFactors.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-[500] text-amber-300">不确定因素</div>
                  <ul className="space-y-0.5 text-[12.5px] text-white/80">{analysis.analysis.uncertainFactors.map((item) => <li key={item} className="flex gap-2"><span className="shrink-0">?</span><span>{item}</span></li>)}</ul>
                </div>
              )}
              {analysis.analysis.recommendedActions.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-[500] text-white/70">建议动作</div>
                  <ul className="space-y-0.5 text-[12.5px] text-white/80">{analysis.analysis.recommendedActions.map((item) => <li key={item} className="flex gap-2"><span className="shrink-0">→</span><span>{item}</span></li>)}</ul>
                </div>
              )}
              {analysis.analysis.followUpQuestions.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-[500] text-white/70">待跟进问题</div>
                  <ul className="space-y-0.5 text-[12.5px] text-white/80">{analysis.analysis.followUpQuestions.map((item) => <li key={item} className="flex gap-2"><span className="shrink-0">✦</span><span>{item}</span></li>)}</ul>
                </div>
              )}
              <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/15 disabled:opacity-40" disabled={analyzing} onClick={runAnalysis}>重新分析</button>
            </div>
          ) : (
            <div className="space-y-3">
              {analyzing && <p role="status" className="flex items-center gap-2 py-2 text-[13px] text-white/75"><HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} aria-hidden="true" className="animate-spin" />AI 分析中，请稍候…</p>}
              {analysisError && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/25 bg-amber-400/10 p-3 text-[13px] text-amber-100">
                  <span>{analysisError}</span>
                  <button type="button" className="rounded-lg border border-white/20 px-3 py-1 disabled:opacity-40" disabled={analyzing} onClick={runAnalysis}>重试</button>
                </div>
              )}
              {!analyzing && !analysisError && (
                <button type="button" className="flex items-center gap-2 rounded-lg border border-white/25 bg-white/15 px-4 py-2 text-[13px] font-[500] text-white transition-colors hover:bg-white/25" onClick={runAnalysis}>
                  <HugeiconsIcon icon={AiBrain01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
                  开始分析
                </button>
              )}
            </div>
          )}
        </GlassCard>
      </div>
    );
  }

  const pagination = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-[12px] text-white/70">
      <span role="status">第 {listPage} 页 · 本页 {runs.length} 条{hasMore ? " · 还有更多" : ""}</span>
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 disabled:opacity-40" disabled={listPage <= 1 || listLoading} onClick={() => setListPage((value) => Math.max(1, value - 1))}>上一页</button>
        <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 disabled:opacity-40" disabled={!hasMore || listLoading || listPage * PAGE_SIZE > 10_000} onClick={() => setListPage((value) => value + 1)}>下一页</button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <GlassCard>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="mr-1 text-[12px] font-[500] text-white/60">范围</span>
          {DAY_OPTIONS.map((option) => (
            <button key={option} type="button" className={pill + (days === option ? pillActive : pillIdle)} onClick={() => { setDays(option); setListPage(1); }}>
              {option} 天
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-white/15" />
          <input className="h-8 w-[180px] rounded-lg border border-white/25 bg-white/10 px-3 text-[12px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 focus:border-white/45" placeholder="按模型筛选" value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setListPage(1); }} />
          <input className="h-8 w-[200px] rounded-lg border border-white/25 bg-white/10 px-3 text-[12px] text-white outline-none backdrop-blur-xl placeholder:text-white/55 focus:border-white/45" placeholder="按错误码筛选" value={errorFilter} onChange={(e) => { setErrorFilter(e.target.value); setListPage(1); }} />
          <div className="ms-auto">{refreshButton}</div>
        </div>
      </GlassCard>
      {(summaryError || listError) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/25 bg-[#1a1430]/85 p-3 text-[13px] text-amber-100">
          <span>{[summaryError, listError].filter(Boolean).join("；")}</span>
          <button type="button" className="rounded-lg border border-white/20 px-3 py-1 disabled:opacity-40" disabled={summaryLoading || listLoading} onClick={() => setRevision((value) => value + 1)}>刷新重试</button>
        </div>
      )}
      <SummaryGrid summary={summary} loading={summaryLoading} error={summaryError} />
      <GlassCard title={"失败运行（本页 " + runs.length + "）"} caption="点击行查看详情">
        <RunsTable runs={runs} loading={listLoading} error={listError} onRowClick={(run) => setSelectedRunId(run.runId)} />
        {pagination}
      </GlassCard>
    </div>
  );
}
