// 自动保存编排（见 multi-resume-persistence.md §四）：
// 单飞（同一时刻一个 PUT）+ 合并待存（在途期间的新编辑，完成后 trailing save）
// + savePoint（用 editSeq 精确清 dirty，避免保存成功瞬间清掉在途新编辑）+ 409 → conflict。
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
    if (s.editSeq <= s.savedSeq || !s.resume || s.resumeId !== id) return;  // 无新增/未就绪
    const seq = s.editSeq;                                                   // savePoint
    savingRef.current = true; setSaving(true);
    try {
      const r = await putJSON<ResumeRecord>(`/api/resumes/${id}`, {
        version: s.version, fields: ["data", "jd", "role", "title"],
        data: s.resume, jd: s.jd, role: s.role, title: s.title, note: "自动保存",
      });
      useStore.getState().markSaved(seq, r.version, r.title);
    } catch (e) {
      if ((e as ApiErr)?.code === "VERSION_CONFLICT") useStore.getState().setConflict();
      // 其它错误：保持 dirty，下次编辑或手动保存再试
    } finally {
      savingRef.current = false; setSaving(false);
      const s2 = useStore.getState();
      if (s2.editSeq > s2.savedSeq && !s2.conflict && s2.resumeId === id) void run();  // trailing
    }
  };
  const runRef = useRef(run); runRef.current = run;

  // editSeq 变化 → 防抖触发自动保存
  useEffect(() => {
    const unsub = useStore.subscribe((st, prev) => {
      if (st.editSeq !== prev.editSeq) {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void runRef.current(), DEBOUNCE);
      }
    });
    return () => { unsub(); if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, []);

  return { saving, saveNow: () => runRef.current() };
}
