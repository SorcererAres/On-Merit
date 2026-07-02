// 全局状态（Zustand）：三栏编辑器（文档绑定）+ 持久化。
// editSeq/savedSeq 驱动 dirty（savePoint 精确清）；hydrationKey 仅载入/回滚 +1；conflict=409。
// 见 docs/plans/multi-resume-persistence.md §四 与 frontend-wysiwyg-editor.md §五。
import { create } from "zustand";
import type { Resume, MatchReport, Change, EvalResult, Warning } from "@/types";

export interface Diagnosis {
  evalResult: EvalResult;
  match: MatchReport | null;
}

export interface ResumeRecord {
  id: string; title: string; role: string; jd: string;
  data: Resume; export_md?: string | null; version: number;
}

interface State {
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;
  diagnosis: Diagnosis | null;                 // 诊断结果（resume 一变即清空——失效=清空）
  improve: { changes: Change[]; notes: string[]; supplements: string[] } | null;
  afterScore: { score: number; max: number } | null;

  // —— 持久化绑定 ——
  resumeId: string | null;
  version: number;
  title: string;
  dirty: boolean;
  editSeq: number;
  savedSeq: number;
  hydrationKey: number;
  conflict: boolean;

  setImported: (r: Resume, warnings: Warning[], usedOcr: boolean) => void;
  editResume: (r: Resume) => void;
  setJD: (jd: string) => void;
  setRole: (role: string) => void;
  setTitle: (title: string) => void;
  setDiagnosis: (d: Diagnosis) => void;
  applyResume: (r: Resume) => void;
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  setAfterScore: (score: number, max: number) => void;
  loadRecord: (rec: ResumeRecord) => void;
  markSaved: (seq: number, version: number, title?: string) => void;
  setConflict: () => void;
}

// 可持久化字段的变更：bump editSeq + dirty
const bump = (extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({ ...extra, editSeq: s.editSeq + 1, dirty: true });

export const useStore = create<State>((set) => ({
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer",
  diagnosis: null, improve: null, afterScore: null,
  resumeId: null, version: 1, title: "", dirty: false,
  editSeq: 0, savedSeq: 0, hydrationKey: 0, conflict: false,

  setImported: (r, warnings, usedOcr) => set(bump({
    resume: r, warnings, usedOcr, diagnosis: null, improve: null, afterScore: null,
  })),
  editResume: (r) => set(bump({ resume: r, diagnosis: null, improve: null, afterScore: null })),
  setJD: (jd) => set(bump({ jd, diagnosis: null, improve: null, afterScore: null })),
  setRole: (role) => set(bump({ role, diagnosis: null, improve: null, afterScore: null })),
  setTitle: (title) => set(bump({ title })),
  applyResume: (r) => set(bump({ resume: r, improve: null, afterScore: null })),

  setDiagnosis: (d) => set({ diagnosis: d }),
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  setAfterScore: (score, max) => set({ afterScore: { score, max } }),

  loadRecord: (rec) => set((s) => ({
    resumeId: rec.id, version: rec.version, title: rec.title,
    resume: rec.data, jd: rec.jd || "", role: rec.role || "engineer",
    warnings: [], usedOcr: false,
    diagnosis: null, improve: null, afterScore: null,
    editSeq: 0, savedSeq: 0, dirty: false, conflict: false,
    hydrationKey: s.hydrationKey + 1,
  })),
  markSaved: (seq, version, title) => set((s) => ({
    savedSeq: seq, version, title: title ?? s.title, dirty: s.editSeq > seq, conflict: false,
  })),
  setConflict: () => set({ conflict: true }),
}));
