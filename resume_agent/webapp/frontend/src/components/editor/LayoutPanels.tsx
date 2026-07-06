// 排版模式面板（原 ExportView 左右栏拆迁）：左「模板」库 / 右「样式」控制器。
// 样式参数写 store.layoutSettings（随 autosave 持久化）；前后端均 clamp/白名单（防注入）。
import { useStore } from "@/store/useStore";
import { TEMPLATES, THEME_COLORS } from "@/lib/templates";
import { cn } from "@/lib/cn";
import { Printer, Monitor, Smartphone } from "lucide-react";

/** 左栏 · 模板库 */
export function TemplatesPanel() {
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => setLayout({ templateId: t.id })}
            className={cn("w-full rounded-[8px] border p-3 text-left transition",
              layout.templateId === t.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground")}>
            <div className="text-button-14">{t.name}</div>
            <div className="text-label-12 text-muted-foreground">{t.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 右栏 · 样式控制器 + 多端预览 + 导出 */
export function StylePanel({ device, setDevice, onExport }: {
  device: "desktop" | "mobile";
  setDevice: (d: "desktop" | "mobile") => void;
  onExport: () => void;
}) {
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3.5">
      <div className="mb-4 flex gap-2">
        {([["desktop", "桌面", Monitor], ["mobile", "手机", Smartphone]] as const).map(([d, lbl, Icon]) => (
          <button key={d} aria-pressed={device === d} onClick={() => setDevice(d)}
            className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-copy-14",
              device === d ? "bg-primary text-primary-foreground" : "border border-border text-foreground")}>
            <Icon className="h-4 w-4" /> {lbl}
          </button>
        ))}
      </div>

      <label className="block text-copy-14 text-foreground">主题色</label>
      <div className="mb-4 mt-2 flex gap-2">
        {THEME_COLORS.map((c) => (
          <button key={c.id} aria-label={`主题色 ${c.id}`} onClick={() => setLayout({ themeColor: c.id })}
            className={cn("h-7 w-7 rounded-full border-2",
              layout.themeColor === c.id ? "border-foreground" : "border-transparent")}
            style={{ background: c.hex }} />
        ))}
      </div>

      <label htmlFor="st-fs" className="block text-copy-14 text-foreground">
        字号 · {layout.fontScale.toFixed(2)}×
      </label>
      <input id="st-fs" type="range" min={0.85} max={1.25} step={0.05} value={layout.fontScale}
        onChange={(e) => setLayout({ fontScale: parseFloat(e.target.value) })}
        className="mb-4 mt-2 w-full accent-primary" />

      <label htmlFor="st-lh" className="block text-copy-14 text-foreground">
        行距 · {layout.lineHeight.toFixed(2)}
      </label>
      <input id="st-lh" type="range" min={1.2} max={2.0} step={0.05} value={layout.lineHeight}
        onChange={(e) => setLayout({ lineHeight: parseFloat(e.target.value) })}
        className="mb-5 mt-2 w-full accent-primary" />

      <button onClick={onExport}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary text-copy-14 text-primary-foreground">
        <Printer className="h-4 w-4" /> 导出 PDF
      </button>
      <p className="mt-2 text-label-12 text-muted-foreground">在打印对话框选「另存为 PDF」。样式随简历自动保存。</p>
    </div>
  );
}
