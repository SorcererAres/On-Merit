// 慢任务 hook：单飞 + 可停止等待 + 已等待秒数 + 就地错误。
// 注意：abort 只断浏览器等待，不终止服务端推理（诚实语义）。
import { useCallback, useRef, useState } from "react";
import { ApiErr } from "./api";

export function useTask<Args extends unknown[], T>(
  fn: (signal: AbortSignal, ...args: Args) => Promise<T>,
) {
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiErr | Error | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const run = useCallback(async (...args: Args): Promise<T | undefined> => {
    if (loading) return;                    // 单飞：进行中忽略重复提交
    setError(null); setLoading(true); setElapsed(0);
    const t0 = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    ctrl.current = new AbortController();
    try {
      return await fn(ctrl.current.signal, ...args);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e as Error);
      return undefined;
    } finally {
      setLoading(false);
      if (timer.current) window.clearInterval(timer.current);
    }
  }, [fn, loading]);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  return { run, stop, loading, elapsed, error };
}
