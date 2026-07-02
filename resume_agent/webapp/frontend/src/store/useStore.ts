// 全局状态（Zustand）：文档绑定 + 持久化。
// editSeq/savedSeq 驱动 dirty（savePoint 精确清）；conflict=409；hydrationKey：编辑列重挂信号
//   （loadRecord/回滚 与 setImported/applyResume 时 +1，不随保存 version 变）；loadSeq：仅 loadRecord +1。
// exportMdSeq / layoutSeq：各自独立 savePoint，保存回写只在期间未再改该字段时采用服务端值。
import { create } from "zustand";
import type { Resume, MatchReport, Change, EvalResult, Warning } from "@/types";
import { DEFAULT_LAYOUT, type LayoutSettings } from "@/lib/templates";

export interface Diagnosis {
  evalResult: EvalResult;
  match: MatchReport | null;
}

export interface ResumeRecord {
  id: string; title: string; role: string; jd: string;
  data: Resume; export_md?: string | null; source_text?: string | null;
  layout_settings?: Partial<LayoutSettings> | null; version: number;
}

interface Saved {
  seq: number; version: number; title?: string;
  exportMd?: string | null; exportMdSeqAtSave: number;
  layoutSettings?: Partial<LayoutSettings> | null; layoutSeqAtSave: number;
}

interface State {
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;
  exportMd: string | null;
  sourceText: string | null;
  linkQuery: string | null;
  layoutSettings: LayoutSettings;
  diagnosis: Diagnosis | null;
  improve: { changes: Change[]; notes: string[]; supplements: string[] } | null;
  afterScore: { before: number | null; score: number; max: number } | null;

  // —— 持久化绑定 ——
  resumeId: string | null;
  version: number;
  title: string;
  dirty: boolean;
  editSeq: number;
  savedSeq: number;
  hydrationKey: number;
  loadSeq: number;
  exportMdSeq: number;
  layoutSeq: number;
  conflict: boolean;

  setImported: (r: Resume, warnings: Warning[], usedOcr: boolean, sourceText: string | null) => void;
  setLinkQuery: (q: string | null) => void;
  editResume: (r: Resume) => void;
  setJD: (jd: string) => void;
  setRole: (role: string) => void;
  setTitle: (title: string) => void;
  setExportMd: (md: string | null) => void;
  setLayout: (patch: Partial<LayoutSettings>) => void;
  setDiagnosis: (d: Diagnosis) => void;
  applyResume: (r: Resume) => void;
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  setAfterScore: (before: number | null, score: number, max: number) => void;
  loadRecord: (rec: ResumeRecord) => void;
  markSaved: (saved: Saved) => void;
  setConflict: () => void;
}

const bump = (extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({ ...extra, editSeq: s.editSeq + 1, dirty: true });

// 外部替换文档内容（导入/采纳改写）：除 bump 外还 +hydrationKey。exportMd 不预清（失效以后端为准，
// 按 exportMdSeq 精确同步）；layout 与内容正交，不随 data 变更失效。
const replaceDoc = (r: Resume, extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({
    resume: r, diagnosis: null, improve: null, afterScore: null,
    hydrationKey: s.hydrationKey + 1, editSeq: s.editSeq + 1, dirty: true, ...extra,
  });

export const useStore = create<State>((set) => ({
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer", exportMd: null,
  sourceText: null, linkQuery: null, layoutSettings: DEFAULT_LAYOUT,
  diagnosis: null, improve: null, afterScore: null,
  resumeId: null, version: 1, title: "", dirty: false,
  editSeq: 0, savedSeq: 0, hydrationKey: 0, loadSeq: 0, exportMdSeq: 0, layoutSeq: 0, conflict: false,

  setImported: (r, warnings, usedOcr, sourceText) => set(replaceDoc(r, { warnings, usedOcr, sourceText })),
  setLinkQuery: (q) => set({ linkQuery: q }),
  applyResume: (r) => set(replaceDoc(r)),

  editResume: (r) => set(bump({ resume: r, diagnosis: null, improve: null, afterScore: null })),
  setJD: (jd) => set(bump({ jd, diagnosis: null, improve: null, afterScore: null })),
  setRole: (role) => set(bump({ role, diagnosis: null, improve: null, afterScore: null })),
  setTitle: (title) => set(bump({ title })),
  setExportMd: (md) => set((s) => ({ exportMd: md, editSeq: s.editSeq + 1, exportMdSeq: s.editSeq + 1, dirty: true })),
  // 样式变更：合并 + 独立 layoutSeq（同 exportMdSeq 思路，保存回写精确判定是否被在途新样式覆盖）
  setLayout: (patch) => set((s) => ({
    layoutSettings: { ...s.layoutSettings, ...patch }, editSeq: s.editSeq + 1, layoutSeq: s.editSeq + 1, dirty: true,
  })),

  setDiagnosis: (d) => set({ diagnosis: d }),
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  setAfterScore: (before, score, max) => set({ afterScore: { before, score, max } }),

  loadRecord: (rec) => set((s) => ({
    resumeId: rec.id, version: rec.version, title: rec.title,
    resume: rec.data, jd: rec.jd || "", role: rec.role || "engineer",
    exportMd: rec.export_md ?? null, sourceText: rec.source_text ?? null, linkQuery: null,
    layoutSettings: { ...DEFAULT_LAYOUT, ...(rec.layout_settings || {}) },
    warnings: [], usedOcr: false,
    diagnosis: null, improve: null, afterScore: null,
    editSeq: 0, savedSeq: 0, dirty: false, conflict: false,
    hydrationKey: s.hydrationKey + 1, loadSeq: s.loadSeq + 1, exportMdSeq: 0, layoutSeq: 0,
  })),
  // 保存成功：savedSeq 推进；title/exportMd/layout 分字段 savePoint——仅在保存后未再改该字段时采用服务端值。
  markSaved: ({ seq, version, title, exportMd, exportMdSeqAtSave, layoutSettings, layoutSeqAtSave }) => set((s) => ({
    savedSeq: seq, version,
    ...(s.editSeq === seq && title !== undefined ? { title } : {}),
    ...(s.exportMdSeq === exportMdSeqAtSave && exportMd !== undefined ? { exportMd } : {}),
    ...(s.layoutSeq === layoutSeqAtSave && layoutSettings
      ? { layoutSettings: { ...DEFAULT_LAYOUT, ...layoutSettings } } : {}),
    dirty: s.editSeq > seq, conflict: false,
  })),
  setConflict: () => set({ conflict: true }),
}));
