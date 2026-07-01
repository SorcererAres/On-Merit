// 全局状态（Zustand）：三阶段（诊断/修改/排版）+ canonical resume + 诊断快照。
// 版本一致性：resume/jd/role 变则清相应下游；诊断快照 diagnosis 作为「修改前基线」，
// 在应用改写（applyResume）时刻意保留，用于修改后前后分数对比。
import { create } from "zustand";
import type { Resume, MatchReport, Change, EvalResult, Warning } from "@/types";

export interface Diagnosis {
  evalResult: EvalResult;      // 基线评分（evaluation/score/max/gaps/role_label）
  match: MatchReport | null;   // 填了 JD 才有
}

interface State {
  phase: number; maxPhase: number;      // 1 诊断 · 2 修改 · 3 排版
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;                         // 岗位 rubric key（自动检测/手动）
  diagnosis: Diagnosis | null;          // 诊断快照（= 修改前基线）
  improve: { changes: Change[]; notes: string[]; supplements: string[] } | null;
  afterScore: { score: number; max: number } | null;  // 修改后复评分

  goPhase: (n: number) => void;
  unlock: (n: number) => void;
  setImported: (r: Resume, warnings: Warning[], usedOcr: boolean) => void;
  editResume: (r: Resume) => void;      // 核对纠错：改简历 + 清诊断（基线过期）
  setJD: (jd: string) => void;
  setRole: (role: string) => void;
  setDiagnosis: (d: Diagnosis) => void;
  applyResume: (r: Resume) => void;     // 应用改写：改简历，保留 diagnosis 作 before
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  setAfterScore: (score: number, max: number) => void;
}

export const useStore = create<State>((set) => ({
  phase: 1, maxPhase: 1,
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer",
  diagnosis: null, improve: null, afterScore: null,

  goPhase: (n) => set({ phase: n }),
  unlock: (n) => set((s) => ({ maxPhase: Math.max(s.maxPhase, n) })),
  setImported: (r, warnings, usedOcr) => set({
    resume: r, warnings, usedOcr, diagnosis: null, improve: null, afterScore: null,
  }),
  editResume: (r) => set({ resume: r, diagnosis: null, improve: null, afterScore: null }),
  setJD: (jd) => set({ jd, diagnosis: null, improve: null, afterScore: null }),
  setRole: (role) => set({ role, diagnosis: null, improve: null, afterScore: null }),
  setDiagnosis: (d) => set({ diagnosis: d }),
  applyResume: (r) => set({ resume: r, improve: null, afterScore: null }), // 保留 diagnosis（before）
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  setAfterScore: (score, max) => set({ afterScore: { score, max } }),
}));
