// 年月选择器（组件库组件）：shadcn Popover + shadcn 风格「年份步进 + 12 宫格月份」网格。
// 存储始终 `YYYY-MM`；旧值非 YYYY-MM 且非空时回退为可编辑文本框（§3.5 不静默丢值）。
// 简历为年月粒度，故不引 react-day-picker（日粒度库，用不上）；网格自持，吃 Geist token。
import { useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const parse = (v?: string) => {
  const m = v?.match(/^(\d{4})-(\d{2})$/);
  return m ? { y: +m[1], mo: +m[2] } : null;
};
// 触发器显示用紧凑格式「YYYY.MM」（存储仍为 YYYY-MM）：条目卡「时间」行两枚并排 + 至今勾选，
// 「YYYY年MM月」在 440px 左栏下放不下（差 ~8px），紧凑格式余量充足且与简历排版口径一致
const label = (v?: string) => {
  const p = parse(v);
  return p ? `${p.y}.${String(p.mo).padStart(2, "0")}` : v ?? "";
};

/** 12 宫格月份网格 + 年份步进。受控：value=`YYYY-MM`，选中即回调并请求关闭。 */
export function MonthPickerPanel({ value, onPick }: { value?: string; onPick: (v: string) => void }) {
  const sel = parse(value);
  const [year, setYear] = useState(() => sel?.y ?? new Date().getFullYear());
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  // 方向键在 12 格间移动焦点（每行 3 列，Emil：键盘可达）
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const n = i + d;
    if (n >= 0 && n < 12) btns.current[n]?.focus();
  };
  return (
    <div className="w-month-picker p-3">
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" aria-label="上一年" onClick={() => setYear((y) => y - 1)}
          className="h-11 w-11 px-0 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-button-14 tabular-nums text-foreground">{year}年</div>
        <Button type="button" variant="ghost" aria-label="下一年" onClick={() => setYear((y) => y + 1)}
          className="h-11 w-11 px-0 text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 12 }, (_, k) => {
          const mo = k + 1;
          const active = !!sel && sel.y === year && sel.mo === mo;
          return (
            <Button key={mo} type="button" ref={(el) => (btns.current[k] = el)}
              variant={active ? "primary" : "ghost"}
              aria-label={`${year}年${mo}月`} aria-pressed={active} onKeyDown={onKey(k)}
              onClick={() => onPick(`${year}-${String(mo).padStart(2, "0")}`)}
              className={cn(
                "h-11 px-2 text-copy-13 tabular-nums",
                active
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "text-foreground hover:bg-accent",
              )}>
              {mo}月
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** 年月选择器：借位 shadcn Popover，触发器为无边框字段单元（嵌在 Field/MonthRange 内）。 */
export function MonthPicker({ value, onChange, placeholder, ariaLabel }: {
  value?: string; onChange: (v: string) => void; placeholder: string; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const legacy = useMemo(() => !!value && !MONTH.test(value), [value]); // 旧自由文本 → 文本框回退
  if (legacy) {
    return (
      <Input type="text" value={value ?? ""} placeholder={placeholder} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-0 border-0 bg-transparent px-0 py-2 focus-visible:ring-0 focus-visible:ring-offset-0" />
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* 触发器不自带焦点环：本组件恒嵌在带边框的字段行内，环由容器 has-[:focus-visible]:ring 统一提供（避免双环） */}
        <Button type="button" variant="ghost" aria-label={ariaLabel}
          className="min-h-0 w-full justify-start gap-1 rounded-sm bg-transparent px-0 py-2 text-left text-copy-14 active:scale-100">
          <span className={cn("min-w-0 flex-1 truncate tabular-nums", value ? "text-foreground" : "text-muted-foreground")}>
            {value ? label(value) : placeholder}
          </span>
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <MonthPickerPanel value={value} onPick={(v) => { onChange(v); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
}
