// 自动保存编排（见 multi-resume-persistence.md §四）：
// 单飞 + 合并待存(trailing) + savePoint（editSeq 精确清 dirty）+ 409→conflict。
// 结果回写前校验 resumeId/loadSeq 未变（重载/切换后丢弃在途结果，防止污染新语境）。
// saveNow：等待在途完成后确保存净，返回是否成功（导航守卫据此决定是否离开）。
import { useEffect, useRef, useState } from "react";
import { putJSON, ApiErr } from "./api";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";

const DEBOUNCE = 800;

export function useAutoSave(id: string) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const run = async (): Promise<void> => {
    const s = useStore.getState();
    if (savingRef.current || s.conflict) return;
    if (s.editSeq <= s.savedSeq || !s.resume || s.resumeId !== id) return;
    const seq = s.editSeq;                 // savePoint（title/dirty）
    const exportMdSeqAtSave = s.exportMdSeq; // exportMd 专属 savePoint
    const loadSeq = s.loadSeq;             // 语境戳：重载后丢弃本次结果
    savingRef.current = true; setSaving(true);
    try {
      const r = await putJSON<ResumeRecord>(`/api/resumes/${id}`, {
        version: s.version,
        fields: ["data", "jd", "role", "title", "export_md"],
        data: s.resume, jd: s.jd, role: s.role, title: s.title, export_md: s.exportMd,
        note: "自动保存",
      });
      const cur = useStore.getState();
      if (cur.resumeId === id && cur.loadSeq === loadSeq) {
        cur.markSaved(seq, r.version, r.title, r.export_md ?? null, exportMdSeqAtSave);
      }
      // 语境已换（重载/切简历）：丢弃结果，不 markSaved
    } catch (e) {
      const cur = useStore.getState();
      if (cur.resumeId === id && cur.loadSeq === loadSeq
          && (e as ApiErr)?.code === "VERSION_CONFLICT") cur.setConflict();
      // 其它错误：保持 dirty，下次编辑或 saveNow 再试
    } finally {
      savingRef.current = false; setSaving(false);
      const s2 = useStore.getState();
      if (s2.editSeq > s2.savedSeq && !s2.conflict && s2.resumeId === id && s2.loadSeq === loadSeq) {
        void run();                        // trailing：在途期间的新编辑
      }
    }
  };
  const runRef = useRef(run); runRef.current = run;

  useEffect(() => {
    const unsub = useStore.subscribe((st, prev) => {
      if (st.editSeq !== prev.editSeq) {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void runRef.current(), DEBOUNCE);
      }
    });
    return () => { unsub(); if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, []);

  // 立即存净：等待在途 → 补存 → 返回是否「已全部落库且无冲突」
  const saveNow = async (): Promise<boolean> => {
    for (let i = 0; i < 100 && savingRef.current; i++) {
      await new Promise((r) => setTimeout(r, 100));  // 等在途（上限 10s）
    }
    let s = useStore.getState();
    if (s.conflict) return false;
    if (s.editSeq > s.savedSeq) await runRef.current();
    s = useStore.getState();
    return !s.conflict && s.editSeq <= s.savedSeq;
  };

  return { saving, saveNow };
}
