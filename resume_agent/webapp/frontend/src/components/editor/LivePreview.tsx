// 中栏 · 实时 A4 预览：随 store.resume 防抖(~150ms)重渲，纸张按栏宽 zoom 自适应。
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";

export function LivePreview() {
  const resume = useStore((s) => s.resume);
  const [doc, setDoc] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const name = useMemo(() => resume?.basics?.name || "简历", [resume]);

  // ~150ms 防抖足以平滑逐键重排；不用 rAF——后台标签页会挂起 rAF，导致预览停更
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDoc(resume ? markdownToDoc(resumeToMarkdown(resume, "zh"), name) : "");
    }, 150);
    return () => window.clearTimeout(id);
  }, [resume, name]);

  const fit = () => {
    const idoc = iframeRef.current?.contentDocument;
    const wrap = wrapRef.current;
    if (!idoc?.documentElement || !wrap) return;
    const scale = Math.max(0.35, Math.min(1, (wrap.clientWidth - 40) / 794));
    idoc.documentElement.style.setProperty("--fit", String(scale));
  };
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <span>Preview</span><span className="normal-case tracking-normal">A4 · 实时</span>
      </div>
      <iframe ref={iframeRef} title="简历实时预览" sandbox="allow-same-origin"
        srcDoc={doc} onLoad={fit} className="min-h-0 flex-1 border-0 bg-[#f5f5f4]" />
    </div>
  );
}
