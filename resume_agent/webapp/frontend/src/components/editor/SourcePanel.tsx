// 左栏 · 原件（source_text 只读）+ 近似定位高亮。
// 规则（见 wizard-flow-v2 §三）：最小长度 ≥8、在原文中**唯一精确出现**才高亮，否则不高亮
// （歧义/多命中/未命中一律不高亮，避免误导）；无 source_text 则显示占位。
import { useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";

const MIN_LEN = 8;

function locate(source: string, query: string): [number, number] | null {
  const q = (query || "").trim();
  if (q.length < MIN_LEN) return null;
  const first = source.indexOf(q);
  if (first === -1) return null;
  if (source.indexOf(q, first + 1) !== -1) return null;  // 多命中（歧义）→ 不高亮
  return [first, first + q.length];
}

export function SourcePanel() {
  const sourceText = useStore((s) => s.sourceText);
  const linkQuery = useStore((s) => s.linkQuery);
  const markRef = useRef<HTMLElement>(null);

  const span = sourceText ? locate(sourceText, linkQuery ?? "") : null;
  useEffect(() => { markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [linkQuery, span?.[0]]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <span>原件</span><span className="normal-case tracking-normal">文本层 · 近似定位</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4 text-copy-13 leading-relaxed text-foreground">
        {!sourceText && <span className="text-muted-foreground">无原文层（粘贴导入或无文本层的扫描件不提供原件对照）。</span>}
        {sourceText && !span && sourceText}
        {sourceText && span && (
          <>
            {sourceText.slice(0, span[0])}
            <mark ref={markRef} className="rounded px-0.5 text-foreground"
              style={{ background: "color-mix(in oklab, var(--primary) 22%, transparent)" }}>
              {sourceText.slice(span[0], span[1])}
            </mark>
            {sourceText.slice(span[1])}
          </>
        )}
      </div>
    </div>
  );
}
