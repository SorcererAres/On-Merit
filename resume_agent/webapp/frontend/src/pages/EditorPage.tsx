// 文档外壳 · v3（按 Figma All-IN-AI 835:164 重构）：全局顶栏 + 三栏工作台，三级导航。
// - 外壳唯一负责 loadRecord/useAutoSave(id)/409/离开守卫（useBlocker 同 pathname 放行，仅切 ?mode 不拦）。
// - 诊断模式：左「编辑简历」(SectionEditor) | 中 A4 预览（预览/原件 tab + AI 润色）| 右「诊断/AI 润色」。
// - 模板模式：左「模板」| 中 A4 预览 | 右「样式」；布局模式：左「布局」| 中预览 | 右「页面样式」。
// - 「优化」并入「AI 润色」按钮（右栏切 polish 面板）；undo/redo 为防抖分组快照栈（上限 50）。
// - 旧链接 ?step=optimize→诊断、?step=export→排版。
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useBlocker, useSearchParams } from "react-router-dom";
import { getJSON, postJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord, Snapshot } from "@/store/useStore";
import { SectionEditor } from "@/components/editor/SectionEditor";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import { DiagnosePanel } from "@/components/editor/DiagnosePanel";
import { validateResumeForm } from "@/lib/validateResumeForm";
import type { FormIssue } from "@/lib/validateResumeForm";
import { PolishPanel } from "@/components/editor/PolishPanel";
import { PageLayoutPanel, StylePanel } from "@/components/editor/LayoutPanels";
import { ImportDialog } from "@/components/editor/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Diagnosis } from "@/store/useStore";
import {
  ArrowLeft, PanelLeftOpen, PanelRightOpen, MoreHorizontal,
  Upload, Download, History, FileClock, ChevronLeft,
  FileText, Sparkles, Undo2, Redo2, RefreshCw, CircleAlert, TriangleAlert, ChevronRight,
} from "lucide-react";

type Mode = "diagnose" | "layout";
type RightView = "diagnose" | "polish";
type PreflightAction = "diagnose" | "export";
interface RevisionMeta { id: string; note: string; created_at: string }
interface ReportMeta {
  id: string; role: string; role_label: string;
  score: number; max_score: number; has_jd: boolean; created_at: string;
}
interface ReportFull extends ReportMeta { report: Diagnosis }

const UNDO_LIMIT = 50;
const SNAP_DEBOUNCE = 600;
const MOBILE_QUERY = "(max-width: 960px)";
const RIGHT_DRAWER_QUERY = "(max-width: 1199px)";

/** 面板标题栏（左右栏共用）：44px，标题 14px 中黑 + 右侧图标组 */
function PanelBar({ title, children, reserveClose = false }: {
  title: string; children?: React.ReactNode; reserveClose?: boolean;
}) {
  return (
    <div className={cn("flex h-11 shrink-0 items-center border-b border-border pl-4",
      reserveClose ? "pr-14" : "pr-4")}>
      <span className="text-heading-14 text-foreground">{title}</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}
const IconBtn = forwardRef<HTMLButtonElement, {
  children: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; className?: string;
}>(function IconBtn({ children, label, onClick, disabled, className }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled}
          ref={ref}
          className={cn("h-11 w-11 px-0 text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground", className)}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
});

export function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  // 模式：?mode=，兼容旧 ?step=（optimize→diagnose、export→layout）
  const raw = sp.get("mode") ?? sp.get("step");
  const mode: Mode = raw === "layout" || raw === "template" || raw === "export" ? "layout" : "diagnose";

  const {
    title, resumeId, dirty, conflict, hydrationKey, resume,
    loadRecord, setTitle, restoreSnapshot,
  } = useStore();
  const { saving, saveNow, saveError, retrying } = useAutoSave(id);

  // 宽屏固定三栏；中屏保留编辑 + 预览，右栏进 Sheet；手机左右栏都进 Sheet。
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches);
  const [rightDrawer, setRightDrawer] = useState(() => typeof window !== "undefined" && window.matchMedia(RIGHT_DRAWER_QUERY).matches);
  const [rightView, setRightView] = useState<RightView>("diagnose");
  const [checkOpen, setCheckOpen] = useState(false);
  const [preflightAction, setPreflightAction] = useState<PreflightAction | null>(null);
  const preflightResolve = useRef<((proceed: boolean) => void) | null>(null);

  useEffect(() => {
    const mobileMedia = window.matchMedia(MOBILE_QUERY);
    const drawerMedia = window.matchMedia(RIGHT_DRAWER_QUERY);
    const update = () => {
      setMobile(mobileMedia.matches);
      setRightDrawer(drawerMedia.matches);
      if (!mobileMedia.matches) setLeftOpen(false);
      if (!drawerMedia.matches) setRightOpen(false);
    };
    update();
    mobileMedia.addEventListener("change", update);
    drawerMedia.addEventListener("change", update);
    return () => {
      mobileMedia.removeEventListener("change", update);
      drawerMedia.removeEventListener("change", update);
    };
  }, []);
  const openLeft = () => {
    if (mobile) setLeftOpen(true);
  };
  const setMode = (nextMode: Mode) => {
    if (nextMode === mode) return;
    setSp({ mode: nextMode }, { replace: true });
    if (nextMode === "diagnose") setRightView("diagnose");
  };

  const issues = validateResumeForm(resume);
  const finishPreflight = (proceed = false) => {
    const resolve = preflightResolve.current;
    preflightResolve.current = null;
    setPreflightAction(null);
    setCheckOpen(false);
    resolve?.(proceed);
  };
  const requestPreflight = (action: PreflightAction): Promise<boolean> => {
    if (!validateResumeForm(useStore.getState().resume).length) return Promise.resolve(true);
    preflightResolve.current?.(false);
    return new Promise((resolve) => {
      preflightResolve.current = resolve;
      setPreflightAction(action);
      setCheckOpen(true);
    });
  };
  // 点问题 → 切回编辑模式、展开对应分节、展示字段错误并聚焦到具体控件。
  const focusIssue = (issue: FormIssue) => {
    finishPreflight(false);
    setRightOpen(false);
    if (mode !== "diagnose") setMode("diagnose");
    openLeft();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let attempts = 0;
    const locate = () => {
      attempts += 1;
      const field = Array.from(document.querySelectorAll<HTMLElement>("[data-field-path]"))
        .find((el) => el.dataset.fieldPath === issue.path);
      if (field) {
        window.dispatchEvent(new CustomEvent("resume:focus-issue", { detail: { path: issue.path } }));
        field.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
        requestAnimationFrame(() => {
          field.querySelector<HTMLElement>("input, textarea, button, [tabindex]:not([tabindex='-1'])")
            ?.focus({ preventScroll: true });
        });
        return;
      }
      const section = document.getElementById(`sec-${issue.sectionKey}`)
        || document.getElementById(`mod-${issue.sectionKey}`)
        || document.querySelector<HTMLElement>('[id^="mod-custom-"]');
      const toggle = section?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      toggle?.click();
      if (attempts < 16) requestAnimationFrame(locate);
      else section?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    };
    requestAnimationFrame(locate);
  };
  const download = async () => {
    if (await requestPreflight("export")) printRef.current();
  };
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [importOpen, setImportOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionMeta[] | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reports, setReports] = useState<ReportMeta[] | null>(null);
  const [reportView, setReportView] = useState<ReportFull | null>(null);   // 打开的单条报告快照
  const printRef = useRef<() => void>(() => {});
  const printApi = useCallback((fn: () => void) => { printRef.current = fn; }, []);

  // ---- 载入 ----
  useEffect(() => {
    let alive = true;
    getJSON<ResumeRecord>(`/api/resumes/${id}`)
      .then((rec) => { if (alive) loadRecord(rec); })
      .catch((e) => { if (alive) { toast.error(e.message || "简历不存在"); nav("/"); } });  // 卸载后不再导航
    return () => { alive = false; };
  }, [id]);

  // ---- undo/redo：防抖分组快照栈 ----
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const lastSnap = useRef<Snapshot | null>(null);          // 当前已入账状态
  const suppressSnap = useRef(false);                      // 恢复期间跳过采集
  const snapTimer = useRef<number | null>(null);
  const [, forceHist] = useState(0);                       // 仅驱动按钮禁用态刷新
  const takeSnap = (): Snapshot => {
    const s = useStore.getState();
    return {
      resume: s.resume ? structuredClone(s.resume) : null,
      title: s.title, jd: s.jd, role: s.role, layoutSettings: { ...s.layoutSettings },
      sourceText: s.sourceText, warnings: [...s.warnings], usedOcr: s.usedOcr,
    };
  };
  // 把 pending 分组立即入账（undo/redo 前必须调用——否则防抖窗口内的编辑会被跳过且无法重做）
  const commitGroup = () => {
    if (lastSnap.current) {
      undoStack.current.push(lastSnap.current);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    }
    lastSnap.current = takeSnap();
    redoStack.current = [];
    forceHist((n) => n + 1);
  };
  const flushPending = () => {
    if (snapTimer.current == null) return;
    window.clearTimeout(snapTimer.current); snapTimer.current = null;
    commitGroup();
  };
  useEffect(() => {
    const unsub = useStore.subscribe((st, prev) => {
      if (st.loadSeq !== prev.loadSeq) {                   // 载入/回滚：清栈、以载入态为基线
        if (snapTimer.current) { window.clearTimeout(snapTimer.current); snapTimer.current = null; }  // 旧 pending 作废
        undoStack.current = []; redoStack.current = []; lastSnap.current = takeSnap();
        forceHist((n) => n + 1);
        return;
      }
      if (st.editSeq === prev.editSeq) return;
      if (suppressSnap.current) { suppressSnap.current = false; return; }
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        snapTimer.current = null;                          // 先置空：pending/已结算的判定依据
        commitGroup();
      }, SNAP_DEBOUNCE);
    });
    return () => { unsub(); if (snapTimer.current) window.clearTimeout(snapTimer.current); };
  }, []);
  const undo = () => {
    flushPending();                                        // 防抖窗口内的编辑先入账，undo 才回到它的上一态
    const prev = undoStack.current.pop();
    if (!prev) return;
    if (lastSnap.current) redoStack.current.push(lastSnap.current);
    lastSnap.current = prev;
    suppressSnap.current = true;
    restoreSnapshot(prev);
    forceHist((n) => n + 1);
  };
  const redo = () => {
    flushPending();                                        // 有 pending 新编辑 ⇒ 入账并清 redo（新分支覆盖旧未来）
    const next = redoStack.current.pop();
    if (!next) return;
    if (lastSnap.current) undoStack.current.push(lastSnap.current);
    lastSnap.current = next;
    suppressSnap.current = true;
    restoreSnapshot(next);
    forceHist((n) => n + 1);
  };
  const undoRef = useRef(undo); undoRef.current = undo;
  const redoRef = useRef(redo); redoRef.current = redo;
  const canUndo = snapTimer.current !== null || undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const manualSave = async () => {
    const current = useStore.getState();
    if (current.conflict) { toast.error("请先处理版本冲突"); return; }
    if (!current.dirty) { toast.message("所有修改均已保存"); return; }
    const ok = await saveNow();
    if (ok) toast.success("已保存");
    else if (!useStore.getState().conflict) toast.error("保存未成功，请检查网络后重试");
  };
  const manualSaveRef = useRef(manualSave); manualSaveRef.current = manualSave;

  // ---- 守卫 ----
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (dirty || conflict) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    (async () => {
      if (useStore.getState().conflict) {
        if (await confirmDialog({
          title: "存在未解决的版本冲突", description: "离开将丢弃你的本地改动。确定离开？",
          confirmText: "丢弃并离开", destructive: true,
        })) blocker.proceed();
        else blocker.reset();
        return;
      }
      if (await confirmDialog({
        title: "有未保存的修改", description: "可以保存后离开，或留在本页继续编辑。",
        confirmText: "保存后离开", cancelText: "留在本页",
      })) {
        const ok = await saveNow();
        if (ok) blocker.proceed();
        else { toast.error("保存未成功，已留在本页"); blocker.reset(); }
      } else blocker.reset();
    })();
  }, [blocker.state]);

  // ---- 409 双选项 ----
  const reload = async () => {
    const rec = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    loadRecord(rec); toast.message("已加载最新版本");
  };
  const overrideMine = async () => {
    const latest = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    useStore.setState({ version: latest.version, conflict: false });
    const ok = await saveNow();
    if (ok) toast.success("已用你的版本覆盖"); else toast.error("覆盖保存失败，请重试");
  };

  // ---- 键盘：保存、文档级撤销/重做；输入框内仍交给浏览器做文本级撤销 ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (!e.repeat) void manualSaveRef.current();
        return;
      }
      const t = e.target as HTMLElement;
      const editing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (editing) return;
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redoRef.current(); else undoRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // ---- 诊断报告记录（只读历史快照；不做任何跨报告对比/涨分展示）----
  const openReports = async () => {
    setReportsOpen(true); setReports(null); setReportView(null);
    try { setReports((await getJSON<{ reports: ReportMeta[] }>(`/api/resumes/${id}/reports`)).reports); }
    catch (e) { toast.error((e as Error).message); setReportsOpen(false); }
  };
  const openReport = async (reportId: string) => {
    try { setReportView(await getJSON<ReportFull>(`/api/resumes/${id}/reports/${reportId}`)); }
    catch (e) { toast.error((e as Error).message); }
  };

  // ---- 历史版本 ----
  const openHistory = async () => {
    setHistOpen(true); setRevisions(null);
    try { setRevisions((await getJSON<{ revisions: RevisionMeta[] }>(`/api/resumes/${id}/revisions`)).revisions); }
    catch (e) { toast.error((e as Error).message); setHistOpen(false); }
  };
  const rollback = async (revisionId: string) => {
    if (!(await confirmDialog({
      title: "回滚到该版本？", description: "当前内容会先自动快照，可再回滚回来。",
      confirmText: "回滚",
    }))) return;
    if (useStore.getState().dirty) {
      const ok = await saveNow();
      if (!ok) return toast.error("本地修改保存失败，已取消回滚");
    }
    try {
      const rec = await postJSON<ResumeRecord>(`/api/resumes/${id}/rollback`,
        { revisionId, version: useStore.getState().version });
      loadRecord(rec); setHistOpen(false); toast.success("已回滚");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast.error(err.code === "VERSION_CONFLICT" ? "已在别处被修改，请先处理冲突" : (err.message || "回滚失败"));
    }
  };

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  const shortcutKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const status = conflict ? "冲突"
    : saving ? "保存中…"
      : retrying ? "等待重试"
        : saveError ? "保存失败"
          : dirty ? "未保存" : "已自动保存";

  const modeTabs = (
    <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="w-full md:w-auto">
      <TabsList className="!h-8 !min-h-8 w-full gap-1 !rounded-header border border-editor-switch-border bg-editor-switch p-0.5 md:w-auto">
        <TabsTrigger value="diagnose"
          className="!h-7 !min-h-7 flex-1 !rounded-header px-4 py-1.5 !text-button-12 data-[state=active]:border data-[state=active]:border-background data-[state=active]:shadow-none md:flex-none">
          编辑
        </TabsTrigger>
        <TabsTrigger value="layout"
          className="!h-7 !min-h-7 flex-1 !rounded-header px-4 py-1.5 !text-button-12 data-[state=active]:border data-[state=active]:border-background data-[state=active]:shadow-none md:flex-none">
          排版
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const leftTitle = mode === "layout" ? "排版" : "简历内容";

  const leftPanel = (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PanelBar title={leftTitle} reserveClose={mobile} />
      {mode === "layout"
        ? <PageLayoutPanel />
        : <div key={hydrationKey} className="min-h-0 flex-1 overflow-y-auto"><SectionEditor /></div>}
    </div>
  );

  const rightPanel = (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {mode === "layout" ? (
        <PanelBar title="页面样式" reserveClose={rightDrawer} />
      ) : (
        <div className={cn("flex h-11 shrink-0 items-center border-b border-border pl-2",
          rightDrawer ? "pr-14" : "pr-2")}>
          <Tabs value={rightView} onValueChange={(value) => setRightView(value as RightView)} className="min-w-0 flex-1">
            <TabsList className="w-full bg-muted">
              <TabsTrigger value="diagnose" className="flex-1 gap-2">
                <FileText className="h-4 w-4" />AI 诊断
              </TabsTrigger>
              <TabsTrigger value="polish" className="flex-1 gap-2">
                <Sparkles className="h-4 w-4" />AI 润色
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      {mode === "layout"
        ? <StylePanel device={device} setDevice={setDevice} onExport={download} />
        : rightView === "polish" ? <PolishPanel /> : <DiagnosePanel onBeforeRun={() => requestPreflight("diagnose")} />}
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="anim-in flex h-dvh flex-col bg-background">
        <header className="shrink-0 border-b border-editor-header-border bg-background md:h-app-header">
          <div className="relative flex h-app-header items-center md:h-full">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
              <Button type="button" variant="ghost" aria-label="返回简历列表" onClick={() => nav("/")}
                className="relative !h-8 !min-h-8 w-4 shrink-0 !rounded-header p-0 text-editor-title after:absolute after:-inset-x-2 after:-inset-y-1.5 active:scale-100">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="flex min-w-0 flex-1 items-center lg:flex-none">
                <Input aria-label="简历名称" value={title} size={Math.min(24, Math.max(5, (title || "未命名简历").length + 2))}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="未命名简历" autoComplete="off" spellCheck={false}
                  className="!h-8 !min-h-8 !w-auto min-w-0 max-w-xs truncate border-0 bg-transparent px-0 py-0 !text-heading-16 !text-editor-title shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
              </span>
              <span role="status" aria-live="polite" title={saveError ?? undefined}
                className={cn("hidden whitespace-nowrap text-label-12 text-editor-muted sm:block",
                  (conflict || saveError) && "text-destructive")}>
                {status}
              </span>
            </div>

            <div className="pointer-events-none absolute inset-x-0 hidden h-full items-center justify-center md:flex">
              <div className="pointer-events-auto">{modeTabs}</div>
            </div>

            <div className="ml-auto flex shrink-0 items-center justify-end gap-2 px-4">
              {mobile && (
                <IconBtn label={mode === "layout" ? "打开排版设置" : "打开简历编辑"} onClick={() => setLeftOpen(true)}>
                  <PanelLeftOpen className="h-4 w-4" />
                </IconBtn>
              )}
              {rightDrawer && (
                <IconBtn label={mode !== "diagnose" ? "打开页面样式" : "打开 AI 助手"} onClick={() => setRightOpen(true)}>
                  <PanelRightOpen className="h-4 w-4" />
                </IconBtn>
              )}

              {issues.length > 0 && (
                <Popover open={checkOpen} onOpenChange={(open) => {
                  if (open) { setPreflightAction(null); setCheckOpen(true); }
                  else finishPreflight(false);
                }}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" aria-label={`待完善 ${issues.length} 项`}
                      className="relative !h-8 !min-h-8 gap-1 !rounded-header px-0 text-amber-700 after:absolute after:-inset-y-1.5 hover:text-amber-800 active:scale-100 dark:text-amber-400 dark:hover:text-amber-300">
                      <TriangleAlert className="h-4 w-4" aria-hidden />
                      <span className="hidden text-copy-14 sm:inline">待完善{issues.length}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={8}
                    className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden">
                    <div className="px-4 pb-3 pt-4">
                      <div className="flex items-start gap-2.5">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        <div>
                          <h2 className="text-heading-14 text-foreground">
                            {preflightAction === "export"
                              ? `导出前还有 ${issues.length} 项待完善`
                              : preflightAction === "diagnose"
                                ? `诊断前还有 ${issues.length} 项待完善`
                                : `简历还有 ${issues.length} 项待完善`}
                          </h2>
                          <p className="mt-1 text-copy-13 text-muted-foreground">
                            {preflightAction === "export"
                              ? "继续导出可能出现空内容。"
                              : preflightAction === "diagnose"
                                ? "缺失内容可能影响诊断结果的准确性。"
                                : "补全后，诊断和导出结果会更完整。"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto border-y border-border px-2 py-1">
                      {issues.slice(0, 8).map((issue) => (
                        <Button key={issue.path} type="button" variant="ghost" onClick={() => focusIssue(issue)}
                          className="h-auto min-h-11 w-full justify-start gap-2 rounded-sm px-2 py-2 text-left active:scale-100">
                          <span className="min-w-0 flex-1 text-copy-13 text-foreground">{issue.msg}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Button>
                      ))}
                      {issues.length > 8 && (
                        <p className="px-2 py-2 text-label-12 text-muted-foreground">另有 {issues.length - 8} 项待完善</p>
                      )}
                    </div>
                    <div className="flex gap-2 p-3">
                      {preflightAction && (
                        <Button type="button" variant="secondary" onClick={() => finishPreflight(true)} className="flex-1">
                          仍然{preflightAction === "export" ? "导出" : "诊断"}
                        </Button>
                      )}
                      <Button type="button" onClick={() => focusIssue(issues[0])} className="flex-1">
                        去填写
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              <ThemeToggle className="relative after:absolute after:-inset-y-1.5" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" className="relative !h-8 !min-h-8 w-8 shrink-0 !rounded-header px-0 after:absolute after:-inset-y-1.5 active:scale-100" aria-label="更多操作">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setImportOpen(true)}><Upload />导入简历</DropdownMenuItem>
                  <DropdownMenuItem onSelect={download}><Download />下载简历</DropdownMenuItem>
                  <DropdownMenuItem onSelect={openHistory}><History />历史版本</DropdownMenuItem>
                  <DropdownMenuItem onSelect={openReports}><FileClock />诊断记录</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={!canUndo} onSelect={undo}>
                    <Undo2 />撤销<DropdownMenuShortcut>{shortcutKey}Z</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canRedo} onSelect={redo}>
                    <Redo2 />重做<DropdownMenuShortcut>⇧{shortcutKey}Z</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button type="button" variant="secondary"
                className="hidden !h-8 !min-h-8 shrink-0 !gap-1 !rounded-header border-gray-100 pl-2.5 pr-3 text-copy-14 active:scale-100 lg:inline-flex"
                aria-label="下载简历" onClick={download}>
                <Download className="h-4 w-4" /><span>下载</span>
              </Button>
              <Button type="button" className="hidden !h-8 !min-h-8 shrink-0 !gap-1 !rounded-header pl-2.5 pr-3 text-copy-14 active:scale-100 lg:inline-flex"
                aria-label="导入简历" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /><span>导入</span>
              </Button>
            </div>
          </div>
          <div className="border-t border-editor-header-border px-4 py-2 md:hidden">{modeTabs}</div>
        </header>

      {conflict && (
        <Alert tone="red" className="mx-4 mt-3 shrink-0">
          <b>这份简历已在别处被修改</b>，你的自动保存被拒。请选择：
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={reload}>重新加载（丢弃本地改动）</Button>
            <Button variant="danger" onClick={overrideMine}>用我的覆盖</Button>
          </div>
        </Alert>
      )}

      {saveError && !retrying && !conflict && (
        <Alert tone="red" className="mx-4 mt-3 flex shrink-0 items-center gap-3" role="alert">
          <div className="flex-1"><b>自动保存失败。</b>{saveError}</div>
          <Button variant="secondary" disabled={saving} onClick={() => void manualSave()}>
            <RefreshCw className={cn("h-4 w-4", saving && "animate-spin")} />立即重试
          </Button>
        </Alert>
      )}

        {/* ===== 编辑 / 预览 / AI（或样式）：宽屏三栏可拖拽，中屏左栏+预览可拖拽，手机纯预览 ===== */}
        <div className="flex min-h-0 flex-1 isolate">
          {mobile ? (
            <PreviewCanvas device={device} showPolish={mode === "diagnose"}
              onImport={() => setImportOpen(true)} printApi={printApi} />
          ) : (
            <ResizablePanelGroup direction="horizontal" key={rightDrawer ? "2col" : "3col"}
              autoSaveId={rightDrawer ? "on-merit-editor-2col" : "on-merit-editor-3col"}
              className="min-h-0 flex-1">
              <ResizablePanel defaultSize={rightDrawer ? 32 : 28} minSize={22} maxSize={42}>
                <aside aria-label={mode === "layout" ? "排版面板" : "简历编辑面板"}
                  className="flex h-full min-h-0 w-full flex-col bg-background">
                  {leftPanel}
                </aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel minSize={30}>
                <div className="flex h-full min-h-0 w-full flex-col">
                  <PreviewCanvas device={device} showPolish={mode === "diagnose"}
                    onImport={() => setImportOpen(true)} printApi={printApi} />
                </div>
              </ResizablePanel>
              {!rightDrawer && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={25} minSize={18} maxSize={36}>
                    <aside aria-label={mode === "layout" ? "样式面板" : "AI 助手面板"}
                      className="flex h-full min-h-0 w-full flex-col bg-background">
                      {rightPanel}
                    </aside>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          )}
        </div>

        {mobile && (
          <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
            <SheetContent side="left" className="flex flex-col gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{leftTitle}</SheetTitle>
                <SheetDescription>
                  {mode === "layout" ? "选择模板并调整页面布局与模块顺序" : "编辑简历内容"}
                </SheetDescription>
              </SheetHeader>
              {leftPanel}
            </SheetContent>
          </Sheet>
        )}

        {rightDrawer && (
          <Sheet open={rightOpen} onOpenChange={setRightOpen}>
            <SheetContent side="right" className="flex flex-col gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{mode === "layout" ? "页面样式" : "AI 助手"}</SheetTitle>
                <SheetDescription>{mode === "layout" ? "调整简历页面样式" : "诊断与润色简历内容"}</SheetDescription>
              </SheetHeader>
              {rightPanel}
            </SheetContent>
          </Sheet>
        )}

        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

        <Dialog open={reportsOpen} onOpenChange={setReportsOpen}>
          <DialogContent className="flex max-h-dialog max-w-lg flex-col">
            <DialogHeader className="pr-10">
              <div className="flex items-center gap-1">
                {reportView && (
                  <Button variant="ghost" className="w-11 px-0" aria-label="返回报告列表" onClick={() => setReportView(null)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <DialogTitle>{reportView ? "诊断报告" : "诊断报告记录"}</DialogTitle>
              </div>
              <DialogDescription>报告基于生成当时的简历内容，仅用于回顾。</DialogDescription>
            </DialogHeader>

            {!reportView && (
              <>
                {reports === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
                {reports?.length === 0 && (
                  <p className="text-copy-14 text-muted-foreground">还没有诊断记录（右栏运行「诊断」后自动存档）。</p>
                )}
                <div className="min-h-0 overflow-y-auto">
                  {reports?.map((r) => (
                    <Button key={r.id} variant="ghost" onClick={() => openReport(r.id)}
                      className="h-auto w-full justify-start rounded-none border-b border-border px-0 py-3 text-left active:scale-100">
                      <div className="flex-1">
                        <div className="text-copy-14">
                          {r.role_label} · {r.score}/{r.max_score}
                          {r.has_jd && <span className="ml-2 text-label-12 text-muted-foreground">含 JD 覆盖度</span>}
                        </div>
                        <div className="text-label-12 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <span className="text-label-12 text-muted-foreground">查看</span>
                    </Button>
                  ))}
                </div>
                {(reports?.length ?? 0) > 0 && (
                  <p className="mt-3 shrink-0 text-label-12 text-muted-foreground">
                    各条报告基于当时的简历内容与模型输出，仅供回顾，不构成前后对比。
                  </p>
                )}
              </>
            )}

            {reportView && (
              <div className="min-h-0 overflow-y-auto">
                <Alert tone="amber" className="mb-3">
                  本报告生成于 {new Date(reportView.created_at).toLocaleString()}，基于<b>当时</b>的简历内容，
                  仅供回顾。想了解当前水平请重新诊断。
                </Alert>
                <ScoreCard data={reportView.report.evalResult} />
                {reportView.report.match && (
                  <div className="mt-3 border-t border-border pt-2">
                    <div className="text-label-13 text-muted-foreground">对目标 JD 的覆盖度（当时）</div>
                    <MatchReportView report={reportView.report.match} />
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={histOpen} onOpenChange={setHistOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader className="pr-10">
              <DialogTitle>历史版本</DialogTitle>
              <DialogDescription>内容变更时会自动创建快照，可回滚到任一历史版本。</DialogDescription>
            </DialogHeader>
            {revisions === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
            {revisions?.length === 0 && <p className="text-copy-14 text-muted-foreground">还没有历史版本（内容变更时自动快照）。</p>}
            <div className="max-h-dialog-list overflow-y-auto">
              {revisions?.map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-b border-border py-2.5">
                  <div className="flex-1">
                    <div className="text-copy-14">{r.note}</div>
                    <div className="text-label-12 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                  </div>
                  <Button variant="secondary" onClick={() => rollback(r.id)}>回滚到此版</Button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
