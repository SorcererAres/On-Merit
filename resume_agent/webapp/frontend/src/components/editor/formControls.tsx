// 编辑表单 v3 可复用控件（分节手风琴 / 年月区间 / 标签输入 / 计数文本域 / 条目卡 / 字段行）。
// 描述字段本期用计数 Textarea（富文本留 E3）。样式取既有 token。
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  ChevronDown, Trash2, Plus, Calendar, X,
  Bold, Italic, List, ListOrdered, Sparkles,
} from "lucide-react";

/** 分节手风琴：标题 + 可收起 ^；右侧插槽放「移除模块」等 */
export function AccordionSection({ title, children, right, id }: {
  title: string; children: React.ReactNode; right?: React.ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="border-b border-border px-5 py-4">
      <div className="flex items-center">
        <h3 className="text-[16px] leading-6 font-semibold text-foreground">{title}</h3>
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

/** 字段行：左标签 + 右控件，错误态红框红字（label 带 * 表必填） */
export function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className={cn("flex items-center rounded-[8px] border px-3",
        error ? "border-destructive" : "border-border")}>
        <label className="w-20 shrink-0 py-2.5 text-[14px] text-muted-foreground">
          {label}{required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {error && <p className="mt-1 pl-3 text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

/** 裸输入（嵌在 Field 内，无边框，边框由 Field 提供） */
export function BareInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("w-full bg-transparent py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none", p.className)} />;
}
export function BareSelect(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...p} className={cn("w-full appearance-none bg-transparent py-2.5 pr-6 text-[14px] text-foreground focus:outline-none", p.className)} />
      <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** 年月区间：开始/结束 month + 结束「至今」。旧值非 YYYY-MM 时回退文本框（可见可改，不丢值）。 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
function MonthInput({ value, onChange, placeholder }: {
  value?: string; onChange: (v: string) => void; placeholder: string;
}) {
  const legacy = !!value && !MONTH.test(value);   // 旧自由文本 → 文本框回退
  return (
    <div className="flex items-center gap-1">
      <input type={legacy ? "text" : "month"} value={value ?? ""} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-0" />
      <Calendar className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
export function MonthRange({ label, start, end, onStart, onEnd, error }: {
  label: string; start?: string; end?: string;
  onStart: (v: string) => void; onEnd: (v: string) => void; error?: string;
}) {
  const present = end === "至今";
  return (
    <div>
      <div className={cn("flex items-center rounded-[8px] border px-3", error ? "border-destructive" : "border-border")}>
        <label className="w-20 shrink-0 text-[14px] text-muted-foreground">{label}</label>
        <div className="flex min-w-0 flex-1 items-center">
          <div className="min-w-0 flex-1"><MonthInput value={start} onChange={onStart} placeholder="开始月份" /></div>
          <span className="px-2 text-muted-foreground">–</span>
          <div className="min-w-0 flex-1">
            {present
              ? <div className="flex items-center py-2.5 text-[14px] text-foreground">至今</div>
              : <MonthInput value={end} onChange={onEnd} placeholder="结束月份" />}
          </div>
          <label className="ml-2 flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={present}
              onChange={(e) => onEnd(e.target.checked ? "至今" : "")} />
            至今
          </label>
        </div>
      </div>
      {error && <p className="mt-1 pl-3 text-[12px] text-destructive">{error}</p>}
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
    <div className="flex items-center rounded-[8px] border border-border px-3">
      <label className="w-20 shrink-0 py-2.5 text-[14px] text-muted-foreground">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1.5">
        {tags.map((t, i) => (
          <span key={i} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[12px] text-foreground">
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
            className="min-w-[80px] flex-1 bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none" />
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
    <div className="rounded-[8px] border border-border p-3">
      <textarea value={v} placeholder={placeholder} rows={4} onFocus={onFocus}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none" />
      <div className="mt-1 text-right text-[12px] text-muted-foreground">{v.length}/{max}</div>
    </div>
  );
}

/** 迷你富文本（E3 降级方案：Textarea + 工具栏插 md 标记，中栏预览实时渲染）。
 * 存储即 md 字面（与渲染 resumeBodyMd 读 description 为 md 一致），零序列化风险。
 * 工具栏对选中文本包裹加粗/斜体标记、行首插列表符；AI 润色/生成为占位（E4/E5 接线）。 */
export function RichTextarea({ value, onChange, placeholder, max = 1000, onFocus, onPolish, onGenerate }: {
  value?: string; onChange: (v: string) => void; placeholder: string; max?: number;
  onFocus?: () => void; onPolish?: () => void; onGenerate?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const v = value ?? "";
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
  const AiChip = ({ label, on }: { label: string; on?: () => void }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={on} disabled={!on}
      title={on ? label : `${label}（即将上线）`}
      className={cn("flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px]",
        on ? "text-green-800 hover:opacity-80" : "text-green-800/50 cursor-default")}
      style={{ background: "var(--green-100)" }}>
      <Sparkles className="h-3.5 w-3.5" /> {label}
    </button>
  );
  return (
    <div className="rounded-[8px] border border-border">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <TBtn label="加粗" on={() => wrap("**")}><Bold className="h-4 w-4" /></TBtn>
        <TBtn label="斜体" on={() => wrap("*")}><Italic className="h-4 w-4" /></TBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <TBtn label="无序列表" on={() => prefixLines(false)}><List className="h-4 w-4" /></TBtn>
        <TBtn label="有序列表" on={() => prefixLines(true)}><ListOrdered className="h-4 w-4" /></TBtn>
        <div className="ml-auto flex items-center gap-1.5">
          <AiChip label="AI 润色" on={onPolish} />
          <AiChip label="AI 生成" on={onGenerate} />
        </div>
      </div>
      <div className="p-3">
        <textarea ref={ref} value={v} placeholder={placeholder} rows={4} onFocus={onFocus}
          onChange={(e) => onChange(e.target.value.slice(0, max))}
          className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none" />
        <div className="mt-1 text-right text-[12px] text-muted-foreground">{v.length}/{max}</div>
      </div>
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
        <span className="truncate text-[14px] font-medium text-foreground">{title}</span>
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
      className="flex items-center gap-1.5 text-[14px] font-medium"
      style={{ color: "var(--green-700)" }}>
      <Plus className="h-4 w-4" /> {label}
    </button>
  );
}
