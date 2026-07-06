// 编辑表单 v3 可复用控件（分节手风琴 / 年月区间 / 标签输入 / 计数文本域 / 条目卡 / 字段行）。
// 描述字段本期用计数 Textarea（富文本留 E3）。样式取既有 token。
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { postJSON } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MonthPicker } from "@/components/ui/month-picker";
import { toast } from "sonner";
import {
  ChevronDown, Trash2, Plus, X,
  Bold, Italic, List, ListOrdered, Sparkles, Loader2,
} from "lucide-react";

/** 分节手风琴：标题 + 可收起 ^；右侧插槽放「移除模块」等 */
export function AccordionSection({ title, children, right, id }: {
  title: string; children: React.ReactNode; right?: React.ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="border-b border-border px-5 py-4">
      <div className="flex items-center">
        <h3 className="text-heading-16 text-foreground">{title}</h3>
        <div className="ml-auto flex items-center gap-2">
          {right}
          <button aria-label={open ? "收起" : "展开"} onClick={() => setOpen(!open)}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-4 w-4 transition", open ? "" : "-rotate-90")} />
          </button>
        </div>
      </div>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}

/** 容器级焦点环：裸控件 outline-none 压掉了全局 :focus-visible，环改画在拥有边框的行容器上
 * （has-[:focus-visible] 仅键盘可见性聚焦时亮，规格同 ui/Input 的两层环）。 */
const FOCUS_RING = "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background";

/** 字段行：左标签 + 右控件，错误态红框红字（label 带 * 表必填） */
export function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className={cn("flex min-h-[40px] items-center rounded-[8px] border px-3", FOCUS_RING,
        error ? "border-destructive" : "border-border")}>
        <label className="w-20 shrink-0 py-2 text-copy-14 text-muted-foreground">
          {label}{required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {error && <p className="mt-1 pl-3 text-label-12 text-destructive">{error}</p>}
    </div>
  );
}

/** 裸输入（嵌在 Field 内，无边框，边框由 Field 提供）。下拉一律用 ui/select（shadcn）。 */
export function BareInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("w-full bg-transparent py-2 text-copy-14 text-foreground placeholder:text-muted-foreground focus:outline-none", p.className)} />;
}

/** 年月区间：开始/结束用组件库 MonthPicker + 结束「至今」勾选（勾选存字面「至今」，渲染照旧）。 */
export function MonthRange({ label, start, end, onStart, onEnd, error }: {
  label: string; start?: string; end?: string;
  onStart: (v: string) => void; onEnd: (v: string) => void; error?: string;
}) {
  const present = end === "至今";
  return (
    <div>
      <div className={cn("flex min-h-[40px] items-center rounded-[8px] border px-3", FOCUS_RING, error ? "border-destructive" : "border-border")}>
        <label className="w-20 shrink-0 text-copy-14 text-muted-foreground">{label}</label>
        <div className="flex min-w-0 flex-1 items-center">
          <div className="min-w-0 flex-1"><MonthPicker value={start} onChange={onStart} placeholder="开始月份" ariaLabel={`${label}开始月份`} /></div>
          <span className="px-2 text-muted-foreground">–</span>
          <div className="min-w-0 flex-1">
            {present
              ? <div className="flex items-center py-2 text-copy-14 text-foreground">至今</div>
              : <MonthPicker value={end} onChange={onEnd} placeholder="结束月份" ariaLabel={`${label}结束月份`} />}
          </div>
          <label className="ml-2 flex shrink-0 items-center gap-1 text-label-12 text-muted-foreground">
            <Checkbox className="h-3.5 w-3.5" checked={present}
              onChange={(e) => onEnd(e.target.checked ? "至今" : "")} />
            至今
          </label>
        </div>
      </div>
      {error && <p className="mt-1 pl-3 text-label-12 text-destructive">{error}</p>}
    </div>
  );
}

/** 标签输入：回车/逗号添加 chip，退格删末枚 */
export function TagInput({ label, tags, onChange, max = 8, maxLen = 20, placeholder }: {
  label: string; tags: string[]; onChange: (t: string[]) => void;
  max?: number; maxLen?: number; placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, maxLen);
    if (v && tags.length < max && !tags.includes(v)) onChange([...tags, v]);
    setDraft("");
  };
  return (
    <div className={cn("flex min-h-[40px] items-center rounded-[8px] border border-border px-3", FOCUS_RING)}>
      <label className="w-20 shrink-0 py-2 text-copy-14 text-muted-foreground">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1">
        {tags.map((t, i) => (
          <span key={i} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-label-12 text-foreground">
            {t}
            <button aria-label={`删除标签 ${t}`} onClick={() => onChange(tags.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {tags.length < max && (
          <input value={draft} placeholder={tags.length ? "" : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
              else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
            }}
            onBlur={add}
            className="min-w-[80px] flex-1 bg-transparent py-1 text-copy-14 text-foreground placeholder:text-muted-foreground focus:outline-none" />
        )}
      </div>
    </div>
  );
}

/** 计数文本域（富文本留 E3）：右下角 N/上限 */
export function CountedTextarea({ value, onChange, placeholder, max = 1000, onFocus }: {
  value?: string; onChange: (v: string) => void; placeholder: string; max?: number;
  onFocus?: () => void;
}) {
  const v = value ?? "";
  return (
    <div className={cn("rounded-[8px] border border-border p-3", FOCUS_RING)}>
      <textarea value={v} placeholder={placeholder} rows={4} onFocus={onFocus}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        className="w-full resize-none bg-transparent text-copy-14 text-foreground placeholder:text-muted-foreground focus:outline-none" />
      <div className="mt-1 text-right text-label-12 text-muted-foreground">{v.length}/{max}</div>
    </div>
  );
}

let _genNoticeShown = false;   // 「AI 生成」一次性说明（会话级）

// new_terms 高亮：把润色后文本中「疑似新出现」的片段标黄（提示核实，不改内容）
function highlightNewTerms(text: string, terms: string[]) {
  if (!terms.length) return text;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!esc.length) return text;
  const re = new RegExp(`(${esc.join("|")})`, "g");
  return text.split(re).map((seg, i) =>
    terms.includes(seg)
      ? <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5">{seg}</mark>
      : <span key={i}>{seg}</span>);
}

/** 迷你富文本（E3：Textarea + 工具栏插 md 标记，中栏预览实时渲染）+ E4 字段级 AI 润色。
 * 存储即 md 字面（零序列化风险）。polishKind 提供时「AI 润色」启用：调 /api/polish-field →
 * 原文/润色后对照弹窗（new_terms 高亮）→ 采纳/放弃；语境戳（resumeId+loadSeq+发起时字段值）
 * 变化则拒绝写入（防过期覆盖）。「AI 生成」留 E5。 */
export function RichTextarea({ value, onChange, placeholder, max = 1000, onFocus, polishKind, genContext }: {
  value?: string; onChange: (v: string) => void; placeholder: string; max?: number;
  onFocus?: () => void; polishKind?: string;
  genContext?: string;   // 该条目已填结构化字段（公司/岗位/项目名…），生成时作定位线索（§4.9）
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const v = value ?? "";
  const [polishing, setPolishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ md: string; new_terms: string[] } | null>(null);
  const [genResult, setGenResult] = useState<{ md: string; mode: "extract" | "template" } | null>(null);
  // 润色/生成各自独立语境戳——共用一个 ref 会在并发（润色飞行中点生成）时被覆盖，导致过期结果绕过校验
  const polishStamp = useRef<{ id: string | null; load: number; val: string } | null>(null);
  const genStamp = useRef<{ id: string | null; load: number; val: string } | null>(null);

  const doPolish = async () => {
    if (v.trim().length < 10 || polishing) return;
    const s = useStore.getState();
    polishStamp.current = { id: s.resumeId, load: s.loadSeq, val: v };
    setPolishing(true);
    try {
      const r = await postJSON<{ md: string; new_terms: string[] }>("/api/polish-field",
        { text: v, kind: polishKind, jd: s.jd?.trim() ? s.jd : undefined });
      setResult(r);
    } catch (e) {
      toast.error((e as Error).message || "润色失败，请重试");
    } finally { setPolishing(false); }
  };
  const adopt = () => {
    const s = useStore.getState();
    const st = polishStamp.current;
    if (!st || s.resumeId !== st.id || s.loadSeq !== st.load || v !== st.val) {
      toast.message("字段在润色期间已变化，请重新润色"); setResult(null); return;
    }
    onChange(result!.md.slice(0, max));
    toast.success("已采纳润色（按仅重述规则生成，请核实）");
    setResult(null);
  };
  const doGenerate = async () => {
    if (generating) return;
    const s = useStore.getState();
    genStamp.current = { id: s.resumeId, load: s.loadSeq, val: v };
    setGenerating(true);
    try {
      const r = await postJSON<{ md: string; mode: "extract" | "template" }>("/api/generate-field",
        { kind: polishKind, source_text: s.sourceText || undefined, entry_context: genContext?.trim() || undefined });
      if (!_genNoticeShown) { _genNoticeShown = true; toast.message("AI 生成只做「原件提取」或「结构模板」，不会替你编造经历"); }
      setGenResult(r);
    } catch (e) {
      toast.error((e as Error).message || "生成失败，请重试");
    } finally { setGenerating(false); }
  };
  const adoptGen = () => {
    const s = useStore.getState();
    const st = genStamp.current;
    if (!st || s.resumeId !== st.id || s.loadSeq !== st.load || v !== st.val) {
      toast.message("字段已变化，请重新生成"); setGenResult(null); return;
    }
    onChange(genResult!.md.slice(0, max));
    toast.success(genResult!.mode === "template" ? "已插入结构模板，请填入你的真实经历" : "已插入原件提取内容，请核实");
    setGenResult(null);
  };
  // 工具栏改 value 后（受控重渲）恢复光标/选区
  useLayoutEffect(() => {
    if (pendingSel.current && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(pendingSel.current[0], pendingSel.current[1]);
      pendingSel.current = null;
    }
  });
  const apply = (fn: (t: string, s: number, e: number) => { text: string; sel: [number, number] }) => {
    const ta = ref.current; if (!ta) return;
    const { text, sel } = fn(v, ta.selectionStart, ta.selectionEnd);
    pendingSel.current = [Math.min(sel[0], max), Math.min(sel[1], max)];
    onChange(text.slice(0, max));
  };
  const wrap = (mark: string) => apply((t, s, e) => {
    const sel = t.slice(s, e) || "文本";
    return { text: t.slice(0, s) + mark + sel + mark + t.slice(e),
      sel: [s + mark.length, s + mark.length + sel.length] };
  });
  const prefixLines = (ordered: boolean) => apply((t, s, e) => {
    const ls = t.lastIndexOf("\n", s - 1) + 1;
    const le = t.indexOf("\n", e); const end = le < 0 ? t.length : le;
    const lines = t.slice(ls, end).split("\n").map((ln, i) => (ordered ? `${i + 1}. ` : "- ") + ln);
    const nb = lines.join("\n");
    return { text: t.slice(0, ls) + nb + t.slice(end), sel: [ls, ls + nb.length] };
  });
  const TBtn = ({ label, on, children }: { label: string; on: () => void; children: React.ReactNode }) => (
    <button type="button" aria-label={label} title={label}
      onMouseDown={(e) => e.preventDefault()} onClick={on}
      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
  const polishReady = !!polishKind && v.trim().length >= 10;
  const AiChip = ({ label, on, enabled, busy }: { label: string; on?: () => void; enabled?: boolean; busy?: boolean }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={on} disabled={!enabled || busy}
      title={enabled ? label : (polishKind ? `${label}（至少填 10 字）` : `${label}（即将上线）`)}
      className={cn("flex h-7 items-center gap-1 rounded-full px-2.5 text-copy-13",
        enabled && !busy ? "text-green-800 hover:opacity-80" : "text-green-800/50 cursor-default")}
      style={{ background: "var(--green-100)" }}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {label}
    </button>
  );
  return (
    <div className={cn("rounded-[8px] border border-border", FOCUS_RING)}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <TBtn label="加粗" on={() => wrap("**")}><Bold className="h-4 w-4" /></TBtn>
        <TBtn label="斜体" on={() => wrap("*")}><Italic className="h-4 w-4" /></TBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <TBtn label="无序列表" on={() => prefixLines(false)}><List className="h-4 w-4" /></TBtn>
        <TBtn label="有序列表" on={() => prefixLines(true)}><ListOrdered className="h-4 w-4" /></TBtn>
        <div className="ml-auto flex items-center gap-1.5">
          <AiChip label="AI 润色" on={doPolish} enabled={polishReady} busy={polishing} />
          <AiChip label="AI 生成" on={doGenerate} enabled={!!polishKind} busy={generating} />
        </div>
      </div>
      <div className="p-3">
        <textarea ref={ref} value={v} placeholder={placeholder} rows={4} onFocus={onFocus}
          onChange={(e) => onChange(e.target.value.slice(0, max))}
          className="w-full resize-none bg-transparent text-copy-14 text-foreground placeholder:text-muted-foreground focus:outline-none" />
        <div className="mt-1 text-right text-label-12 text-muted-foreground">{v.length}/{max}</div>
      </div>

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setResult(null); }}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-heading-20">AI 润色 · 逐条核实</h3>
              <button aria-label="关闭" onClick={() => setResult(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-label-12 text-muted-foreground">按「仅重述已有事实」规则生成，未新增数字（确定性校验）；但文本性新表述仍需你核实，请对照原文。</p>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto">
              <div>
                <div className="mb-1 text-label-12 text-muted-foreground">原文</div>
                <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-copy-13 text-muted-foreground">{v}</div>
              </div>
              <div>
                <div className="mb-1 text-label-12 text-muted-foreground">润色后{result.new_terms.length > 0 && <span className="ml-1 text-amber-700">· 黄底为新出现表述，请核实</span>}</div>
                <div className="whitespace-pre-wrap rounded-lg border border-border p-3 text-copy-13 text-foreground">{highlightNewTerms(result.md, result.new_terms)}</div>
              </div>
            </div>
            {result.new_terms.length > 0 && (
              <div className="mt-2 shrink-0 text-label-12 text-amber-700">
                新出现的表述：{result.new_terms.join("、")} —— 若非你的真实经历，请勿采纳。
              </div>
            )}
            <div className="mt-4 flex shrink-0 justify-end gap-2">
              <Button variant="secondary" onClick={() => setResult(null)}>放弃</Button>
              <Button onClick={adopt}>采纳</Button>
            </div>
          </div>
        </div>
      )}

      {genResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setGenResult(null); }}>
          <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-heading-20">AI 生成 · {genResult.mode === "extract" ? "原件提取" : "结构模板"}</h3>
              <button aria-label="关闭" onClick={() => setGenResult(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-label-12 text-muted-foreground">
              {genResult.mode === "extract"
                ? "以下内容抽取自你导入的原件（逐句核对出处），请再次核实无误后采纳。"
                : "这是一份结构模板，不含任何具体事实——采纳后请把方括号占位替换为你的真实经历。"}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border p-3 text-copy-13 text-foreground">
              {genResult.md}
            </div>
            {v.trim() && (
              <div className="mt-2 shrink-0 text-label-12 text-amber-700">当前字段已有内容，采纳将替换它。</div>
            )}
            <div className="mt-4 flex shrink-0 justify-end gap-2">
              <Button variant="secondary" onClick={() => setGenResult(null)}>放弃</Button>
              <Button onClick={adoptGen}>采纳</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 条目卡：头部主字段摘要 + 🗑 删除 */
export function ItemCard({ title, onDelete, children }: {
  title: string; onDelete: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="mb-2 flex items-center">
        <span className="truncate text-button-14 text-foreground">{title}</span>
        <button aria-label="删除该条" onClick={onDelete}
          className="ml-auto flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** 绿色「⊕ 新增 XX」 */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-button-14"
      style={{ color: "var(--green-700)" }}>
      <Plus className="h-4 w-4" /> {label}
    </button>
  );
}
