// 模板 / 页面布局面板：模板库、分页与间距、模块排序删除、视觉样式与导出。
// 样式参数写 store.layoutSettings（随 autosave 持久化）；前后端均 clamp/白名单（防注入）。
import { useState } from "react";
import { useStore } from "@/store/useStore";
import { TEMPLATES, THEME_COLORS } from "@/lib/templates";
import { resumeBodyEditSections } from "@/lib/resumeToMarkdown";
import { MODULE_LABEL } from "./ExtraModules";
import { cn } from "@/lib/cn";
import { confirmDialog } from "@/components/confirm";
import type { Resume } from "@/types";
import {
  Printer, Monitor, Smartphone, GripVertical, ChevronUp, ChevronDown,
  Trash2, Files, File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";

const ARRAY_MODULES: Record<string, keyof Resume> = {
  exp: "work", intern: "internships", proj: "projects", org: "organizations",
  volunteer: "volunteer", campus: "campus", thesis: "thesis", comp: "competitions",
  awards: "awards", edu: "education", certs: "certificates",
};

function withoutModule(resume: Resume, key: string, orderedKeys: string[]): Resume {
  const next = structuredClone(resume);
  const property = ARRAY_MODULES[key];
  if (property) delete next[property];
  else if (key === "intent") delete next.job_intent;
  else if (key === "summary") {
    if (next.basics) delete next.basics.summary;
  } else if (key === "metrics") {
    if (next.meta) delete next.meta.metrics;
  } else if (key === "skills") {
    delete next.skills; delete next.skills_md;
  } else if (key.startsWith("custom:")) {
    const removedIndex = Number(key.slice("custom:".length));
    next.custom_sections = (next.custom_sections || []).filter((_, index) => index !== removedIndex);
    if (!next.custom_sections.length) delete next.custom_sections;
  }

  const removedCustomIndex = key.startsWith("custom:") ? Number(key.slice("custom:".length)) : -1;
  next.modules_order = orderedKeys.filter((item) => item !== key).map((item) => {
    if (removedCustomIndex < 0 || !item.startsWith("custom:")) return item;
    const index = Number(item.slice("custom:".length));
    return index > removedCustomIndex ? `custom:${index - 1}` : item;
  });
  return next;
}

/** 左栏 · 模板库 */
export function TemplatesPanel() {
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {TEMPLATES.map((t) => (
          <Button key={t.id} variant="ghost" aria-pressed={layout.templateId === t.id}
            onClick={() => setLayout({ templateId: t.id, ...(t.defaultTheme ? { themeColor: t.defaultTheme } : {}) })}
            className={cn("h-auto w-full justify-start rounded-md border p-3 text-left active:scale-100",
              layout.templateId === t.id
                ? "border-primary bg-accent"
                : "border-border bg-background hover:bg-accent")}>
            <span>
              <span className="block text-button-14">{t.name}</span>
              <span className="block text-label-12 text-muted-foreground">{t.hint}</span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 左栏 · 排版：模板库（间距与模块管理已拆去「编辑布局」视图）。 */
export function PageLayoutPanel() {
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <section className="overflow-hidden rounded-md border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-heading-14 text-foreground">简历模板</h3>
        </div>
        <div className="space-y-2 p-2">
          {TEMPLATES.map((template) => (
            <Button key={template.id} type="button" variant="ghost"
              aria-pressed={layout.templateId === template.id}
              onClick={() => setLayout({
                templateId: template.id,
                ...(template.defaultTheme ? { themeColor: template.defaultTheme } : {}),
              })}
              className={cn("h-auto w-full justify-start rounded-md border p-3 text-left active:scale-100",
                layout.templateId === template.id
                  ? "border-primary bg-accent"
                  : "border-border bg-background hover:bg-accent")}>
              <span>
                <span className="block text-button-14">{template.name}</span>
                <span className="block text-label-12 text-muted-foreground">{template.hint}</span>
              </span>
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 左栏 · 编辑布局：分页、垂直节奏与模块顺序（由标题栏「页面布局」按钮进入）。 */
export function EditLayoutPanel() {
  const resume = useStore((s) => s.resume);
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);
  const editResume = useStore((s) => s.editResumeFromPreview);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const sections = resume ? resumeBodyEditSections(resume) : [];
  const orderedKeys = sections.map((section) => section.key);

  const applyOrder = (keys: string[]) => {
    if (resume) editResume({ ...resume, modules_order: keys });
  };
  const moveModule = (key: string, target: string) => {
    const from = orderedKeys.indexOf(key);
    const to = orderedKeys.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...orderedKeys];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyOrder(next);
  };
  const stepModule = (key: string, direction: -1 | 1) => {
    const index = orderedKeys.indexOf(key);
    const target = orderedKeys[index + direction];
    if (target) moveModule(key, target);
  };
  const removeModule = async (key: string, title: string) => {
    if (!resume || !(await confirmDialog({
      title: `删除“${title}”模块？`,
      description: "该模块及其中的全部内容都会被删除，可通过撤销恢复。",
      confirmText: "删除模块", destructive: true,
    }))) return;
    editResume(withoutModule(resume, key, orderedKeys));
  };

  // 已启用但未填写的扩展模块：空节不进正文列表（resumeBodyEditSections 过滤），
  // 而表单侧不再放删除按钮（删除统一收口在这里），故单独列出供删除
  const EXTRA_EMPTY_FIELDS = ["job_intent", "internships", "organizations", "awards",
    "volunteer", "campus", "thesis", "competitions", "certificates"];
  const bodyFieldSet = new Set(orderedKeys.map((key) => ARRAY_MODULES[key] ?? (key === "intent" ? "job_intent" : key)));
  const emptyModules: { field: string; label: string }[] = resume
    ? EXTRA_EMPTY_FIELDS
        .filter((f) => (resume as Record<string, unknown>)[f] !== undefined && !bodyFieldSet.has(f as keyof Resume))
        .map((f) => ({ field: f, label: MODULE_LABEL[f] ?? f }))
    : [];
  const emptyCustomCount = ((resume?.custom_sections ?? []) as { title?: string; content?: string }[])
    .filter((cs) => !cs.title?.trim() && !cs.content?.trim()).length;
  if (emptyCustomCount > 0) emptyModules.push({ field: "custom_sections", label: "自定义模块" });
  const removeEmptyModule = async (field: string, label: string) => {
    if (!resume || !(await confirmDialog({
      title: `移除「${label}」？`, description: "该模块尚未填写内容，可随时重新添加。", confirmText: "移除",
    }))) return;
    const next = structuredClone(resume) as Record<string, unknown>;
    if (field === "custom_sections") {
      const rest = (next.custom_sections as { title?: string; content?: string }[])
        .filter((cs) => cs.title?.trim() || cs.content?.trim());
      if (rest.length) next.custom_sections = rest; else delete next.custom_sections;
    } else delete next[field];
    editResume(next as Resume);
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <section className="overflow-hidden rounded-md border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-heading-14 text-foreground">间距</h3>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 text-copy-13 text-muted-foreground">分页方式</div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="分页方式">
              <Button type="button" variant={layout.pageMode === "auto" ? "primary" : "secondary"}
                aria-pressed={layout.pageMode === "auto"} onClick={() => setLayout({ pageMode: "auto" })}>
                <Files className="h-4 w-4" />自动分页
              </Button>
              <Button type="button" variant={layout.pageMode === "single" ? "primary" : "secondary"}
                aria-pressed={layout.pageMode === "single"} onClick={() => setLayout({ pageMode: "single" })}>
                <File className="h-4 w-4" />一页模式
              </Button>
            </div>
            {layout.pageMode === "single" && (
              <p className="mt-2 text-label-12 text-muted-foreground">超出一页的内容会被裁切，请结合中间预览调整。</p>
            )}
          </div>

          <div>
            <label htmlFor="layout-line-height" className="flex justify-between text-copy-13 text-foreground">
              <span>行高</span><span className="tabular-nums text-muted-foreground">{layout.lineHeight.toFixed(2)}</span>
            </label>
            <Slider id="layout-line-height" min={1.2} max={2} step={0.05} value={[layout.lineHeight]}
              onValueChange={([value]) => setLayout({ lineHeight: value })} className="mt-1" />
          </div>

          <div>
            <label htmlFor="layout-module-spacing" className="flex justify-between text-copy-13 text-foreground">
              <span>模块间距</span><span className="tabular-nums text-muted-foreground">{layout.moduleSpacing}px</span>
            </label>
            <Slider id="layout-module-spacing" min={12} max={36} step={1} value={[layout.moduleSpacing]}
              onValueChange={([value]) => setLayout({ moduleSpacing: value })} className="mt-1" />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-heading-14 text-foreground">模块管理</h3>
          <p className="mt-0.5 text-label-12 text-muted-foreground">拖动或使用箭头调整顺序。</p>
        </div>
        <div className="p-2">
          <div className="flex min-h-11 items-center gap-2 rounded-sm px-2 text-copy-14 text-muted-foreground">
            <GripVertical className="h-4 w-4 opacity-40" aria-hidden />
            <span className="flex-1">基本信息</span>
            <span className="text-label-12">固定</span>
          </div>
          {sections.map((section, index) => (
            <div key={section.key} draggable
              onDragStart={(event) => { setDraggingKey(section.key); event.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDraggingKey(null)}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingKey) moveModule(draggingKey, section.key);
                setDraggingKey(null);
              }}
              className={cn("group flex min-h-11 items-center gap-1 rounded-sm px-2",
                draggingKey === section.key ? "bg-accent opacity-60" : "hover:bg-accent")}>
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-copy-14 text-foreground">{section.title}</span>
              <Button type="button" variant="ghost" aria-label={`${section.title}上移`}
                disabled={index === 0} onClick={() => stepModule(section.key, -1)} className="w-11 px-0">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" aria-label={`${section.title}下移`}
                disabled={index === sections.length - 1} onClick={() => stepModule(section.key, 1)} className="w-11 px-0">
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" aria-label={`删除${section.title}模块`}
                onClick={() => void removeModule(section.key, section.title)}
                className="w-11 px-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {emptyModules.map(({ field, label }) => (
            <div key={field} className="group flex min-h-11 items-center gap-1 rounded-sm px-2 hover:bg-accent">
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground opacity-40" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-copy-14 text-muted-foreground">{label}</span>
              <span className="text-label-12 text-muted-foreground">未填写</span>
              <Button type="button" variant="ghost" aria-label={`删除${label}模块`}
                onClick={() => void removeEmptyModule(field, label)}
                className="w-11 px-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {sections.length === 0 && emptyModules.length === 0 && (
            <p className="px-2 py-4 text-center text-copy-13 text-muted-foreground">填写内容后，可在这里管理模块。</p>
          )}
        </div>
      </section>
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
      <Tabs value={device} onValueChange={(value) => setDevice(value as "desktop" | "mobile")} className="mb-4">
        <TabsList className="w-full">
          <TabsTrigger value="desktop" className="flex-1 gap-2"><Monitor className="h-4 w-4" />桌面</TabsTrigger>
          <TabsTrigger value="mobile" className="flex-1 gap-2"><Smartphone className="h-4 w-4" />手机</TabsTrigger>
        </TabsList>
      </Tabs>

      <label className="block text-copy-14 text-foreground">主题色</label>
      <div className="mb-4 mt-2 flex gap-2">
        {THEME_COLORS.map((c) => (
          <Button key={c.id} type="button" variant="ghost" aria-label={`主题色 ${c.id}`}
            aria-pressed={layout.themeColor === c.id} onClick={() => setLayout({ themeColor: c.id })}
            className={cn("h-11 w-11 rounded-full border-2 p-2 active:scale-100",
              layout.themeColor === c.id ? "border-foreground" : "border-transparent")}>
            <span className="h-6 w-6 rounded-full" style={{ backgroundColor: c.hex }} />
          </Button>
        ))}
      </div>

      <label htmlFor="st-fs" className="block text-copy-14 text-foreground">
        字号 · {layout.fontScale.toFixed(2)}×
      </label>
      <Slider id="st-fs" min={0.85} max={1.25} step={0.05} value={[layout.fontScale]}
        onValueChange={([value]) => setLayout({ fontScale: value })} className="mb-4 mt-2" />

      <Button onClick={onExport} className="w-full">
        <Printer className="h-4 w-4" /> 导出 PDF
      </Button>
      <p className="mt-2 text-label-12 text-muted-foreground">在打印对话框选「另存为 PDF」。样式随简历自动保存。</p>
    </div>
  );
}
