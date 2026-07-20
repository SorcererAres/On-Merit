import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Geist 自定义排版 token（tailwind.config.ts fontSize）：twMerge 默认主题不认识，
// 会把 text-heading-*/text-copy-* 等误判为「文字颜色」组，与同处一个 cn() 的
// text-muted-foreground 等真颜色互斥 → 字号类被静默剥掉（回退 16px）。
// 这里把全部自定义字号 token 显式注册进 font-size 组。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-heading-72", "text-heading-64", "text-heading-56", "text-heading-48",
        "text-heading-40", "text-heading-32", "text-heading-24", "text-heading-20",
        "text-heading-16", "text-heading-14",
        "text-button-16", "text-button-14", "text-button-12",
        "text-label-20", "text-label-18", "text-label-16",
        "text-label-14", "text-label-14-mono",
        "text-label-13", "text-label-13-mono",
        "text-label-12", "text-label-12-mono",
        "text-copy-24", "text-copy-20", "text-copy-18", "text-copy-16",
        "text-copy-14", "text-copy-14-mono",
        "text-copy-13", "text-copy-13-mono",
      ],
    },
  },
});

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
