// 全局状态（Zustand）：三栏编辑器（文档绑定）+ 持久化。
// editSeq/savedSeq 驱动 dirty（savePoint 精确清）；conflict=409；
// hydrationKey：编辑列重挂信号——loadRecord/回滚 与 setImported/applyResume（外部替换文档）时 +1，
//   绝不随保存 version 变；loadSeq：仅 loadRecord +1，供在途请求判「语境已换，丢弃结果」。
import { create } from "zustand";
import type { Resume, MatchReport, Change, EvalResult, Warning } from "@/types";

export interface Diagnosis {
  evalResult: EvalResult;
  match: MatchReport | null;
}

export interface ResumeRecord {
  id: string; title: string; role: string; jd: string;
  data: Resume; export_md?: string | null; source_text?: string | null;
  layout_settings?: Record<string, unknown> | null; version: number;
}

interface State {
  resume: Resume | null;
  warnings: Warning[];
  usedOcr: boolean;
  jd: string;
  role: string;
  exportMd: string | null;                    // 排版 Markdown（null=从 data 派生）
  sourceText: string | null;                  // 节点1 原文层（ingest 抽取，随保存持久化）
  linkQuery: string | null;                   // 联动高亮目标（UI 临时，不持久、不置 dirty）
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
  exportMdSeq: number;    // exportMd 最近一次本地变更时的 editSeq（精确判定是否在保存期间被改）
  conflict: boolean;

  setImported: (r: Resume, warnings: Warning[], usedOcr: boolean, sourceText: string | null) => void;
  setLinkQuery: (q: string | null) => void;
  editResume: (r: Resume) => void;
  setJD: (jd: string) => void;
  setRole: (role: string) => void;
  setTitle: (title: string) => void;
  setExportMd: (md: string | null) => void;
  setDiagnosis: (d: Diagnosis) => void;
  applyResume: (r: Resume) => void;
  setImprove: (changes: Change[], notes: string[], supplements: string[]) => void;
  setAfterScore: (before: number | null, score: number, max: number) => void;
  loadRecord: (rec: ResumeRecord) => void;
  markSaved: (seq: number, version: number, title: string | undefined,
              exportMd: string | null | undefined, exportMdSeqAtSave: number) => void;
  setConflict: () => void;
}

// 可持久化字段的变更：bump editSeq + dirty
const bump = (extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({ ...extra, editSeq: s.editSeq + 1, dirty: true });

// 外部替换文档内容（导入/采纳改写）：除 bump 外还 +hydrationKey（编辑列重挂取新值）。
// exportMd **不预清**（失效以后端为准——避免保存失败/409 时丢掉用户排版）；data 变更时
// 服务端置 NULL，前端据保存返回按 exportMdSeq 精确同步（见 markSaved）。见 §四。
const replaceDoc = (r: Resume, extra: Partial<State> = {}) =>
  (s: State): Partial<State> => ({
    resume: r, diagnosis: null, improve: null, afterScore: null,
    hydrationKey: s.hydrationKey + 1, editSeq: s.editSeq + 1, dirty: true, ...extra,
  });

export const useStore = create<State>((set) => ({
  resume: null, warnings: [], usedOcr: false, jd: "", role: "engineer", exportMd: null,
  sourceText: null, linkQuery: null,
  diagnosis: null, improve: null, afterScore: null,
  resumeId: null, version: 1, title: "", dirty: false,
  editSeq: 0, savedSeq: 0, hydrationKey: 0, loadSeq: 0, exportMdSeq: 0, conflict: false,

  // 导入：新文档 + 原文层（sourceText 随 replaceDoc 置 dirty，由 autosave 持久化）
  setImported: (r, warnings, usedOcr, sourceText) => set(replaceDoc(r, { warnings, usedOcr, sourceText })),
  setLinkQuery: (q) => set({ linkQuery: q }),   // UI 临时，不 bump、不 dirty
  applyResume: (r) => set(replaceDoc(r)),

  editResume: (r) => set(bump({ resume: r, diagnosis: null, improve: null, afterScore: null })),
  setJD: (jd) => set(bump({ jd, diagnosis: null, improve: null, afterScore: null })),
  setRole: (role) => set(bump({ role, diagnosis: null, improve: null, afterScore: null })),
  setTitle: (title) => set(bump({ title })),
  // 排版编辑：记录 exportMdSeq = 变更后的 editSeq，供保存回写精确判定「是否被在途新排版编辑覆盖」
  setExportMd: (md) => set((s) => ({ exportMd: md, editSeq: s.editSeq + 1, exportMdSeq: s.editSeq + 1, dirty: true })),

  setDiagnosis: (d) => set({ diagnosis: d }),
  setImprove: (changes, notes, supplements) => set({ improve: { changes, notes, supplements } }),
  setAfterScore: (before, score, max) => set({ afterScore: { before, score, max } }),

  loadRecord: (rec) => set((s) => ({
    resumeId: rec.id, version: rec.version, title: rec.title,
    resume: rec.data, jd: rec.jd || "", role: rec.role || "engineer",
    exportMd: rec.export_md ?? null, sourceText: rec.source_text ?? null, linkQuery: null,
    warnings: [], usedOcr: false,
    diagnosis: null, improve: null, afterScore: null,
    editSeq: 0, savedSeq: 0, dirty: false, conflict: false,
    hydrationKey: s.hydrationKey + 1, loadSeq: s.loadSeq + 1, exportMdSeq: 0,
  })),
  // 保存成功：savedSeq 推进到本次覆盖的 seq。回写用**分字段** savePoint：
  //  · title 仅在保存后无任何新编辑（editSeq===seq）时采用服务端值（否则保留在途新标题）；
  //  · exportMd 仅在保存后未再动过排版（exportMdSeq===exportMdSeqAtSave）时采用服务端值——
  //    这样 data 变更导致的服务端 NULL 能被采纳（不受期间 title/jd 编辑干扰），又保住在途新排版。
  markSaved: (seq, version, title, exportMd, exportMdSeqAtSave) => set((s) => {
    const titleClean = s.editSeq === seq;
    const mdClean = s.exportMdSeq === exportMdSeqAtSave;
    return {
      savedSeq: seq, version,
      ...(titleClean && title !== undefined ? { title } : {}),
      ...(mdClean && exportMd !== undefined ? { exportMd } : {}),
      dirty: s.editSeq > seq, conflict: false,
    };
  }),
  setConflict: () => set({ conflict: true }),
}));
