// 主题（浅色 / 深色 / 跟随系统）
// 与 index.html 的首屏内联脚本共用同一 localStorage 键与解析规则：
// 键缺省 = 跟随系统；首屏由内联脚本防闪烁，运行时切换与系统联动由本模块负责。
// 应用方式：<html> 上的 .dark 类（tokens.css 的语义别名随之整体联动）+ theme-color meta。
export type Theme = "light" | "dark" | "system";

const KEY = "on-merit-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "dark" || saved === "light" ? saved : "system";
}

/** 当前应呈现的明暗（system 时看系统偏好） */
export function resolvedDark(theme: Theme = getTheme()): boolean {
  return theme === "dark" || (theme === "system" && media().matches);
}

export function applyTheme() {
  const dark = resolvedDark();
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "black" : "white");
}

export function setTheme(theme: Theme) {
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  applyTheme();
}

/** 跟随系统模式下监听系统明暗变化；返回清理函数 */
export function watchSystemTheme(): () => void {
  const m = media();
  const onChange = () => { if (getTheme() === "system") applyTheme(); };
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
