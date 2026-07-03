// 全局状态（Zustand）：文档绑定 + 持久化。
// editSeq/savedSeq 驱动 dirty（savePoint 精确清）；conflict=409；hydrationKey：编辑列重挂信号
//   （loadRecord/回滚 与 setImported/applyResume 时 +1，不随保存 version 变）；loadSeq：仅 loadRecord +1。
// layoutSeq：layout 独立 savePoint，保存回写只在期间未再改该字段时采用服务端值。
// 注：export_md（自由 MD 覆盖）在向导 v2 已被模板/样式取代，前端不再读写（后端列保留兼容旧数据）。
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
  layoutSettings?: Partial<LayoutSettings> | null; layoutSeqAtSave: number;
}

/** undo/redo 快照：文档级可编辑字段 + 原件语境（sourceText/warnings/usedOcr——
 * 撤销「导入」必须连原件一起回退，否则原件栏与简历内容错配）。
 * 不含诊断/润色结果——恢复时按失效规则清空。 */
export interface Snapshot {
  resume: Resume | null; title: string; jd: string; role: string;
  layoutSettings: LayoutSettings;
  sourceText: string | null; warnings: Warning[]; usedOcr: boolean;
}

interface State {
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;
  sourceText: string | null;
  linkQuery: string | null;
  layoutSettings: LayoutSettings;
  diagnosis: Diagnosis | null;
  improve: { changes: Change[]; notes: string[]; supplements: string[] } | null;

  // —— 持久化绑定 ——
  resumeId: string | null;
  version: number;
  title: string;
  dirty: boolean;
  editSeq: number;
  savedSeq: number;
  hydrationKey: number;
  loadSeq: number;
  layoutSeq: number;
  conflict: boolean;

  setImported: (r: Resume, warnings: Warning[], usedOcr: boolean, sourceText: string | null) => void;
  setLinkQuery: (q: string | null) => void;
  editResume: (r: Resume) => void;
  setJD: (jd: string) => void;
  setRole: (role: string) => void;
  setTitle: (title: string) => void;
  setLayout: (patch: Partial<LayoutSettings>) => void;
  setDiagnosis: (d: Diagnosis) => void;
  applyResume: (r: Resume) => void;
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  restoreSnapshot: (snap: Snapshot) => void;
  loadRecord: (rec: ResumeRecord) => void;
  markSaved: (saved: Saved) => void;
  setConflict: () => void;
}

const bump = (extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({ ...extra, editSeq: s.editSeq + 1, dirty: true });

// 外部替换文档内容（导入/采纳改写）：除 bump 外还 +hydrationKey。
// layout 与内容正交，不随 data 变更失效。
const replaceDoc = (r: Resume, extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({
    resume: r, diagnosis: null, improve: null,
    hydrationKey: s.hydrationKey + 1, editSeq: s.editSeq + 1, dirty: true, ...extra,
  });

export const useStore = create<State>((set) => ({
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer",
  sourceText: null, linkQuery: null, layoutSettings: DEFAULT_LAYOUT,
  diagnosis: null, improve: null,
  resumeId: null, version: 1, title: "", dirty: false,
  editSeq: 0, savedSeq: 0, hydrationKey: 0, loadSeq: 0, layoutSeq: 0, conflict: false,

  setImported: (r, warnings, usedOcr, sourceText) => set(replaceDoc(r, { warnings, usedOcr, sourceText })),
  setLinkQuery: (q) => set({ linkQuery: q }),
  applyResume: (r) => set(replaceDoc(r)),

  editResume: (r) => set(bump({ resume: r, diagnosis: null, improve: null })),
  setJD: (jd) => set(bump({ jd, diagnosis: null, improve: null })),
  setRole: (role) => set(bump({ role, diagnosis: null, improve: null })),
  setTitle: (title) => set(bump({ title })),
  // 样式变更：合并 + 独立 layoutSeq（保存回写精确判定是否被在途新样式覆盖）
  setLayout: (patch) => set((s) => ({
    layoutSettings: { ...s.layoutSettings, ...patch }, editSeq: s.editSeq + 1, layoutSeq: s.editSeq + 1, dirty: true,
  })),

  setDiagnosis: (d) => set({ diagnosis: d }),
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  // undo/redo 恢复：等价一次外部替换（bump + 重挂编辑列 + 失效诊断/润色）；
  // layoutSeq 同步推进（快照可能带不同样式，需按「此后未再改」语义参与保存回写判定）；
  // 原件语境（sourceText/warnings/usedOcr）随快照恢复——撤销导入时原件栏同步回退。
  restoreSnapshot: (snap) => set((s) => ({
    resume: snap.resume, title: snap.title, jd: snap.jd, role: snap.role,
    layoutSettings: snap.layoutSettings,
    sourceText: snap.sourceText, warnings: snap.warnings, usedOcr: snap.usedOcr,
    linkQuery: null,
    diagnosis: null, improve: null,
    editSeq: s.editSeq + 1, layoutSeq: s.editSeq + 1, dirty: true,
    hydrationKey: s.hydrationKey + 1,
  })),

  loadRecord: (rec) => set((s) => ({
    resumeId: rec.id, version: rec.version, title: rec.title,
    resume: rec.data, jd: rec.jd || "", role: rec.role || "engineer",
    sourceText: rec.source_text ?? null, linkQuery: null,
    layoutSettings: { ...DEFAULT_LAYOUT, ...(rec.layout_settings || {}) },
    warnings: [], usedOcr: false,
    diagnosis: null, improve: null,
    editSeq: 0, savedSeq: 0, dirty: false, conflict: false,
    hydrationKey: s.hydrationKey + 1, loadSeq: s.loadSeq + 1, layoutSeq: 0,
  })),
  // 保存成功：savedSeq 推进；title/layout 分字段 savePoint——仅在保存后未再改该字段时采用服务端值。
  markSaved: ({ seq, version, title, layoutSettings, layoutSeqAtSave }) => set((s) => ({
    savedSeq: seq, version,
    ...(s.editSeq === seq && title !== undefined ? { title } : {}),
    ...(s.layoutSeq === layoutSeqAtSave && layoutSettings
      ? { layoutSettings: { ...DEFAULT_LAYOUT, ...layoutSettings } } : {}),
    dirty: s.editSeq > seq, conflict: false,
  })),
  setConflict: () => set({ conflict: true }),
}));
