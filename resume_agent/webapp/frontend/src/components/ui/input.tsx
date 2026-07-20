import * as React from "react";
import { cn } from "@/lib/cn";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input ref={ref} className={cn(
      "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-copy-16 md:text-copy-14",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background placeholder:text-muted-foreground",
      "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-700", className)} {...p} />
  ));
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => (
    <textarea ref={ref} className={cn(
      "w-full rounded-md border border-input bg-background px-3 py-2 text-copy-16 md:text-copy-14 resize-y",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background placeholder:text-muted-foreground",
      "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-700", className)} {...p} />
  ));
Textarea.displayName = "Textarea";
// 原生 Select 已退役：下拉一律用 ui/select（shadcn Radix Select，自绘弹层）
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) =>
  <label className={cn("block text-label-12 text-muted-foreground mb-1", className)} {...p} />;
