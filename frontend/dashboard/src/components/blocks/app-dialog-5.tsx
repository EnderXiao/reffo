"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const canvas = "bg-white dark:bg-neutral-950";
const well = "bg-neutral-900/5 dark:bg-neutral-100/5";
const backdrop = "bg-neutral-900/25 dark:bg-neutral-950/60";
const text1 = "text-neutral-900 dark:text-neutral-100";
const typeLabel = "text-[14px]/[16px] font-[450]";
const cornerSm = "rounded-[var(--rb-r-sm,6px)]";
const primaryButton =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_84%,white),color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_94%,black))] text-[var(--rb-accent-fg,oklch(100%_0_0))] shadow-[inset_0_2px_0_-1px_rgb(255_255_255/0.2),inset_0_-2px_0_-1px_rgb(0_0_0/0.3),inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_88%,black),0_1px_1px_rgb(0_0_0/0.22),0_2px_5px_-2px_rgb(0_0_0/0.3)] hover:not-disabled:brightness-110 active:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_88%,black),inset_0_1px_2px_rgb(0_0_0/0.42)] disabled:opacity-40 disabled:shadow-none dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_84%,white),color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_94%,black))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:shadow-[inset_0_2px_0_-1px_rgb(255_255_255/0.2),inset_0_-2px_0_-1px_rgb(0_0_0/0.3),inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_88%,black),0_1px_1px_rgb(0_0_0/0.66),0_2px_5px_-2px_rgb(0_0_0/0.9)] dark:active:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_88%,black),inset_0_1px_2px_rgb(0_0_0/0.42)] dark:disabled:shadow-none";
const secondaryButton =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] border border-neutral-900/12 bg-white text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] hover:not-disabled:border-neutral-900/32 hover:not-disabled:bg-linear-to-b hover:not-disabled:from-neutral-900/3 hover:not-disabled:to-neutral-900/3 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:border-neutral-100/32 dark:hover:not-disabled:from-neutral-100/3 dark:hover:not-disabled:to-neutral-100/3 dark:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const ghostButton =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] bg-transparent text-neutral-900 hover:not-disabled:bg-neutral-900/5 active:bg-neutral-900/8 aria-pressed:bg-neutral-900/9 disabled:text-neutral-900/40 dark:text-neutral-100 dark:hover:not-disabled:bg-neutral-100/5 dark:active:bg-neutral-100/8 dark:aria-pressed:bg-neutral-100/9 dark:disabled:text-neutral-100/40";
const dangerButton =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] border border-[oklch(60%_0.236_26)] bg-white text-[oklch(51%_0.18_26)] shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] hover:not-disabled:border-[oklch(51%_0.18_26)] active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-[oklch(65.2%_0.219_26)] dark:bg-neutral-900 dark:text-[oklch(76%_0.14_26)] dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:border-[oklch(76%_0.14_26)] dark:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const buttonSm =
  "h-7 gap-1.5 rounded-[var(--rb-r-sm,6px)] px-3 text-[14px]/[16px] font-[450]";
const buttonMd =
  "h-8 gap-2 rounded-[var(--rb-r-sm,6px)] px-4 text-[14px]/[16px] font-[450]";
const iconButtonSm = "size-7 rounded-[var(--rb-r-sm,6px)]";
const inputBox =
  "relative flex w-full min-w-0 cursor-text items-center rounded-[var(--rb-r-sm,6px)] data-concentric:rounded-[var(--rb-r-lg,10px)] border border-neutral-900/12 bg-white text-[14px]/[16px] font-[450] text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] transition-[border-color,box-shadow,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-focus-within:not-has-[[aria-invalid=true]]:not-has-[input:disabled]:border-neutral-900/32 focus-within:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-within:ring-3 focus-within:ring-neutral-900/8 has-[[aria-invalid=true]]:border-[oklch(60%_0.236_26)] has-[input:disabled]:cursor-not-allowed has-[input:disabled]:border-neutral-900/8 has-[input:disabled]:text-neutral-900/40 has-[input:disabled]:shadow-none has-[input[readonly]]:cursor-default has-[input[readonly]]:border-transparent has-[input[readonly]]:bg-neutral-900/5 has-[input[readonly]]:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-focus-within:not-has-[[aria-invalid=true]]:not-has-[input:disabled]:border-neutral-100/32 dark:focus-within:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-within:ring-neutral-100/8 dark:has-[[aria-invalid=true]]:border-[oklch(65.2%_0.219_26)] dark:has-[input:disabled]:border-neutral-100/8 dark:has-[input:disabled]:text-neutral-100/40 dark:has-[input[readonly]]:bg-neutral-100/5";
const fieldMd = "h-8";
const inputControl =
  "h-full w-full min-w-0 flex-1 bg-transparent px-3 outline-none [[data-affix]+&]:ps-2 [&:has(+[data-affix])]:pe-2 placeholder:text-neutral-900/66 disabled:cursor-not-allowed disabled:placeholder:text-neutral-900/40 dark:placeholder:text-neutral-100/66 dark:disabled:placeholder:text-neutral-100/40 dark:[color-scheme:dark]";
const textareaClass =
  "block max-h-[256px] min-h-[76px] w-full min-w-48 resize-none rounded-[var(--rb-r-sm,6px)] border border-neutral-900/12 bg-white px-3 py-2 text-[14px]/[20px] font-[450] text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] outline-none field-sizing-content transition-[border-color,box-shadow,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] placeholder:text-neutral-900/66 hover:not-focus-visible:not-aria-invalid:not-disabled:not-read-only:border-neutral-900/32 focus-visible:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-visible:ring-3 focus-visible:ring-neutral-900/8 aria-invalid:border-[oklch(60%_0.236_26)] disabled:cursor-not-allowed disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none read-only:border-transparent read-only:bg-neutral-900/5 read-only:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:placeholder:text-neutral-100/66 dark:hover:not-focus-visible:not-aria-invalid:not-disabled:not-read-only:border-neutral-100/32 dark:focus-visible:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-visible:ring-neutral-100/8 dark:aria-invalid:border-[oklch(65.2%_0.219_26)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40 dark:read-only:bg-neutral-100/5";
const fieldLabel =
  "flex w-fit items-center gap-2 text-[14px]/[16px] font-[450] text-neutral-900 dark:text-neutral-100";
const fieldDescription =
  "max-w-[60ch] text-[13px]/[18px] text-neutral-900/80 dark:text-neutral-100/80";
const selectTrigger =
  "inline-flex h-8 w-fit min-w-40 cursor-pointer items-center justify-between gap-2 rounded-[var(--rb-r-sm,6px)] border border-neutral-900/12 bg-white px-3 text-left text-[14px]/[16px] font-[450] whitespace-nowrap text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] outline-none select-none transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-disabled:not-aria-invalid:border-neutral-900/32 focus-visible:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-visible:ring-3 focus-visible:ring-neutral-900/8 aria-expanded:border-[var(--rb-accent,oklch(20.5%_0_0))] aria-expanded:ring-3 aria-expanded:ring-neutral-900/8 aria-invalid:border-[oklch(60%_0.236_26)] disabled:cursor-not-allowed disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:not-aria-invalid:border-neutral-100/32 dark:focus-visible:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-visible:ring-neutral-100/8 dark:aria-expanded:border-[var(--rb-accent,oklch(100%_0_0))] dark:aria-expanded:ring-neutral-100/8 dark:aria-invalid:border-[oklch(65.2%_0.219_26)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40";
const selectPlaceholder = "text-neutral-900/66 dark:text-neutral-100/66";
const selectCaret = "shrink-0 text-neutral-900/80 dark:text-neutral-100/80";
const switchTrack =
  "group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-white p-0.5 inset-ring inset-ring-neutral-900/50 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] transition-[background-color,box-shadow,outline-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:aria-[checked=false]:not-disabled:inset-ring-neutral-900 active:aria-[checked=false]:bg-neutral-900/8 aria-checked:bg-[var(--rb-accent,oklch(20.5%_0_0))] aria-checked:inset-ring-transparent disabled:cursor-not-allowed disabled:inset-ring-neutral-900/40 disabled:shadow-none disabled:aria-checked:bg-neutral-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:bg-neutral-900 dark:inset-ring-neutral-100/50 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:aria-[checked=false]:not-disabled:inset-ring-neutral-100 dark:active:aria-[checked=false]:bg-neutral-100/8 dark:aria-checked:bg-[var(--rb-accent,oklch(100%_0_0))] dark:disabled:inset-ring-neutral-100/40 dark:disabled:aria-checked:bg-neutral-100/40";
const switchThumb =
  "pointer-events-none block size-4 rounded-full bg-neutral-900/80 transition-[translate,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none group-aria-checked:translate-x-4 group-aria-checked:bg-[var(--rb-accent-fg,oklch(100%_0_0))] group-disabled:bg-neutral-900/40 dark:bg-neutral-100/80 dark:group-aria-checked:bg-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:group-disabled:bg-neutral-100/40";
const menuPopup =
  "min-w-48 max-w-[min(480px,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 p-1 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";
const menuItem =
  "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-[var(--rb-r-sm,6px)] px-2 py-1.5 text-left text-[14px]/[16px] font-[450] text-neutral-900 outline-none select-none [&_svg]:shrink-0 [&_svg]:text-neutral-900/80 hover:bg-neutral-900/5 focus-visible:bg-neutral-900/5 data-[highlighted]:bg-neutral-900/5 aria-selected:bg-neutral-900/9 aria-disabled:cursor-not-allowed aria-disabled:text-neutral-900/40 dark:text-neutral-100 dark:[&_svg]:text-neutral-100/80 dark:hover:bg-neutral-100/5 dark:focus-visible:bg-neutral-100/5 dark:data-[highlighted]:bg-neutral-100/5 dark:aria-selected:bg-neutral-100/9 dark:aria-disabled:text-neutral-100/40";
const toast =
  "pointer-events-auto grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 py-3 ps-4 pe-2 text-neutral-900 dark:text-neutral-100 shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)]";
const toastTitle = "text-[14px]/[16px] font-[450]";
const toastDescription =
  "mt-0.5 text-[13px]/[18px] text-neutral-900/80 dark:text-neutral-100/80";
const overlayEnter =
  "transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] starting:opacity-0 motion-reduce:transition-none";
const dialogShell =
  "flex max-h-[calc(100%-4rem)] flex-col overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-neutral-50 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)] dark:bg-neutral-900";
const dialogCard =
  "mx-1 mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--rb-r-sm,6px)] border border-neutral-900/8 bg-white [&:last-child]:mb-1 dark:border-neutral-100/8 dark:bg-neutral-950";
const dialogHeader =
  "relative flex flex-col gap-1.5 px-5 pt-5 pb-5 has-[button]:pe-14 [&:has(+*)]:pb-0";
const dialogTitle =
  "text-[16px]/[20px] font-[450] tracking-[-0.015em] text-neutral-900 dark:text-neutral-100";
const dialogDescription =
  "text-[14px]/[20px] text-neutral-900/80 dark:text-neutral-100/80";
const dialogBody = "flex min-w-0 flex-col gap-4 p-5 pt-6";
const dialogFoot =
  "flex min-h-11 flex-wrap items-center justify-end gap-2 px-4 py-2 pe-2";
const sheetPanel =
  "flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:text-neutral-100 outline-none shadow-[0_12px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_24px_-12px_rgb(0_0_0/0.6)] dark:bg-neutral-900";
const fadeTop =
  "bg-linear-to-b from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950";
const fadeBottom =
  "bg-linear-to-t from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950";

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CHANNELS = ["Email", "Slack", "PagerDuty", "Webhook"];

const SAVED = {
  channel: "Slack",
  threshold: "5% / 5 min",
  enabled: true,
  note: "Page the on-call engineer when errors climb.",
};

type SelectOption = { value: string; label: string };

function Select({
  id,
  value,
  defaultValue,
  onChange,
  options,
  disabled,
  placeholder = "Select…",
  className,
  triggerClassName,
  ariaLabel,
}: {
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
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
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: "", at: 0 });

  const current = value ?? uncontrolled;
  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = () => {
    if (disabled) return;
    const node = rootRef.current;
    const win = node?.ownerDocument.defaultView;
    if (node && win) {
      const r = node.getBoundingClientRect();
      let top = 0;
      let bottom = win.innerHeight;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (
          /auto|scroll|hidden|clip/.test(win.getComputedStyle(el).overflowY)
        ) {
          const box = el.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
          break;
        }
      }
      const below = bottom - r.bottom;
      const above = r.top - top;
      const needed = Math.min(options.length * 32 + 8, 264);
      const up = below < needed + 8 && above > below;
      const room = (up ? above : below) - 8;
      setFlip(up);
      setListMax(room < needed ? Math.max(room, 40) : undefined);
    }
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const node = rootRef.current;
    if (!node) return;
    const doc = node.ownerDocument;
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
    if (value === undefined) setUncontrolled(option.value);
    onChange?.(option.value);
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
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cx(selectTrigger, "w-full min-w-[100%]", triggerClassName)}
      >
        <span className="grid min-w-0 flex-1 text-left">
          {options.map((o) => (
            <span
              key={o.value}
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 truncate"
            >
              {o.label}
            </span>
          ))}
          <span
            className={cx(
              "col-start-1 row-start-1 truncate",
              !selected && selectPlaceholder,
            )}
          >
            {selected ? selected.label : placeholder}
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
            "absolute z-30 max-h-[264px] w-full min-w-[100%]",
            flip ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {options.map((o, i) => {
            const isSelected = o.value === current;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={isSelected}
                data-index={i}
                data-highlighted={i === active ? "" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={cx(menuItem, "pe-8")}
              >
                <span className="truncate">{o.label}</span>
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

function getFocusable(container: HTMLElement | null) {
  return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
}

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

export default function AppDialog5() {
  const {
    ref: bodyRef,
    edges: bodyEdges,
    onScroll: onBodyScroll,
  } = useScrollFade<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();
  const [open, setOpen] = useState(true);
  const [guardOpen, setGuardOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const keyboardOpenRef = useRef(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [channel, setChannel] = useState(SAVED.channel);
  const [threshold, setThreshold] = useState(SAVED.threshold);
  const [enabled, setEnabled] = useState(SAVED.enabled);
  const [note, setNote] = useState(SAVED.note);

  const dirty =
    channel !== SAVED.channel ||
    threshold !== SAVED.threshold ||
    enabled !== SAVED.enabled ||
    note !== SAVED.note;

  const drawerRef = useRef<HTMLDivElement>(null);
  const guardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);

  const requestClose = useCallback(() => {
    if (dirty) {
      setGuardOpen(true);
      return;
    }
    setOpen(false);
  }, [dirty]);

  const discardAndClose = () => {
    setGuardOpen(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const surface = guardOpen ? guardRef.current : drawerRef.current;
    const doc = surface?.ownerDocument ?? document;

    (getFocusable(surface)[0] ?? surface)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (guardOpen) setGuardOpen(false);
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable(surface);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = doc.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [open, guardOpen, requestClose]);

  useEffect(() => {
    if (wasOpenRef.current && !open)
      triggerRef.current?.focus({ preventScroll: true });
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  const openDrawer = () => {
    setChannel(SAVED.channel);
    setThreshold(SAVED.threshold);
    setEnabled(SAVED.enabled);
    setNote(SAVED.note);
    setGuardOpen(false);
    setSaved(false);
    setKeyboardOpen(keyboardOpenRef.current);
    setOpen(true);
  };

  const save = () => {
    setSaved(true);
    setOpen(false);
  };

  const slide = !prefersReducedMotion && !keyboardOpen;
  const guardFade = !prefersReducedMotion;

  const drawerMotion = slide
    ? {
        initial: { opacity: 0, x: 8 },
        animate: { opacity: 1, x: 0 },
        exit: {
          opacity: 0,
          x: 8,
          transition: { duration: 0.12, ease: EASE },
        },
        transition: { duration: 0.18, ease: EASE },
      }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { duration: 0.12, ease: EASE } },
        transition: { duration: 0 },
      };

  return (
    <div
      className={cx(
        canvas,
        text1,
        "relative flex h-full min-h-[640px] w-full items-center justify-center overflow-hidden p-4 sm:p-6",
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={() => {
          keyboardOpenRef.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ")
            keyboardOpenRef.current = true;
        }}
        onClick={openDrawer}
        className={cx(secondaryButton, buttonMd)}
      >
        Edit alert rule
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <>
            <motion.div
              aria-hidden="true"
              className={cx(backdrop, "absolute inset-0 z-30")}
              onClick={requestClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: EASE },
              }}
              transition={{ duration: slide ? 0.18 : 0, ease: EASE }}
            />
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-5-title"
              tabIndex={-1}
              className={cx(
                sheetPanel,
                "absolute inset-y-0 right-0 z-40 w-full max-w-md overflow-hidden",
              )}
              {...drawerMotion}
            >
              <div className={dialogCard}>
                <header className={cx(dialogHeader, "shrink-0")}>
                  <h2
                    id="app-dialog-5-title"
                    className={cx(dialogTitle, "truncate")}
                  >
                    Edit alert rule
                  </h2>
                  <div className="absolute end-4 top-4 flex">
                    <button
                      type="button"
                      aria-label="Close drawer"
                      onClick={requestClose}
                      className={cx(ghostButton, iconButtonSm)}
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={16}
                        strokeWidth={1.8}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                    </button>
                  </div>
                </header>

                <div className="relative min-h-0 flex-1">
                  <div
                    ref={bodyRef}
                    onScroll={onBodyScroll}
                    className={cx(dialogBody, "h-full gap-6 overflow-y-auto")}
                  >
                    <div className="flex flex-col gap-2">
                      <span className={fieldLabel}>Rule name</span>
                      <div
                        className={cx(
                          well,
                          cornerSm,
                          fieldMd,
                          typeLabel,
                          "flex items-center px-3",
                        )}
                      >
                        Error rate spike
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="app-dialog-5-channel"
                        className={fieldLabel}
                      >
                        Deliver to
                      </label>
                      <Select
                        id="app-dialog-5-channel"
                        value={channel}
                        onChange={setChannel}
                        options={CHANNELS.map((option) => ({
                          value: option,
                          label: option,
                        }))}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="app-dialog-5-threshold"
                        className={fieldLabel}
                      >
                        Trigger threshold
                      </label>
                      <div className={cx(inputBox, fieldMd)}>
                        <input
                          id="app-dialog-5-threshold"
                          value={threshold}
                          onChange={(event) => setThreshold(event.target.value)}
                          className={inputControl}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label htmlFor="app-dialog-5-note" className={fieldLabel}>
                        Note
                      </label>
                      <textarea
                        id="app-dialog-5-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        className={cx(textareaClass, "min-h-[80px]")}
                      />
                    </div>

                    <label className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className={cx(typeLabel, "block")}>
                          Rule enabled
                        </span>
                        <span className={cx(fieldDescription, "mt-0.5 block")}>
                          Turn off to pause without deleting.
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label="Rule enabled"
                        onClick={() => setEnabled((value) => !value)}
                        className={switchTrack}
                      >
                        <span className={switchThumb} />
                      </button>
                    </label>
                  </div>

                  <div
                    aria-hidden="true"
                    className={cx(
                      fadeTop,
                      "pointer-events-none absolute inset-x-0 top-0 h-8",
                      bodyEdges.start ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div
                    aria-hidden="true"
                    className={cx(
                      fadeBottom,
                      "pointer-events-none absolute inset-x-0 bottom-0 h-8",
                      bodyEdges.end ? "opacity-100" : "opacity-0",
                    )}
                  />
                </div>
              </div>

              <footer
                className={cx(
                  dialogFoot,
                  "shrink-0 flex-col-reverse max-sm:ps-2 sm:flex-row",
                )}
              >
                <button
                  type="button"
                  onClick={requestClose}
                  className={cx(secondaryButton, buttonSm, "w-full sm:w-auto")}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  className={cx(primaryButton, buttonSm, "w-full sm:w-auto")}
                >
                  Save changes
                </button>
              </footer>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {guardOpen && (
          <>
            <motion.div
              aria-hidden="true"
              className={cx(backdrop, "absolute inset-0 z-40")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: EASE },
              }}
              transition={{ duration: guardFade ? 0.18 : 0, ease: EASE }}
            />
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              <motion.div
                ref={guardRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="app-dialog-5-guard-title"
                aria-describedby="app-dialog-5-guard-desc"
                tabIndex={-1}
                className={cx(
                  dialogShell,
                  "pointer-events-auto max-h-full w-full max-w-sm",
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.12, ease: EASE },
                }}
                transition={{ duration: guardFade ? 0.18 : 0, ease: EASE }}
              >
                <div className={dialogCard}>
                  <div className={dialogHeader}>
                    <h2 id="app-dialog-5-guard-title" className={dialogTitle}>
                      Discard your changes?
                    </h2>
                    <p
                      id="app-dialog-5-guard-desc"
                      className={dialogDescription}
                    >
                      You&apos;ve edited this rule. Closing now loses what you
                      changed.
                    </p>
                  </div>
                </div>
                <div
                  className={cx(
                    dialogFoot,
                    "shrink-0 flex-col-reverse max-sm:ps-2 sm:flex-row",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setGuardOpen(false)}
                    className={cx(
                      secondaryButton,
                      buttonSm,
                      "w-full sm:w-auto",
                    )}
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    onClick={discardAndClose}
                    className={cx(dangerButton, buttonSm, "w-full sm:w-auto")}
                  >
                    Discard changes
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <div
        aria-live="polite"
        className="pointer-events-none absolute bottom-4 left-4 right-4 z-[60] flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm"
      >
        {saved && (
          <div className={cx(toast, overlayEnter)}>
            <div className="min-w-0">
              <p className={toastTitle}>Rule updated</p>
              <p className={toastDescription}>
                Changes apply to the next alert.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
