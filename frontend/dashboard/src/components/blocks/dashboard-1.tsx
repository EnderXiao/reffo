"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const canvas = "bg-white dark:bg-neutral-950";
const text1 = "text-neutral-900 dark:text-neutral-100";
const text3 = "text-neutral-900/66 dark:text-neutral-100/66";
const ruleBottom = "border-b border-neutral-900/8 dark:border-neutral-100/8";
const typeHeadingSm = "text-[20px]/[24px] font-[450] tracking-[-0.015em]";
const typeCaption = "text-[12px]/[16px] font-normal tabular-nums";
const selectTrigger =
  "inline-flex h-8 w-fit min-w-40 cursor-pointer items-center justify-between gap-2 rounded-[var(--rb-r-sm,6px)] border border-neutral-900/12 bg-white px-3 text-left text-[14px]/[16px] font-[450] whitespace-nowrap text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] outline-none select-none transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-disabled:not-aria-invalid:border-neutral-900/32 focus-visible:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-visible:ring-3 focus-visible:ring-neutral-900/8 aria-expanded:border-[var(--rb-accent,oklch(20.5%_0_0))] aria-expanded:ring-3 aria-expanded:ring-neutral-900/8 aria-invalid:border-[oklch(60%_0.236_26)] disabled:cursor-not-allowed disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:not-aria-invalid:border-neutral-100/32 dark:focus-visible:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-visible:ring-neutral-100/8 dark:aria-expanded:border-[var(--rb-accent,oklch(100%_0_0))] dark:aria-expanded:ring-neutral-100/8 dark:aria-invalid:border-[oklch(65.2%_0.219_26)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const selectCaret = "shrink-0 text-neutral-900/80 dark:text-neutral-100/80";
const frame =
  "relative flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100";
const frameTitle =
  "min-w-0 truncate text-[14px]/[16px] font-[450] text-neutral-900 dark:text-neutral-100";
const statGroup =
  "@container rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900";
const statGrid =
  "grid grid-cols-2 overflow-hidden [&>:last-child:nth-child(odd)]:col-span-full *:-mt-px *:-ml-px *:border-t *:border-l *:border-neutral-900/8 @md:grid-flow-col @md:grid-cols-none @md:auto-cols-fr @md:[&>:last-child:nth-child(odd)]:col-auto dark:*:border-neutral-100/8";
const statCell = "flex min-w-0 flex-col gap-2 px-4 py-3";
const statLabel =
  "text-[14px]/[16px] font-[450] text-neutral-900/80 dark:text-neutral-100/80";
const statValue =
  "flex min-w-0 flex-wrap items-baseline gap-x-1 text-[32px]/[36px] font-[450] tabular-nums text-neutral-900 dark:text-neutral-100";
const statDelta =
  "inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-[12px]/[16px] font-[450] tabular-nums [&>svg]:self-center text-neutral-900/80 dark:text-neutral-100/80";
const menuPopup =
  "min-w-48 max-w-[min(480px,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 p-1 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";
const menuItem =
  "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-[var(--rb-r-sm,6px)] px-2 py-1.5 text-left text-[14px]/[16px] font-[450] text-neutral-900 outline-none select-none [&_svg]:shrink-0 [&_svg]:text-neutral-900/80 hover:bg-neutral-900/5 focus-visible:bg-neutral-900/5 data-[highlighted]:bg-neutral-900/5 aria-selected:bg-neutral-900/9 aria-disabled:cursor-not-allowed aria-disabled:text-neutral-900/40 dark:text-neutral-100 dark:[&_svg]:text-neutral-100/80 dark:hover:bg-neutral-100/5 dark:focus-visible:bg-neutral-100/5 dark:data-[highlighted]:bg-neutral-100/5 dark:aria-selected:bg-neutral-100/9 dark:aria-disabled:text-neutral-100/40";
const overlayEnter =
  "transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] starting:opacity-0 motion-reduce:transition-none";
const chartGrid = "stroke-neutral-900/5 dark:stroke-neutral-100/5";
const chartZero = "stroke-neutral-900/8 dark:stroke-neutral-100/8";
const chartInk = "stroke-neutral-900 dark:stroke-neutral-100";
const chartBar = "fill-neutral-900 dark:fill-neutral-100";

type Metric = {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  spark: number[];
};

type Range = {
  key: string;
  compare: string;
  metrics: Metric[];
  months: string[];
  revenue: number[];
};

const SPARK = {
  revenue: [28, 31, 30, 36, 34, 41, 44, 43, 49, 52, 58, 61],
  accounts: [70, 72, 71, 74, 78, 79, 83, 86, 88, 90, 93, 97],
  contract: [61, 59, 60, 58, 57, 55, 56, 54, 53, 52, 51, 49],
  churn: [12, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18],
};

const Y_MAX = 500;
const Y_TICKS = [500, 375, 250, 125, 0];

const RANGES: Range[] = [
  {
    key: "Last 3 months",
    compare: "vs. prior 3 months",
    months: ["Jul", "Aug", "Sep"],
    revenue: [448, 466, 483],
    metrics: [
      {
        label: "Net revenue",
        value: "$1.40M",
        delta: "+9.8%",
        positive: true,
        spark: SPARK.revenue,
      },
      {
        label: "Paid accounts",
        value: "3,914",
        delta: "+2.1%",
        positive: true,
        spark: SPARK.accounts,
      },
      {
        label: "Average contract",
        value: "$1,278",
        delta: "−1.4%",
        positive: false,
        spark: SPARK.contract,
      },
      {
        label: "Monthly churn",
        value: "1.8%",
        delta: "+0.2 pp",
        positive: false,
        spark: SPARK.churn,
      },
    ],
  },
  {
    key: "Last 6 months",
    compare: "vs. prior 6 months",
    months: ["Apr", "May", "Jun", "Jul", "Aug", "Sep"],
    revenue: [371, 402, 419, 448, 466, 483],
    metrics: [
      {
        label: "Net revenue",
        value: "$2.59M",
        delta: "+12.4%",
        positive: true,
        spark: SPARK.revenue,
      },
      {
        label: "Paid accounts",
        value: "3,914",
        delta: "+4.1%",
        positive: true,
        spark: SPARK.accounts,
      },
      {
        label: "Average contract",
        value: "$1,284",
        delta: "−2.3%",
        positive: false,
        spark: SPARK.contract,
      },
      {
        label: "Monthly churn",
        value: "1.8%",
        delta: "+0.3 pp",
        positive: false,
        spark: SPARK.churn,
      },
    ],
  },
  {
    key: "Year to date",
    compare: "vs. same period last year",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"],
    revenue: [279, 301, 318, 371, 402, 419, 448, 466, 483],
    metrics: [
      {
        label: "Net revenue",
        value: "$3.49M",
        delta: "+22.8%",
        positive: true,
        spark: SPARK.revenue,
      },
      {
        label: "Paid accounts",
        value: "3,914",
        delta: "+14.2%",
        positive: true,
        spark: SPARK.accounts,
      },
      {
        label: "Average contract",
        value: "$1,292",
        delta: "−1.8%",
        positive: false,
        spark: SPARK.contract,
      },
      {
        label: "Monthly churn",
        value: "1.9%",
        delta: "+0.4 pp",
        positive: false,
        spark: SPARK.churn,
      },
    ],
  },
];

const isDown = (delta: string) => /^[−-]/.test(delta);

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 92 - ((v - min) / span) * 84;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className="hidden h-8 w-16 shrink-0 @min-[13rem]:block"
    >
      <polyline
        points={points}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className={chartInk}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RangeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const doc = rootRef.current?.ownerDocument ?? document;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    doc.addEventListener("pointerdown", onPointerDown);
    return () => doc.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.focus({ preventScroll: true });
  }, [open]);

  const openMenu = (index: number, withTransition: boolean) => {
    setActive(index);
    setAnimate(withTransition);
    setOpen(true);
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const select = (index: number) => {
    onChange(RANGES[index].key);
    close();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0, false);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(RANGES.length - 1, false);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => (i + 1) % RANGES.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => (i - 1 + RANGES.length) % RANGES.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(RANGES.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        select(active);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Date range: ${value}`}
        onClick={() => (open ? close() : openMenu(0, true))}
        onKeyDown={onTriggerKeyDown}
        className={selectTrigger}
      >
        {value}
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={selectCaret}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Date range"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className={cx(
            menuPopup,
            animate && overlayEnter,
            "absolute right-0 top-full z-30 mt-1.5 w-[192px]",
          )}
        >
          {RANGES.map((range, index) => {
            const selected = range.key === value;
            return (
              <button
                key={range.key}
                type="button"
                role="option"
                aria-selected={selected}
                data-highlighted={index === active ? "" : undefined}
                tabIndex={-1}
                onClick={() => select(index)}
                onPointerMove={() => setActive(index)}
                className={cx(menuItem, "pe-8")}
              >
                <span className="min-w-0 flex-1 truncate">{range.key}</span>
                {selected && (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="absolute end-2"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard1() {
  const [rangeKey, setRangeKey] = useState(RANGES[1].key);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  return (
    <div
      className={cx(
        canvas,
        text1,
        "relative flex h-full min-h-[640px] w-full flex-col overflow-hidden",
      )}
    >
      <header
        className={cx(
          ruleBottom,
          "flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6",
        )}
      >
        <h1 className={cx(typeHeadingSm, text1, "truncate")}>Revenue</h1>
        <RangeSelect value={rangeKey} onChange={setRangeKey} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className={statGroup}>
          <div className={statGrid}>
            {range.metrics.map((metric) => {
              const down = isDown(metric.delta);
              return (
                <div key={metric.label} className={cx(statCell, "@container")}>
                  <p className={cx(statLabel, "text-pretty")}>{metric.label}</p>
                  <div className="mt-auto flex items-end justify-between gap-3">
                    <p className={cx(statValue, "truncate")}>{metric.value}</p>
                    <Sparkline values={metric.spark} />
                  </div>
                  <p className={cx(statDelta, "truncate")}>
                    <HugeiconsIcon
                      icon={down ? ArrowDownRight01Icon : ArrowUpRight01Icon}
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{down ? "Down" : "Up"}</span>
                    {metric.delta}
                    <span className={cx(text3, "hidden sm:inline")}>
                      {range.compare}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className={cx(frame, "min-h-0 flex-1 p-4")}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={frameTitle}>Net revenue by month</h2>
            <span className={cx(typeCaption, text3, "shrink-0")}>
              USD, thousands
            </span>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 gap-3">
            <div
              className={cx(
                typeCaption,
                text3,
                "-my-2 flex w-10 shrink-0 flex-col justify-between text-right",
              )}
            >
              {Y_TICKS.map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
            <div className="relative min-h-0 flex-1">
              <svg
                aria-hidden
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
                className="absolute inset-0 h-full w-full"
              >
                {Y_TICKS.map((tick) => {
                  const y = 100 - (tick / Y_MAX) * 100;
                  return (
                    <line
                      key={tick}
                      x1="0"
                      x2="100"
                      y1={y}
                      y2={y}
                      vectorEffect="non-scaling-stroke"
                      shapeRendering="crispEdges"
                      className={tick === 0 ? chartZero : chartGrid}
                      strokeWidth={1}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex items-end gap-2 sm:gap-3">
                {range.revenue.map((value, i) => (
                  <div
                    key={range.months[i]}
                    className="flex min-w-0 flex-1 justify-center"
                    style={{ height: `${(value / Y_MAX) * 100}%` }}
                  >
                    <svg
                      aria-hidden="true"
                      className="block h-full w-full min-w-0 max-w-[64px]"
                    >
                      <rect width="100%" height="100%" className={chartBar} />
                    </svg>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 flex gap-3">
            <div className="w-10 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 gap-2 sm:gap-3">
              {range.months.map((month) => (
                <span
                  key={month}
                  className={cx(
                    typeCaption,
                    text3,
                    "min-w-0 flex-1 truncate text-center",
                  )}
                >
                  {month}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
