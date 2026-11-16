"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Download04Icon,
  MinusSignIcon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const canvas = "bg-white dark:bg-neutral-950";
const greyFrame = "bg-neutral-50 dark:bg-neutral-900";
const inverseSurface =
  "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";
const text1 = "text-neutral-900 dark:text-neutral-100";
const text2 = "text-neutral-900/80 dark:text-neutral-100/80";
const text3 = "text-neutral-900/66 dark:text-neutral-100/66";
const typeHeadingXs = "text-[16px]/[20px] font-[450] tracking-[-0.015em]";
const typeBodySm = "text-[13px]/[18px] font-normal";
const typeLabel = "text-[14px]/[16px] font-[450]";
const typeCaption = "text-[12px]/[16px] font-normal tabular-nums";
const typeCodeSm = "font-mono text-[12px]/[16px] tabular-nums";
const selectTrigger =
  "inline-flex h-8 w-fit min-w-40 cursor-pointer items-center justify-between gap-2 rounded-[var(--rb-r-sm,6px)] border border-neutral-900/12 bg-white px-3 text-left text-[14px]/[16px] font-[450] whitespace-nowrap text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] outline-none select-none transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-disabled:not-aria-invalid:border-neutral-900/32 focus-visible:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-visible:ring-3 focus-visible:ring-neutral-900/8 aria-expanded:border-[var(--rb-accent,oklch(20.5%_0_0))] aria-expanded:ring-3 aria-expanded:ring-neutral-900/8 aria-invalid:border-[oklch(60%_0.236_26)] disabled:cursor-not-allowed disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:not-aria-invalid:border-neutral-100/32 dark:focus-visible:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-visible:ring-neutral-100/8 dark:aria-expanded:border-[var(--rb-accent,oklch(100%_0_0))] dark:aria-expanded:ring-neutral-100/8 dark:aria-invalid:border-[oklch(65.2%_0.219_26)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const selectPlaceholder = "text-neutral-900/66 dark:text-neutral-100/66";
const selectCaret = "shrink-0 text-neutral-900/80 dark:text-neutral-100/80";
const checkboxBox =
  "relative inline-flex size-4 shrink-0 items-center justify-center";
const checkbox =
  "peer size-4 shrink-0 cursor-pointer appearance-none rounded-[var(--rb-r-xs,4px)] border border-neutral-900/50 bg-white shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] transition-[background-color,border-color,box-shadow,outline-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-checked:not-disabled:border-neutral-900 active:not-checked:bg-neutral-900/8 checked:border-transparent checked:bg-[var(--rb-accent,oklch(20.5%_0_0))] indeterminate:border-transparent indeterminate:bg-[var(--rb-accent,oklch(20.5%_0_0))] aria-invalid:border-[oklch(60%_0.236_26)] disabled:cursor-not-allowed disabled:border-neutral-900/40 disabled:shadow-none disabled:checked:bg-neutral-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:border-neutral-100/50 dark:bg-neutral-900 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-checked:not-disabled:border-neutral-100 dark:active:not-checked:bg-neutral-100/8 dark:checked:bg-[var(--rb-accent,oklch(100%_0_0))] dark:indeterminate:bg-[var(--rb-accent,oklch(100%_0_0))] dark:aria-invalid:border-[oklch(65.2%_0.219_26)] dark:disabled:border-neutral-100/40 dark:disabled:checked:bg-neutral-100/40";
const checkboxMark =
  "pointer-events-none absolute text-[var(--rb-accent-fg,oklch(100%_0_0))] opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100 dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))]";
const statusWord =
  "inline-flex items-start gap-1.5 text-[14px]/[16px] font-[450] tabular-nums";
const statusIdle = "text-neutral-900/66 dark:text-neutral-100/66";
const statusQueued = "text-neutral-900 dark:text-neutral-100";
const statusOk = "text-neutral-900/80 dark:text-neutral-100/80";
const truncateFade =
  "block min-w-0 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]";
const menuPopup =
  "min-w-48 max-w-[min(480px,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 p-1 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";
const menuItem =
  "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-[var(--rb-r-sm,6px)] px-2 py-1.5 text-left text-[14px]/[16px] font-[450] text-neutral-900 outline-none select-none [&_svg]:shrink-0 [&_svg]:text-neutral-900/80 hover:bg-neutral-900/5 focus-visible:bg-neutral-900/5 data-[highlighted]:bg-neutral-900/5 aria-selected:bg-neutral-900/9 aria-disabled:cursor-not-allowed aria-disabled:text-neutral-900/40 dark:text-neutral-100 dark:[&_svg]:text-neutral-100/80 dark:hover:bg-neutral-100/5 dark:focus-visible:bg-neutral-100/5 dark:data-[highlighted]:bg-neutral-100/5 dark:aria-selected:bg-neutral-100/9 dark:aria-disabled:text-neutral-100/40";
const overlayEnter =
  "transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] starting:opacity-0 motion-reduce:transition-none";
const paginationStrip = "flex items-stretch";
const pageLink =
  "relative -ml-px inline-flex h-8 min-w-8 cursor-pointer items-center justify-center border border-neutral-900/12 bg-white dark:bg-neutral-900 px-2 text-[14px]/[16px] font-[450] tabular-nums text-neutral-900 dark:text-neutral-100 first:ml-0 first:rounded-l-[var(--rb-r-sm,6px)] last:rounded-r-[var(--rb-r-sm,6px)] transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:z-10 hover:border-neutral-900/32 hover:bg-neutral-900/5 aria-[current=page]:z-10 aria-[current=page]:border-neutral-900/32 aria-[current=page]:bg-neutral-900/9 aria-disabled:pointer-events-none aria-disabled:text-neutral-900/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:border-neutral-100/14 dark:hover:border-neutral-100/32 dark:hover:bg-neutral-100/5 dark:aria-[current=page]:border-neutral-100/32 dark:aria-[current=page]:bg-neutral-100/9 dark:aria-disabled:text-neutral-100/40";
const paginationInfo =
  "text-[13px]/[18px] tabular-nums text-neutral-900/66 dark:text-neutral-100/66";
const table =
  "w-full border-separate border-spacing-0 text-left text-[14px]/[20px]";
const tableHead =
  "h-8 border-b border-neutral-900/8 px-3 text-left align-middle text-[12px]/[16px] font-normal tabular-nums whitespace-nowrap text-neutral-900/66 dark:text-neutral-100/66 first:ps-4 last:pe-4 dark:border-neutral-100/8";
const tableRow =
  "group transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-aria-selected:bg-neutral-900/5 aria-selected:bg-neutral-900/9 dark:hover:not-aria-selected:bg-neutral-100/5 dark:aria-selected:bg-neutral-100/9";
const tableCell =
  "h-10 border-b border-neutral-900/8 px-3 align-middle whitespace-nowrap text-neutral-900 dark:text-neutral-100 group-last:border-b-0 first:ps-4 last:pe-4 dark:border-neutral-100/8";
const numericCell = "text-right tabular-nums";
const bulkAction =
  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-sm,6px)] bg-white/10 px-3 text-[14px]/[16px] font-[450] transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/16 active:bg-white/28 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent-fg,oklch(100%_0_0))] dark:bg-neutral-900/10 dark:hover:bg-neutral-900/16 dark:active:bg-neutral-900/28 dark:focus-visible:outline-[var(--rb-accent-fg,oklch(20.5%_0_0))]";
const fadeBottom =
  "bg-linear-to-t from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950";

const gutter = "sm:first:ps-6 sm:last:pe-6";

type Payment = {
  id: string;
  vendor: string;
  owner: string;
  status: "Scheduled" | "Needs approval" | "Paid" | "On hold";
  amount: number;
  due: string;
};

const payments: Payment[] = [
  {
    id: "PAY-0182",
    vendor: "Pilot Fiber Transit",
    owner: "Iris Woods",
    status: "Needs approval",
    amount: 6420,
    due: "Aug 6",
  },
  {
    id: "PAY-0183",
    vendor: "Granite Switchgear Supply",
    owner: "Niko Bryant",
    status: "Scheduled",
    amount: 18200,
    due: "Aug 7",
  },
  {
    id: "PAY-0184",
    vendor: "Beacon Yard Services",
    owner: "Marisol Vale",
    status: "Paid",
    amount: 3140,
    due: "Aug 9",
  },
  {
    id: "PAY-0185",
    vendor: "Atlas Thermal Controls",
    owner: "Jun Park",
    status: "Scheduled",
    amount: 9880,
    due: "Aug 11",
  },
  {
    id: "PAY-0186",
    vendor: "Silverline Security Review Partners",
    owner: "Mara Singh",
    status: "Needs approval",
    amount: 2760,
    due: "Aug 15",
  },
  {
    id: "PAY-0187",
    vendor: "Lowland Metering Group",
    owner: "Theo Grant",
    status: "Paid",
    amount: 14050,
    due: "Aug 18",
  },
  {
    id: "PAY-0188",
    vendor: "Cedarworks Freight",
    owner: "Asha Malik",
    status: "Scheduled",
    amount: 5310,
    due: "Aug 20",
  },
  {
    id: "PAY-0189",
    vendor: "Halden Instrument Rental",
    owner: "Camille Hart",
    status: "Paid",
    amount: 1980,
    due: "Aug 22",
  },
  {
    id: "PAY-0190",
    vendor: "Northwind Facilities",
    owner: "Iris Woods",
    status: "Needs approval",
    amount: 22400,
    due: "Aug 25",
  },
  {
    id: "PAY-0191",
    vendor: "Riverbend Testing Lab",
    owner: "Niko Bryant",
    status: "Scheduled",
    amount: 7640,
    due: "Aug 27",
  },
  {
    id: "PAY-0192",
    vendor: "Cascade Pallet Works",
    owner: "Marisol Vale",
    status: "Paid",
    amount: 4380,
    due: "Aug 28",
  },
  {
    id: "PAY-0193",
    vendor: "Ironvale Coatings",
    owner: "Theo Grant",
    status: "Scheduled",
    amount: 12740,
    due: "Sep 1",
  },
  {
    id: "PAY-0194",
    vendor: "Dockside Calibration Services",
    owner: "Mara Singh",
    status: "Needs approval",
    amount: 8150,
    due: "Sep 2",
  },
  {
    id: "PAY-0195",
    vendor: "Alder Route Analytics",
    owner: "Jun Park",
    status: "Scheduled",
    amount: 3290,
    due: "Sep 4",
  },
  {
    id: "PAY-0196",
    vendor: "Fenwick Packaging",
    owner: "Camille Hart",
    status: "Paid",
    amount: 6710,
    due: "Sep 5",
  },
  {
    id: "PAY-0197",
    vendor: "Harborlight Cold Chain",
    owner: "Iris Woods",
    status: "Scheduled",
    amount: 19430,
    due: "Sep 8",
  },
  {
    id: "PAY-0198",
    vendor: "Quarry Bend Materials",
    owner: "Niko Bryant",
    status: "Needs approval",
    amount: 5040,
    due: "Sep 9",
  },
  {
    id: "PAY-0199",
    vendor: "Westline Fleet Care",
    owner: "Asha Malik",
    status: "Paid",
    amount: 2260,
    due: "Sep 11",
  },
  {
    id: "PAY-0200",
    vendor: "Stonecrest Utility Partners",
    owner: "Marisol Vale",
    status: "Scheduled",
    amount: 15870,
    due: "Sep 12",
  },
  {
    id: "PAY-0201",
    vendor: "Meridian Trade Compliance",
    owner: "Jun Park",
    status: "Needs approval",
    amount: 9320,
    due: "Sep 15",
  },
  {
    id: "PAY-0202",
    vendor: "Blackpine Yard Equipment",
    owner: "Theo Grant",
    status: "Scheduled",
    amount: 7180,
    due: "Sep 16",
  },
  {
    id: "PAY-0203",
    vendor: "Verity Audit Group",
    owner: "Mara Singh",
    status: "Paid",
    amount: 11600,
    due: "Sep 18",
  },
  {
    id: "PAY-0204",
    vendor: "Copperfield Signage",
    owner: "Camille Hart",
    status: "Scheduled",
    amount: 1840,
    due: "Sep 19",
  },
  {
    id: "PAY-0205",
    vendor: "Northgate Waste Services",
    owner: "Niko Bryant",
    status: "Needs approval",
    amount: 4960,
    due: "Sep 22",
  },
  {
    id: "PAY-0206",
    vendor: "Trellis Facility Software",
    owner: "Iris Woods",
    status: "Paid",
    amount: 20510,
    due: "Sep 23",
  },
  {
    id: "PAY-0207",
    vendor: "Sunfield Grounds Care",
    owner: "Asha Malik",
    status: "Scheduled",
    amount: 3470,
    due: "Sep 25",
  },
  {
    id: "PAY-0208",
    vendor: "Larkspur Legal Retainer",
    owner: "Jun Park",
    status: "Needs approval",
    amount: 13250,
    due: "Sep 26",
  },
  {
    id: "PAY-0209",
    vendor: "Beacon Ridge Insurance",
    owner: "Marisol Vale",
    status: "Scheduled",
    amount: 27890,
    due: "Sep 29",
  },
];
const currency = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const statusTone: Record<Payment["status"], string> = {
  Scheduled: statusQueued,
  "Needs approval": text1,
  Paid: statusOk,
  "On hold": statusIdle,
};

function StatusCell({ status }: { status: Payment["status"] }) {
  return (
    <span className={cx(statusWord, statusTone[status], "whitespace-nowrap")}>
      {status}
    </span>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const mixed = !!indeterminate && !checked;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <span className={checkboxBox}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className={checkbox}
      />
      <HugeiconsIcon
        icon={mixed ? MinusSignIcon : Tick02Icon}
        size={12}
        strokeWidth={2.5}
        aria-hidden="true"
        className={cx(checkboxMark, "peer-indeterminate:opacity-100")}
      />
    </span>
  );
}

type SelectOption = { value: string; label: string; hint?: string };

function Select({
  id,
  value,
  onChange,
  options,
  disabled,
  placeholder = "Select…",
  className,
  triggerClassName,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);
  const [listMax, setListMax] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = (index?: number) => {
    if (disabled) return;
    const node = rootRef.current;
    const view = node?.ownerDocument.defaultView;
    if (node && view) {
      const r = node.getBoundingClientRect();
      let top = 0;
      let bottom = view.innerHeight;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (
          /(auto|scroll|hidden|clip)/.test(view.getComputedStyle(el).overflowY)
        ) {
          const box = el.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
          break;
        }
      }
      const below = bottom - r.bottom;
      const above = r.top - top;
      const needed = Math.min(options.length * 32 + 10, 264);
      const up = below < needed + 8 && above > below;
      const room = (up ? above : below) - 8;
      setFlip(up);
      setListMax(room < needed ? Math.max(room, 40) : undefined);
    }
    setActive(index ?? (selectedIndex >= 0 ? selectedIndex : 0));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const node = rootRef.current;
    const doc = node?.ownerDocument;
    if (!doc) return;
    const onPointer = (e: Event) => {
      if (!node.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener("mousedown", onPointer);
    doc.addEventListener("touchstart", onPointer);
    return () => {
      doc.removeEventListener("mousedown", onPointer);
      doc.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [open, active]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at > 700 ? e.key : t.buffer + e.key;
      t.at = now;
      const hit = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(t.buffer.toLowerCase()),
      );
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cx(selectTrigger, triggerClassName)}
      >
        <span className="grid min-w-0 flex-1 text-left *:[grid-area:1/1]">
          {options.map((o) => (
            <span
              key={o.value}
              aria-hidden="true"
              className="invisible flex min-w-0 items-baseline gap-2"
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="truncate">{o.hint}</span>}
            </span>
          ))}
          <span className="flex min-w-0 items-baseline gap-2">
            {selected ? (
              <>
                <span className="truncate">{selected.label}</span>
                {selected.hint && (
                  <span className={cx(text3, "truncate")}>{selected.hint}</span>
                )}
              </>
            ) : (
              <span className={cx(selectPlaceholder, "truncate")}>
                {placeholder}
              </span>
            )}
          </span>
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={selectCaret}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          style={{ maxHeight: listMax }}
          className={cx(
            menuPopup,
            overlayEnter,
            "absolute z-30 max-h-[264px] w-full min-w-[100%]",
            flip ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                data-index={i}
                data-highlighted={i === active ? "" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={cx(menuItem, "pe-8")}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className={text3}>{o.hint}</span>}
                </span>
                {isSelected && (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="pointer-events-none absolute end-2"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const pageSizes = [10, 25] as const;

function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

export default function DataTable2() {
  const {
    ref: bodyRef,
    edges: bodyEdges,
    onScroll: onBodyScroll,
  } = useScrollFade<HTMLDivElement>();
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["PAY-0182", "PAY-0185"]),
  );
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(payments.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = payments.slice(start, start + pageSize);

  const pageIds = pageRows.map((p) => p.id);
  const pageSelectedCount = pageIds.filter((id) => selected.has(id)).length;
  const allChecked = pageSelectedCount === pageIds.length && pageIds.length > 0;
  const someChecked = pageSelectedCount > 0 && !allChecked;

  const selectedTotal = useMemo(
    () =>
      payments
        .filter((p) => selected.has(p.id))
        .reduce((sum, p) => sum + p.amount, 0),
    [selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const clear = () => setSelected(new Set());

  const holdSelected = () => {
    setHeld((prev) => new Set([...prev, ...selected]));
    clear();
  };

  const statusOf = (p: Payment): Payment["status"] =>
    held.has(p.id) ? "On hold" : p.status;

  const goTo = (next: number) =>
    setPage(Math.min(Math.max(next, 1), pageCount));

  return (
    <div
      className={cx(
        canvas,
        text1,
        "relative flex h-full min-h-[640px] w-full flex-col overflow-hidden",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header
          className={cx(
            greyFrame,
            "flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6",
          )}
        >
          <h2 className={cx(typeHeadingXs, "min-w-0 flex-1 truncate")}>
            Outgoing payments
          </h2>
          <span className={cx(typeCaption, text3, "shrink-0")}>
            {payments.length} pending
          </span>
        </header>

        {selected.size > 0 ? (
          <div
            className={cx(
              inverseSurface,
              "flex h-12 shrink-0 items-center gap-3 px-4 sm:px-6",
            )}
          >
            <span aria-live="polite" className={typeLabel}>
              {selected.size} selected
            </span>
            <span className={typeCaption}>{currency(selectedTotal)}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={holdSelected}
                className={bulkAction}
              >
                <HugeiconsIcon
                  icon={Archive02Icon}
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span className="max-sm:sr-only">Hold</span>
              </button>
              <button type="button" className={bulkAction}>
                <HugeiconsIcon
                  icon={Download04Icon}
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span className="max-sm:sr-only">Export</span>
              </button>
              <button
                type="button"
                onClick={clear}
                aria-label="Clear selection"
                className={bulkAction}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cx(
              greyFrame,
              typeBodySm,
              text2,
              "flex h-12 shrink-0 items-center px-4 sm:px-6",
            )}
          >
            Select rows to approve, hold, or export a batch.
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <div
            ref={bodyRef}
            onScroll={onBodyScroll}
            className="h-full overflow-auto"
          >
            <table className={cx(table, "min-w-[720px]")}>
              <caption className="sr-only">Outgoing vendor payments</caption>
              <thead className={cx(canvas, "sticky top-0 z-20")}>
                <tr>
                  <th scope="col" className={cx(tableHead, gutter, "w-12")}>
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={toggleAll}
                      label="Select all payments on this page"
                    />
                  </th>
                  <th scope="col" className={cx(tableHead, gutter)}>
                    Vendor
                  </th>
                  <th
                    scope="col"
                    className={cx(tableHead, gutter, "w-[160px]")}
                  >
                    Owner
                  </th>
                  <th
                    scope="col"
                    className={cx(tableHead, gutter, "w-[150px]")}
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className={cx(tableHead, gutter, "w-[120px] text-right")}
                  >
                    Amount
                  </th>
                  <th
                    scope="col"
                    className={cx(tableHead, gutter, "w-[90px] text-right")}
                  >
                    Due
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const isSel = selected.has(p.id);
                  return (
                    <tr key={p.id} aria-selected={isSel} className={tableRow}>
                      <td className={cx(tableCell, gutter, "w-12")}>
                        <Checkbox
                          checked={isSel}
                          onChange={() => toggle(p.id)}
                          label={`Select ${p.vendor}`}
                        />
                      </td>
                      <td
                        className={cx(
                          tableCell,
                          gutter,
                          "max-w-[260px] py-1.5",
                        )}
                      >
                        <span className={cx(typeLabel, truncateFade)}>
                          {p.vendor}
                        </span>
                        <span className={cx(typeCodeSm, text3, "block")}>
                          {p.id}
                        </span>
                      </td>
                      <td className={cx(tableCell, gutter, "truncate")}>
                        <span className={text2}>{p.owner}</span>
                      </td>
                      <td className={cx(tableCell, gutter)}>
                        <StatusCell status={statusOf(p)} />
                      </td>
                      <td className={cx(tableCell, numericCell, gutter)}>
                        {currency(p.amount)}
                      </td>
                      <td className={cx(tableCell, numericCell, gutter)}>
                        <span className={text2}>{p.due}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            aria-hidden="true"
            className={cx(
              fadeBottom,
              "pointer-events-none absolute inset-x-0 bottom-0 h-8",
              bodyEdges.end ? "opacity-100" : "opacity-0",
            )}
          />
        </div>

        <footer
          className={cx(
            greyFrame,
            "flex h-12 shrink-0 items-center gap-3 px-4 sm:px-6",
          )}
        >
          <div
            className={cx(
              typeBodySm,
              text2,
              "hidden items-center gap-2 sm:flex",
            )}
          >
            Rows per page
            <Select
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
              options={pageSizes.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              ariaLabel="Rows per page"
              triggerClassName="min-w-[0px]"
            />
          </div>
          <span className={paginationInfo}>
            <span className={text1}>
              {start + 1}&ndash;{start + pageRows.length}
            </span>{" "}
            of {payments.length}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className={cx(paginationInfo, "sm:hidden")}>
              {safePage} / {pageCount}
            </span>
            <div className={paginationStrip}>
              <button
                type="button"
                aria-disabled={safePage === 1}
                onClick={() => goTo(safePage - 1)}
                aria-label="Previous page"
                className={pageLink}
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => goTo(n)}
                  aria-current={n === safePage ? "page" : undefined}
                  className={cx(pageLink, "max-sm:hidden")}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                aria-disabled={safePage === pageCount}
                onClick={() => goTo(safePage + 1)}
                aria-label="Next page"
                className={pageLink}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
