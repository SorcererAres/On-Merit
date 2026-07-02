// 设计稿 1:1 还原（Figma「All IN AI」node 835:164 ·「诊断」视图）。
// 静态展示页（/v3），未接线——用于对照验收新版编辑器视觉方案。
// 结构：全局顶栏 52px｜左「编辑简历」360px｜中 预览画布（A4 595×842）｜右「诊断」360px。
// 色值全部取自 tokens.css 既有 token（background/border/muted/primary/muted-foreground）。
import {
  ArrowLeft, PanelLeft, Columns2, PanelRight, Undo2, Redo2,
  Upload, Download, Save, Ellipsis, X, History, Eye,
} from "lucide-react";
import { cn } from "@/lib/cn";

/** 面板标题栏（左右面板共用）：44px，标题 14px 中黑，右侧图标组 */
function PanelBar({ title, icons }: { title: string; icons: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border pl-6 pr-4">
      <span className="text-[14px] leading-[22px] font-medium text-foreground">{title}</span>
      <div className="ml-auto flex items-center gap-1">{icons}</div>
    </div>
  );
}

/** 24×24 图标按钮（16px 图形，muted 色） */
function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}

const NAV_ITEMS = ["基本信息", "工作经历", "项目经历", "个人优势", "掌握技能"];

export function DiagnoseV3() {
  return (
    <div className="flex h-screen min-w-[1440px] flex-col bg-background">
      {/* ===== 全局顶栏 52px ===== */}
      <header className="relative flex h-[52px] shrink-0 items-center border-b border-border px-4">
        {/* 左：返回 + 文档名 + 保存状态 */}
        <div className="flex items-center gap-2">
          <button aria-label="返回" className="flex h-6 w-6 items-center justify-center text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-[16px] leading-6 font-semibold text-foreground">陈思远</span>
          <span className="text-[12px] leading-[17px] text-muted-foreground">已自动保存</span>
        </div>

        {/* 中：诊断/排版 分段控件（绝对居中） */}
        <div className="absolute left-1/2 top-1/2 flex h-8 w-[120px] -translate-x-1/2 -translate-y-1/2 items-center rounded-[8px] bg-muted p-[2px]">
          {(["诊断", "排版"] as const).map((t, i) => (
            <button key={t} aria-pressed={i === 0}
              className={cn("h-7 w-14 rounded-[6px] text-[12px] leading-4",
                i === 0 ? "bg-background text-foreground shadow-card" : "text-muted-foreground")}>
              {t}
            </button>
          ))}
        </div>

        {/* 右：面板开关 ×3 ｜ 撤销/重做 ｜ 导入 / 下载 / 保存 */}
        <div className="ml-auto flex items-center">
          <div className="flex items-center gap-1 px-1.5">
            <IconBtn label="收起左栏"><PanelLeft className="h-4 w-4 opacity-60" /></IconBtn>
            <IconBtn label="双栏布局"><Columns2 className="h-4 w-4" /></IconBtn>
            <IconBtn label="收起右栏"><PanelRight className="h-4 w-4 opacity-60" /></IconBtn>
          </div>
          <div className="ml-[14px] flex items-center gap-2">
            <button aria-label="撤销" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground">
              <Undo2 className="h-4 w-4" />
            </button>
            <button aria-label="重做" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground">
              <Redo2 className="h-4 w-4" />
            </button>
            <button className="flex h-8 w-[70px] items-center rounded-[8px] border border-border pl-2.5 text-[14px] text-foreground">
              <Upload className="h-4 w-4" /><span className="pl-1">导入</span>
            </button>
            <button className="flex h-8 w-[70px] items-center rounded-[8px] border border-border pl-2.5 text-[14px] text-foreground">
              <Download className="h-4 w-4" /><span className="pl-1">下载</span>
            </button>
            <button className="flex h-8 w-[70px] items-center rounded-[8px] bg-primary pl-2.5 text-[14px] text-primary-foreground">
              <Save className="h-4 w-4" /><span className="pl-1">保存</span>
            </button>
          </div>
        </div>
      </header>

      {/* ===== 内容三栏 ===== */}
      <div className="flex min-h-0 flex-1">
        {/* 左：编辑简历 */}
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background">
          <PanelBar title="编辑简历" icons={
            <>
              <IconBtn label="更多"><Ellipsis className="h-4 w-4" /></IconBtn>
              <IconBtn label="关闭"><X className="h-4 w-4" /></IconBtn>
            </>
          } />
          <nav>
            {NAV_ITEMS.map((it) => (
              <button key={it}
                className="flex h-11 w-full items-center px-6 text-left text-[14px] leading-[22px] text-foreground hover:bg-accent/40">
                {it}
              </button>
            ))}
          </nav>
        </aside>

        {/* 中：预览画布 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background pl-4 pr-4">
            <div className="flex items-center">
              <span className="flex h-6 w-6 items-center justify-center text-foreground"><Eye className="h-4 w-4" /></span>
              <span className="pl-1 text-[12px] leading-6 text-foreground">预览</span>
            </div>
            <button className="h-7 rounded-full border border-border px-[11px] text-[13px] leading-6 text-foreground">
              AI 润色
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted">
            {/* A4 595×842（100%），距标题栏 46px */}
            <div className="mx-auto mt-[46px] h-[842px] w-[595px] bg-white shadow-card" />
          </div>
        </main>

        {/* 右：诊断 */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-border bg-background">
          <PanelBar title="诊断" icons={
            <>
              <IconBtn label="历史"><History className="h-4 w-4" /></IconBtn>
              <IconBtn label="关闭"><X className="h-4 w-4" /></IconBtn>
            </>
          } />
          <div className="px-6 pt-3.5">
            <label className="block text-[14px] leading-[17px] text-foreground">岗位</label>
            <div className="mt-2 flex h-9 w-full items-center rounded-[8px] border border-border px-3 text-[14px] leading-[17px] text-foreground">
              产品/UX 设计师
            </div>

            <label className="mt-3.5 block text-[14px] leading-[17px] text-foreground">目标 JD</label>
            <textarea rows={4} placeholder="粘贴目标职位JD（可留空）⋯" aria-label="目标 JD"
              className="mt-2 h-24 w-full resize-none rounded-[8px] border border-border bg-background px-3 py-3 text-[14px] leading-[17px] text-foreground placeholder:text-muted-foreground focus:outline-none" />

            <button className="mt-4 h-9 w-full rounded-[8px] bg-primary text-[14px] leading-[17px] text-primary-foreground">
              诊断
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
