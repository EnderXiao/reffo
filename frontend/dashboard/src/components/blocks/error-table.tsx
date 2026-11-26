"use client";

import { useMemo, useState } from "react";
import type { ErrorEvent } from "@/services/dashboard";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const canvas = "bg-transparent";
const greyFrame = "bg-white/5";
const text1 = "text-white";
const text2 = "text-neutral-900/80 dark:text-neutral-100/80";
const rowsRuled = "divide-y divide-neutral-900/8 dark:divide-neutral-100/8";
const typeHeadingXs = "text-[16px]/[20px] font-[450] tracking-[-0.015em]";
const typeBody = "text-[14px]/[20px] font-normal";
const typeLabel = "text-[14px]/[16px] font-[450]";
const secondaryButton =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] border border-neutral-900/12 bg-white text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] hover:not-disabled:border-neutral-900/32 hover:not-disabled:bg-linear-to-b hover:not-disabled:from-neutral-900/3 hover:not-disabled:to-neutral-900/3 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:border-neutral-100/32 dark:hover:not-disabled:from-neutral-100/3 dark:hover:not-disabled:to-neutral-100/3 dark:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const buttonSm =
  "h-7 gap-1.5 rounded-[var(--rb-r-sm,6px)] px-3 text-[14px]/[16px] font-[450]";
const buttonMd =
  "h-8 gap-2 rounded-[var(--rb-r-sm,6px)] px-4 text-[14px]/[16px] font-[450]";
const inputBox =
  "relative flex w-full min-w-0 cursor-text items-center rounded-[var(--rb-r-sm,6px)] data-concentric:rounded-[var(--rb-r-lg,10px)] border border-neutral-900/12 bg-white text-[14px]/[16px] font-[450] text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] transition-[border-color,box-shadow,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-focus-within:not-has-[[aria-invalid=true]]:not-has-[input:disabled]:border-neutral-900/32 focus-within:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-within:ring-3 focus-within:ring-neutral-900/8 has-[[aria-invalid=true]]:border-[oklch(60%_0.236_26)] has-[input:disabled]:cursor-not-allowed has-[input:disabled]:border-neutral-900/8 has-[input:disabled]:text-neutral-900/40 has-[input:disabled]:shadow-none has-[input[readonly]]:cursor-default has-[input[readonly]]:border-transparent has-[input[readonly]]:bg-neutral-900/5 has-[input[readonly]]:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-focus-within:not-has-[[aria-invalid=true]]:not-has-[input:disabled]:border-neutral-100/32 dark:focus-within:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-within:ring-neutral-100/8 dark:has-[[aria-invalid=true]]:border-[oklch(65.2%_0.219_26)] dark:has-[input:disabled]:border-neutral-100/8 dark:has-[input:disabled]:text-neutral-100/40 dark:has-[input[readonly]]:bg-neutral-100/5";
const fieldSm = "h-7";
const inputControlSm =
  "h-full w-full min-w-0 flex-1 bg-transparent px-2 outline-none [[data-affix]+&]:ps-2 [&:has(+[data-affix])]:pe-2 placeholder:text-neutral-900/66 disabled:cursor-not-allowed disabled:placeholder:text-neutral-900/40 dark:placeholder:text-neutral-100/66 dark:disabled:placeholder:text-neutral-100/40 dark:[color-scheme:dark]";
const inputAffix =
  "flex shrink-0 items-center gap-2 text-[14px]/[16px] text-neutral-900/66 dark:text-neutral-100/66 select-none first:ps-3 last:pe-3 has-[button]:first:ps-1 has-[button]:last:pe-1";
const statusWord =
  "inline-flex items-start gap-1.5 text-[14px]/[16px] font-[450] tabular-nums";
const statusWordSm =
  "inline-flex items-start gap-1 text-[13px]/[18px] font-[450] tabular-nums";
const statusIdle = "text-white/70";
const statusOk = "text-white/85";
const statusWarn = "text-[oklch(85%_0.13_68)]";
const chip =
  "relative inline-flex h-7 max-w-full min-w-0 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[var(--rb-r-sm,6px)] border border-neutral-900/12 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 px-2.5 text-[14px]/[16px] font-[450] text-neutral-900 dark:text-neutral-100 select-none shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] transition-[background-color,border-color,color,scale,outline-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 hover:not-disabled:border-neutral-900/32 aria-pressed:border-neutral-900/32 aria-pressed:bg-neutral-900/9 aria-expanded:border-neutral-900/32 disabled:cursor-not-allowed disabled:text-neutral-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:hover:not-disabled:border-neutral-100/32 dark:aria-pressed:border-neutral-100/32 dark:aria-pressed:bg-neutral-100/16 dark:aria-expanded:border-neutral-100/32 dark:disabled:text-neutral-100/40";
const truncateFade =
  "block min-w-0 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]";
const frame =
  "relative flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100";
const itemRow =
  "relative flex min-h-10 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left text-neutral-900 dark:text-neutral-100 transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] has-[[data-description]]:min-h-14";
const itemMeta =
  "shrink-0 text-[13px]/[18px] tabular-nums text-neutral-900/66 dark:text-neutral-100/66";
const emptyTitle = "text-[16px]/[20px] font-[450] tracking-[-0.015em] text-white/90";
const emptyDescription =
  "max-w-[48ch] text-[13px]/[18px] text-neutral-900/80 dark:text-neutral-100/80";
const menuPopup =
  "min-w-48 max-w-[min(480px,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 p-1 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";
const menuItem =
  "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-[var(--rb-r-sm,6px)] px-2 py-1.5 text-left text-[14px]/[16px] font-[450] text-neutral-900 outline-none select-none [&_svg]:shrink-0 [&_svg]:text-neutral-900/80 hover:bg-neutral-900/5 focus-visible:bg-neutral-900/5 data-[highlighted]:bg-neutral-900/5 aria-selected:bg-neutral-900/9 aria-disabled:cursor-not-allowed aria-disabled:text-neutral-900/40 dark:text-neutral-100 dark:[&_svg]:text-neutral-100/80 dark:hover:bg-neutral-100/5 dark:focus-visible:bg-neutral-100/5 dark:data-[highlighted]:bg-neutral-100/5 dark:aria-selected:bg-neutral-100/9 dark:aria-disabled:text-neutral-100/40";
const menuItemCheckable = "ps-8";
const menuIndicator =
  "pointer-events-none absolute start-2 flex size-4 items-center justify-center";
const overlayEnter =
  "transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] starting:opacity-0 motion-reduce:transition-none";
const paginationInfo =
  "text-[13px]/[18px] tabular-nums text-white/70";
const table =
  "w-full border-separate border-spacing-0 text-left text-[14px]/[20px]";
const tableHead =
  "h-8 border-b border-white/10 px-3 text-left align-middle text-[12px]/[16px] font-[450] tabular-nums whitespace-nowrap text-white/70 first:ps-4 last:pe-4";
const tableRow =
  "group transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-aria-selected:bg-white/8";
const tableCell =
  "h-10 border-b border-white/8 px-3 align-middle whitespace-nowrap text-white/90 group-last:border-b-0 first:ps-4 last:pe-4";
const numericCell = "text-right tabular-nums";
const sortButton =
  "-mx-1.5 inline-flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-[var(--rb-r-sm,6px)] px-1.5 hover:bg-neutral-900/5 hover:text-neutral-900 data-sorted:text-neutral-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:hover:bg-neutral-100/5 dark:hover:text-neutral-100 dark:data-sorted:text-neutral-100";
const fadeStartOnTray =
  "bg-linear-to-r from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-900";
const fadeEndOnTray =
  "bg-linear-to-l from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-900";
const fadeBottom =
  "bg-linear-to-t from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950";

const gutter = "sm:first:ps-6 sm:last:pe-6";


function statusTone(status: number | null): string {
  if (status == null) return statusIdle;
  if (status >= 500) return statusWarn;
  if (status >= 400) return statusWarn;
  return statusOk;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface ErrorTableProps {
  errors: ErrorEvent[];
  loading?: boolean;
  hasMore?: boolean;
  page?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onRowClick?: (error: ErrorEvent) => void;
}

export default function ErrorTable({ errors, loading, hasMore, page = 1, onPrev, onNext, onRowClick }: ErrorTableProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return errors;
    return errors.filter((e) =>
      e.error_message.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      e.trace_id.toLowerCase().includes(q),
    );
  }, [errors, query]);

  return (
    <div className={cx(canvas, text1, "relative flex w-full flex-col")}>
      <header className={cx(greyFrame, "flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6")}>
        <h2 className={cx(typeHeadingXs, "min-w-0 flex-1 truncate")}>错误列表</h2>
        <div className={cx(inputBox, fieldSm, "w-[220px]")}>
          <input
            className={inputControlSm}
            placeholder="搜索路径 / 错误信息 / traceId"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="max-h-[440px] overflow-auto">
        <table className={cx(table, "min-w-[720px]")}>
          <caption className="sr-only">错误事件</caption>
          <thead className={cx(canvas, "sticky top-0 z-20")}>
            <tr>
              <th scope="col" className={cx(tableHead, "w-[90px]")}>状态</th>
              <th scope="col" className={cx(tableHead, "w-[80px]")}>方法</th>
              <th scope="col" className={cx(tableHead)}>路径</th>
              <th scope="col" className={cx(tableHead, "w-[170px]")}>时间</th>
            </tr>
          </thead>
          <tbody className={rowsRuled}>
            {loading ? (
              <tr><td colSpan={4} className={cx(tableCell, "text-center text-white/60")}>加载中…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className={cx(tableCell, "text-center")}>
                <p className={emptyTitle}>暂无错误</p>
              </td></tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} tabIndex={0} aria-label={"查看错误：" + e.path} className={cx(tableRow, "cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60")} onClick={() => onRowClick?.(e)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick?.(e); } }}>
                  <td className={tableCell}>
                    <span className={cx(statusWord, statusTone(e.status), "whitespace-nowrap")}>
                      {e.status ?? "—"}
                    </span>
                  </td>
                  <td className={tableCell}>{e.method}</td>
                  <td className={cx(tableCell, "max-w-[360px]")}>
                    <span className={truncateFade} title={e.path}>{e.path}</span>
                  </td>
                  <td className={cx(tableCell, "text-white/70")}>{formatTime(e.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className={cx(greyFrame, "flex h-12 shrink-0 items-center justify-between px-4")}>
        <span className={paginationInfo}>第 {page} 页 · 共 {filtered.length} 条</span>
        <div className="flex items-center gap-2">
          <button type="button" className={cx(secondaryButton, buttonSm)} disabled={page <= 1 || loading} onClick={onPrev}>上一页</button>
          <button type="button" className={cx(secondaryButton, buttonSm)} disabled={!hasMore || loading} onClick={onNext}>下一页</button>
        </div>
      </footer>
    </div>
  );
}
