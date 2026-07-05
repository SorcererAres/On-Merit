// 编辑表单 v3 可复用控件（分节手风琴 / 年月区间 / 标签输入 / 计数文本域 / 条目卡 / 字段行）。
// 描述字段本期用计数 Textarea（富文本留 E3）。样式取既有 token。
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown, Trash2, Plus, Calendar, X } from "lucide-react";

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
