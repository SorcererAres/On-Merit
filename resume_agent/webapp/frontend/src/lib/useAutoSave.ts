// 自动保存编排（见 multi-resume-persistence.md §四）：
// 单飞 + 合并待存(trailing) + savePoint（editSeq 精确清 dirty）+ 409→conflict。
// 结果回写前校验 resumeId/loadSeq 未变（重载/切换后丢弃在途结果，防止污染新语境）。
// saveNow：等待在途完成后确保存净，返回是否成功（导航守卫据此决定是否离开）。
import { useEffect, useRef, useState } from "react";
import { putJSON, ApiErr } from "./api";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";

const DEBOUNCE = 800;
const RETRY_MS = 4000;                     // 退避重试基准间隔（指数递增）
const MAX_RETRIES = 4;                      // 连续失败的自动重试次数上限（有新编辑则重置）

export function useAutoSave(id: string) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);           // 连续失败计数；成功或新编辑归零
  const clearRetry = () => {
    if (retryTimerRef.current) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  };

  const run = async (): Promise<void> => {
    const s = useStore.getState();
    if (savingRef.current || s.conflict) return;
    if (s.editSeq <= s.savedSeq || !s.resume || s.resumeId !== id) return;
    clearRetry();                          // 已进入新一次尝试，撤销待定的退避重试
    const seq = s.editSeq;                 // savePoint（title/dirty）
    const layoutSeqAtSave = s.layoutSeq;   // layout 专属 savePoint
    const loadSeq = s.loadSeq;             // 语境戳：重载后丢弃本次结果
    savingRef.current = true; setSaving(true);
    let committed = false;                  // 本次是否成功落库（决定是否 trailing）
    try {
      const r = await putJSON<ResumeRecord>(`/api/resumes/${id}`, {
        version: s.version,
        fields: ["data", "jd", "role", "title", "source_text", "layout_settings"],
        data: s.resume, jd: s.jd, role: s.role, title: s.title,
        source_text: s.sourceText, layout_settings: s.layoutSettings,
        note: "自动保存",
      });
      const cur = useStore.getState();
      if (cur.resumeId === id && cur.loadSeq === loadSeq) {
        cur.markSaved({ seq, version: r.version, title: r.title,
          layoutSettings: r.layout_settings ?? null, layoutSeqAtSave });
        committed = true; retryCountRef.current = 0;   // 成功：重置失败计数
      }
      // 语境已换（重载/切简历）：丢弃结果，不 markSaved，不 trailing
    } catch (e) {
      const cur = useStore.getState();
      if (!(cur.resumeId === id && cur.loadSeq === loadSeq)) {
        // 语境已换：与本组件无关，不处理
      } else if ((e as ApiErr)?.code === "VERSION_CONFLICT") {
        cur.setConflict();
      } else {
        // 仅对「可重试」错误（网络/429/5xx）做指数退避重试，且限次数、组件仍挂载；
        // 确定性 400（如结构非法）不重试——重试也不会变好，留 dirty 待用户改后再存。
        const retryable = !(e instanceof ApiErr) || e.retryable;
        if (mountedRef.current && retryable && retryCountRef.current < MAX_RETRIES) {
          clearRetry();
          const delay = RETRY_MS * 2 ** retryCountRef.current;   // 4s → 8s → 16s → 32s
          retryCountRef.current += 1;
          retryTimerRef.current = window.setTimeout(() => { retryTimerRef.current = null; void runRef.current(); }, delay);
        }
      }
    } finally {
      savingRef.current = false; setSaving(false);
      // 仅在「本次已成功落库」且期间有更新编辑时才 trailing——否则失败会自触发无退避死循环。
      const s2 = useStore.getState();
      if (committed && s2.editSeq > s2.savedSeq && !s2.conflict && s2.resumeId === id && s2.loadSeq === loadSeq) {
        void run();                        // trailing：在途期间的新编辑
      }
    }
  };
  const runRef = useRef(run); runRef.current = run;

  useEffect(() => {
    mountedRef.current = true;
    const unsub = useStore.subscribe((st, prev) => {
      if (st.editSeq !== prev.editSeq) {
        retryCountRef.current = 0;         // 有新编辑：重置失败退避（新内容值得重新尝试）
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void runRef.current(), DEBOUNCE);
      }
    });
    return () => {
      mountedRef.current = false;
      unsub(); if (timerRef.current) window.clearTimeout(timerRef.current); clearRetry();
    };
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
