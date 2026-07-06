// 命令式确认弹窗：confirmDialog(opts) → Promise<boolean>，替代 window.confirm（系统弹窗不合规范）。
// 业务组件：组合 ui/alert-dialog + ui/button；App 根部挂一次 <ConfirmHost />。
// 同一时刻至多一个弹窗；新请求到来时旧请求按「取消」结算（正常流程不会发生）。
import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;   // 默认「确定」
  cancelText?: string;    // 默认「取消」
  destructive?: boolean;  // 危险动作 → 确认键用 danger 皮肤
}

let notify: ((req: ConfirmOptions | null) => void) | null = null;
let resolver: ((v: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    resolver?.(false);
    resolver = resolve;
    notify?.(opts);
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmOptions | null>(null);
  useEffect(() => {
    notify = setReq;
    return () => { notify = null; resolver?.(false); resolver = null; };
  }, []);
  const answer = (v: boolean) => {
    setReq(null);
    resolver?.(v); resolver = null;
  };
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) answer(false); }}>
      {req && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{req.title}</AlertDialogTitle>
            {req.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary" onClick={() => answer(false)}>{req.cancelText ?? "取消"}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant={req.destructive ? "danger" : "primary"} onClick={() => answer(true)}>
                {req.confirmText ?? "确定"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
