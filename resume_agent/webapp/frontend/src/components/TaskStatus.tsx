import { Spinner } from "./ui/misc";
import { Button } from "./ui/button";
import { Alert } from "./ui/misc";
import { ApiErr } from "@/lib/api";
// 页面内任务状态区（非全屏遮罩）：转圈 + 已等待 Ns + 停止等待；错误就地展示。
export function TaskStatus({ loading, elapsed, stop, error }:
  { loading: boolean; elapsed: number; stop: () => void; error: Error | null }) {
  return (
    <div aria-live="polite">
      {loading && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <Spinner />
          <span className="text-copy-14 text-muted-foreground">处理中 · 已等待 {elapsed}s（本地模型可能要几十秒）</span>
          <Button variant="secondary" className="ml-auto" onClick={stop}>停止等待</Button>
        </div>
      )}
      {error && !loading && (
        <Alert tone="red" className="mt-4">
          出错了：{error.message}
          {error instanceof ApiErr && error.requestId ? <span className="text-label-12 opacity-70">（{error.requestId}）</span> : null}
        </Alert>
      )}
    </div>
  );
}
