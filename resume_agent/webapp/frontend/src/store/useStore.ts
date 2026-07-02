// 全局状态（Zustand）：三阶段编辑流 + 绑定持久化记录。
// P2.5：用 editSeq/savedSeq 驱动 dirty，支撑自动保存的「单飞 + 合并待存 + savePoint 精确清 dirty」；
// hydrationKey 仅在载入/回滚 +1（子组件据此重挂，不随保存 version 变）；conflict 表示 409。
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
  phase: number; maxPhase: number;
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;
  diagnosis: Diagnosis | null;
  improve: { changes: Change[]; notes: string[]; supplements: string[] } | null;
  afterScore: { score: number; max: number } | null;

  // —— 持久化绑定 ——
  resumeId: string | null;
  version: number;
  title: string;
  dirty: boolean;
  editSeq: number;       // 每次可持久化字段变更 +1
  savedSeq: number;      // 最近一次成功保存所覆盖到的 editSeq
  hydrationKey: number;  // 仅载入/回滚 +1（子组件重挂用）
  conflict: boolean;     // 409：已在别处修改

  goPhase: (n: number) => void;
  unlock: (n: number) => void;
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
  phase: 1, maxPhase: 1,
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer",
  diagnosis: null, improve: null, afterScore: null,
  resumeId: null, version: 1, title: "", dirty: false,
  editSeq: 0, savedSeq: 0, hydrationKey: 0, conflict: false,

  goPhase: (n) => set({ phase: n }),
  unlock: (n) => set((s) => ({ maxPhase: Math.max(s.maxPhase, n) })),

  setImported: (r, warnings, usedOcr) => set(bump({
    resume: r, warnings, usedOcr, diagnosis: null, improve: null, afterScore: null,
  })),
  editResume: (r) => set(bump({ resume: r, diagnosis: null, improve: null, afterScore: null })),
  setJD: (jd) => set(bump({ jd, diagnosis: null, improve: null, afterScore: null })),
  setRole: (role) => set(bump({ role, diagnosis: null, improve: null, afterScore: null })),
  setTitle: (title) => set(bump({ title })),
  applyResume: (r) => set(bump({ resume: r, improve: null, afterScore: null })),

  setDiagnosis: (d) => set({ diagnosis: d }),           // 派生结果，不入 editSeq
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  setAfterScore: (score, max) => set({ afterScore: { score, max } }),

  loadRecord: (rec) => set((s) => ({
    resumeId: rec.id, version: rec.version, title: rec.title,
    resume: rec.data, jd: rec.jd || "", role: rec.role || "engineer",
    phase: 1, maxPhase: 3, warnings: [], usedOcr: false,
    diagnosis: null, improve: null, afterScore: null,
    editSeq: 0, savedSeq: 0, dirty: false, conflict: false,
    hydrationKey: s.hydrationKey + 1,
  })),
  // 保存成功：savedSeq 推进到本次覆盖的 seq；若期间又有编辑（editSeq>seq）dirty 仍为真
  markSaved: (seq, version, title) => set((s) => ({
    savedSeq: seq, version, title: title ?? s.title, dirty: s.editSeq > seq, conflict: false,
  })),
  setConflict: () => set({ conflict: true }),
}));
