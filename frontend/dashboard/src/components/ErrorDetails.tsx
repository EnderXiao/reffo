import { useEffect, useState } from 'react';
import DetailModal from '@/components/DetailModal';
import { Button } from '@/components/ui/button';
import { fetchErrorByTraceId, requestMessage, type ErrorDetail, type ErrorEvent, type AnalyticsEvent } from '@/services/dashboard';

export default function ErrorDetails({ error, onClose }: { error: ErrorEvent; onClose: () => void }) {
  const [detail, setDetail] = useState<ErrorDetail | null>(null);
  const [relatedEvents, setRelatedEvents] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage('');
    setDetail(null);
    setRelatedEvents([]);
    void fetchErrorByTraceId(error.trace_id, controller.signal, error.id).then((result) => {
      if (controller.signal.aborted) return;
      const selected = Array.isArray(result.errors) ? result.errors.find((item) => item.id === error.id) : undefined;
      if (!selected || result.traceId !== error.trace_id) {
        setMessage('未找到这条错误的详情，数据可能已更新，请重试');
        return;
      }
      setDetail(selected);
      setRelatedEvents(Array.isArray(result.relatedEvents) ? result.relatedEvents : []);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setMessage(requestMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [error.id, error.trace_id, retry]);

  return (
    <DetailModal title="错误详情" onClose={onClose}>
      {loading ? <p role="status" className="py-6 text-white/75">正在加载错误详情…</p> : message ? (
        <div role="alert" className="space-y-4">
          <p className="text-amber-200">{message}</p>
          <Button type="button" variant="ghost" className="rounded-xl border border-white/25 bg-white/10 px-4 text-white hover:bg-white/20" onClick={() => setRetry((value) => value + 1)}>重试详情</Button>
        </div>
      ) : detail && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><span className="font-[450] text-neutral-100">路径：</span><span className="break-all text-white">{detail.path}</span></div>
            <div><span className="font-[450] text-neutral-100">方法：</span><span className="text-white">{detail.method}</span></div>
            <div><span className="font-[450] text-neutral-100">状态：</span><span className="text-white">{detail.status ?? '—'}</span></div>
            <div><span className="font-[450] text-neutral-100">错误码：</span><span className="text-white">{detail.error_code ?? '—'}</span></div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">Trace ID</div>
            <div className="break-all rounded-lg bg-black/50 p-2.5 font-mono text-[12px] leading-relaxed text-white">{detail.trace_id}</div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">错误信息</div>
            <div className="break-all rounded-lg bg-black/50 p-2.5 text-[13px] leading-relaxed text-white">{detail.error_message}</div>
          </div>
          {detail.error_stack && (
            <div>
              <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">调用栈</div>
              <pre className="max-h-[300px] overflow-auto rounded-lg bg-black/50 p-3 font-mono text-[13px] leading-6 whitespace-pre text-neutral-100">{detail.error_stack}</pre>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-[500] uppercase tracking-wider text-neutral-100">上下文</div>
            <pre className="max-h-[240px] overflow-auto rounded-lg bg-black/50 p-3 text-[13px] leading-6 whitespace-pre-wrap break-words text-neutral-100">{Object.keys(detail.context ?? {}).length ? JSON.stringify(detail.context, null, 2) : '暂无上下文数据'}</pre>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-[500] tracking-wider text-neutral-100">关联埋点（{relatedEvents.length}）</div>
            <pre className="max-h-[240px] overflow-auto rounded-lg bg-black/50 p-3 text-[13px] leading-6 whitespace-pre-wrap break-words text-neutral-100">{relatedEvents.length ? JSON.stringify(relatedEvents, null, 2) : '暂无关联埋点'}</pre>
          </div>
        </div>
      )}
    </DetailModal>
  );
}
