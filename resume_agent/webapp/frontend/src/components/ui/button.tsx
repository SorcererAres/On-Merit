import * as React from "react";
import { cn } from "@/lib/cn";
type V = "primary" | "secondary" | "ghost" | "danger";
const styles: Record<V, string> = {
  // primary：色阶无「略浅的黑」token，沿用 Vercel 的 opacity hover（codex 确认对比度仍充足）
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  // danger：opacity 会连白字一起淡化跌破 AA，改用暗化 token（不碰文字）
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
  // 表面型：hover 走语义 hover-surface（accent = gray-200），两主题一致
  secondary: "bg-background border border-border text-foreground hover:bg-accent",
  ghost: "text-foreground hover:bg-accent",
};
export const Button = React.forwardRef<HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: V }>(
  ({ className, variant = "primary", ...p }, ref) => (
    <button ref={ref} className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md text-button-14 px-4 py-2 min-h-[40px]",
      // Geist 两层聚焦环：ring-offset 造 2px 间隙 + ring 画环
      "transition disabled:opacity-50 disabled:pointer-events-none",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      styles[variant], className)} {...p} />
  ));
Button.displayName = "Button";
