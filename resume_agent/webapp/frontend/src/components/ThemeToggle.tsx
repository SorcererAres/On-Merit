// 顶栏主题切换：触发图标随当前明暗联动（Sun/Moon），菜单三选一（浅色/深色/跟随系统）。
// 跟随系统的实时联动（watchSystemTheme）也挂在这里——画廊与编辑器顶栏各渲染一个实例，
// 同一时刻只有一个在挂载，监听不会重复。
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { getTheme, resolvedDark, setTheme, watchSystemTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [dark, setDark] = useState(resolvedDark);
  useEffect(() => watchSystemTheme(), []);
  // 明暗以 <html> 的 .dark 类为准（系统联动只改 DOM），观察它来刷新触发图标
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const select = (value: string) => {
    setTheme(value as Theme);
    setThemeState(value as Theme);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" aria-label="切换主题"
          className={cn("!h-8 !min-h-8 w-8 shrink-0 !rounded-header px-0 active:scale-100", className)}>
          {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={select}>
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-11 gap-2 text-copy-14">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
