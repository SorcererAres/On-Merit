// 导出：thenextcv 式「左 Markdown 编辑器 / 右实时预览」。
// 预览是暖灰画布上的白色 A4 纸（自包含 HTML 文档，渲染进 sandbox iframe），一键打印/存 PDF。
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";
import { Printer, RotateCcw } from "lucide-react";

type Lang = "zh" | "en";

export function StepExport() {
  const { resume } = useStore();
  const [lang, setLang] = useState<Lang>("zh");
  const [md, setMd] = useState<string>(() => (resume ? resumeToMarkdown(resume, "zh") : ""));
  const [doc, setDoc] = useState<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const name = useMemo(() => (resume?.basics?.name as string) || "简历", [resume]);

  // 编辑 markdown -> 防抖生成纸张文档（marked 很快，防抖仅为避免逐键重置 iframe 抖动）
  useEffect(() => {
    const id = setTimeout(() => setDoc(markdownToDoc(md, name)), 220);
    return () => clearTimeout(id);
  }, [md, name]);

  // 自适应：把固定 A4（794px）等比缩放去适配预览栏宽（iframe 文档内 .page 用 --fit）
  const fitPreview = () => {
    const idoc = iframeRef.current?.contentDocument;
    const wrap = previewRef.current;
    if (!idoc?.documentElement || !wrap) return;
    const avail = wrap.clientWidth - 40; // 两侧留些灰边
    const scale = Math.max(0.4, Math.min(1, avail / 794));
    idoc.documentElement.style.setProperty("--fit", String(scale));
  };
  useEffect(() => {
    const wrap = previewRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitPreview());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const regenerate = () => { if (resume) setMd(resumeToMarkdown(resume, lang)); };

  const print = () => {
    const win = iframeRef.current?.contentWindow;
    const docu = iframeRef.current?.contentDocument;
    if (!win) return;
    const go = () => win.print();
    if (docu && (docu as any).fonts?.ready) (docu as any).fonts.ready.then(go).catch(go);
    else go();
  };

  const toolbar = "flex h-9 shrink-0 items-center justify-between border-b border-border px-4 text-xs font-medium uppercase tracking-widest text-muted-foreground";

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-heading-24 mb-1">导出</h2>
          <p className="text-copy-13 text-muted-foreground">
            左侧编辑 Markdown，右侧实时预览；「打印 / 存 PDF」直接输出干净纸张。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="模板语言">
            <option value="zh">中文</option><option value="en">English</option>
          </Select>
          <Button variant="secondary" onClick={regenerate} title="按所选语言从简历重新生成（会覆盖左侧编辑）">
            <RotateCcw size={16} /> 从简历重生成
          </Button>
          <Button onClick={print}><Printer size={16} /> 打印 / 存 PDF</Button>
        </div>
      </div>

      <div className="flex h-[78vh] flex-col overflow-hidden rounded-lg border border-border lg:flex-row">
        {/* 左：Markdown 编辑器 */}
        <div className="flex min-h-0 flex-col lg:w-[42%] lg:border-r lg:border-border">
          <div className={toolbar}>Markdown</div>
          <textarea
            value={md} onChange={(e) => setMd(e.target.value)} spellCheck={false}
            aria-label="简历 Markdown 源"
            className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none"
          />
        </div>
        {/* 右：纸张预览（画布 + 白纸在 iframe 内，自带打印样式） */}
        <div ref={previewRef} className="flex min-h-0 flex-1 flex-col border-t border-border lg:border-t-0">
          <div className={toolbar}>
            <span>Preview</span>
            <span className="normal-case tracking-normal text-muted-foreground">A4</span>
          </div>
          <iframe
            ref={iframeRef} title="简历预览" sandbox="allow-same-origin allow-modals"
            srcDoc={doc} onLoad={fitPreview} className="min-h-0 flex-1 border-0 bg-[#f5f5f4]"
          />
        </div>
      </div>
    </section>
  );
}
