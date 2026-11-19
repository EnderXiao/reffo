import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDownRight01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const statCell = "flex min-w-0 flex-col gap-2 px-4 py-3";
const statLabel = "text-[14px]/[16px] font-[450] text-neutral-900/80 dark:text-neutral-100/80";
const statValueSm = "flex min-w-0 flex-wrap items-baseline gap-x-1 text-[20px]/[24px] font-[450] tabular-nums text-neutral-900 dark:text-neutral-100";
const statDelta = "inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-[12px]/[16px] font-[450] tabular-nums [&>svg]:self-center text-neutral-900/80 dark:text-neutral-100/80";
const statusOk = "text-neutral-900/80 dark:text-neutral-100/80";
const statusFail = "text-[oklch(51%_0.18_26)] dark:text-[oklch(76%_0.14_26)]";

export default function StatCard({ label, value, delta, positive, description }: { label: string; value: string; delta?: string; positive?: boolean; description?: string }) {
  return (
    <div className={statCell}>
      <p className={cx(statLabel, "text-pretty")}>{label}</p>
      <div className="mt-auto flex items-end justify-between gap-3">
        <p className={cx(statValueSm, "truncate")}>{value}</p>
      </div>
      {delta && (
        <p className={cx(statDelta, "truncate")}>
          <HugeiconsIcon icon={positive ? ArrowUpRight01Icon : ArrowDownRight01Icon} size={12} strokeWidth={1.8} aria-hidden="true" />
          <span className={positive ? statusOk : statusFail}>{delta}</span>
          {description && <span className="hidden text-[12px]/[16px] tabular-nums text-neutral-900/50 md:inline dark:text-neutral-100/50">{description}</span>}
        </p>
      )}
    </div>
  );
}
