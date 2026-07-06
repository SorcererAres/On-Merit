// Checkbox（组件库组件，FRONTEND.md §五 映射落地）：原生 input 自持皮肤，零新依赖。
// 原生 checkbox 的键盘/aria/焦点态天然合格（不压 outline，吃全局 :focus-visible 环）；
// accent-color 走 primary token，两主题联动。尺寸统一 16px（Emil：点击热区靠外层 label 扩大）。
import * as React from "react";
import { cn } from "@/lib/cn";

export const Checkbox = React.forwardRef<HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className, ...p }, ref) => (
    <input ref={ref} type="checkbox"
      className={cn("h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...p} />
  ));
Checkbox.displayName = "Checkbox";
