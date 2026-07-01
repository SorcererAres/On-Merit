// 全局状态（Zustand）：向导 + canonical resume + jd + revision。
// 版本一致性：resume/jd 一变，revision++ 且下游结果全清（防旧结果覆盖新状态）。
import { create } from "zustand";
import type { Resume, MatchReport, Change, EvalResult, Warning } from "@/types";

interface State {
  step: number; maxStep: number;
  resume: Resume | null;
  warnings: Warning[];
  jd: string;
  revision: number;                 // resume/jd 每变一次 +1
  match: { rev: number; report: MatchReport } | null;
  improve: { rev: number; changes: Change[]; notes: string[]; supplements: string[] } | null;
  evalResult: { rev: number; data: EvalResult } | null;

  goStep: (n: number) => void;
  unlock: (n: number) => void;
  setResume: (r: Resume, warnings?: Warning[]) => void;
  touchResume: () => void;          // 编辑器改动后调用：bump revision + 清下游
  setJD: (jd: string) => void;
  setMatch: (report: MatchReport) => void;
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  setEval: (data: EvalResult) => void;
}

export const useStore = create<State>((set, get) => ({
  step: 1, maxStep: 1, resume: null, warnings: [], jd: "", revision: 0,
  match: null, improve: null, evalResult: null,

  goStep: (n) => set({ step: n }),
  unlock: (n) => set((s) => ({ maxStep: Math.max(s.maxStep, n) })),
  setResume: (r, warnings = []) => set((s) => ({
    resume: r, warnings, revision: s.revision + 1, match: null, improve: null, evalResult: null,
  })),
  touchResume: () => set((s) => ({
    revision: s.revision + 1, match: null, improve: null, evalResult: null,
  })),
  setJD: (jd) => set((s) => ({
    jd, revision: s.revision + 1, match: null, improve: null, evalResult: null,
  })),
  setMatch: (report) => set({ match: { rev: get().revision, report } }),
  setImprove: (changes, notes, supplements) => set({ improve: { rev: get().revision, changes, notes, supplements } }),
  setEval: (data) => set({ evalResult: { rev: get().revision, data } }),
}));

// 下游结果是否对应当前 revision（不是则视为过期需重跑）
export const isFresh = (rev: number | undefined) => rev === useStore.getState().revision;
