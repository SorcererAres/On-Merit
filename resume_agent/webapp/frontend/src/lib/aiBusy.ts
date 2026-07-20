// 画布 AI 进行中状态（Figma 1026:647）：跨面板/内联编辑共享，驱动中栏悬浮胶囊。
// abort 只断浏览器等待，不终止服务端推理（与 useTask 同语义）。
import { create } from "zustand";

export type AiBusyKind = "diagnose" | "polish" | "edit";

export const AI_BUSY_LABEL: Record<AiBusyKind, string> = {
  diagnose: "AI诊断简历中…",
  polish: "AI润色简历中…",
  edit: "AI编辑中…",
};

interface AiBusyEntry {
  id: string;
  kind: AiBusyKind;
  stop: () => void;
}

interface AiBusyState {
  current: AiBusyEntry | null;
  begin: (id: string, kind: AiBusyKind, stop: () => void) => void;
  end: (id: string) => void;
}

export const useAiBusyStore = create<AiBusyState>((set, get) => ({
  current: null,
  begin: (id, kind, stop) => set({ current: { id, kind, stop } }),
  end: (id) => {
    if (get().current?.id === id) set({ current: null });
  },
}));

/** 包一层 AbortController + 画布进行中胶囊；AbortError 吞掉返回 undefined。 */
export async function withAiBusy<T>(
  kind: AiBusyKind,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ctrl = new AbortController();
  useAiBusyStore.getState().begin(id, kind, () => ctrl.abort());
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") return undefined;
    throw e;
  } finally {
    useAiBusyStore.getState().end(id);
  }
}
