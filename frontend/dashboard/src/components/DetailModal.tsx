import { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// 骨架取自 reactBits App UI 的 app-dialog-3（居中 modal），材质换为看板玻璃卡片
const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * 大玻璃卡片弹窗（80% 宽高）+ 高斯模糊遮罩 + scale/fade 丝滑动画。
 * 遮罩点击 / Escape 关闭。
 */
export default function DetailModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fade = !prefersReducedMotion;
  const panelMotion = fade
    ? {
        initial: { opacity: 0, scale: 0.96, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.14, ease: EASE } },
        transition: { duration: 0.24, ease: EASE },
      }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-8" role="presentation">
        <motion.div
          className="absolute inset-0 backdrop-blur-xl"
          style={{ background: "rgba(8, 6, 20, 0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          onClick={onClose}
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={cx(
            "relative flex flex-col overflow-hidden rounded-2xl border border-white/25 bg-[#1a1430]/85 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_24px_80px_rgba(0,0,0,0.6)]",
            "h-[80vh] w-[80vw] max-w-[1200px]",
          )}
          {...panelMotion}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
            <h2 className="text-[16px] font-[550] tracking-tight text-white">{title}</h2>
            <button
              type="button"
              aria-label="Close dialog"
              className="flex size-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5 text-[13px] leading-relaxed text-neutral-200">{children}</div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
