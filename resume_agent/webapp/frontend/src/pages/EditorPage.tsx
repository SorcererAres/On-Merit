// 文档外壳 · v3（按 Figma All-IN-AI 835:164 重构）：全局顶栏 + 三栏工作台，双模式「诊断/排版」。
// - 外壳唯一负责 loadRecord/useAutoSave(id)/409/离开守卫（useBlocker 同 pathname 放行，仅切 ?mode 不拦）。
// - 诊断模式：左「编辑简历」(SectionEditor) | 中 A4 预览（预览/原件 tab + AI 润色）| 右「诊断/AI 润色」。
// - 排版模式：左「模板」| 中 A4 预览 | 右「样式」（多端 + 导出 PDF）。
// - 「优化」并入「AI 润色」按钮（右栏切 polish 面板）；undo/redo 为防抖分组快照栈（上限 50）。
// - 旧链接 ?step=optimize→诊断、?step=export→排版。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useBlocker, useSearchParams } from "react-router-dom";
import { getJSON, postJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord, Snapshot } from "@/store/useStore";
import { SectionEditor } from "@/components/editor/SectionEditor";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import { DiagnosePanel } from "@/components/editor/DiagnosePanel";
import { validateResumeForm } from "@/lib/validateResumeForm";
import { PolishPanel } from "@/components/editor/PolishPanel";
import { TemplatesPanel, StylePanel } from "@/components/editor/LayoutPanels";
import { ImportDialog } from "@/components/editor/ImportDialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import type { Diagnosis } from "@/store/useStore";
import {
  ArrowLeft, PanelLeft, Columns2, PanelRight,
  Upload, Download, Save, X, History, FileClock, Check, ChevronLeft,
  FileText, Sparkles,
} from "lucide-react";

type Mode = "diagnose" | "layout";
type RightView = "diagnose" | "polish";
interface RevisionMeta { id: string; note: string; created_at: string }
interface ReportMeta {
  id: string; role: string; role_label: string;
  score: number; max_score: number; has_jd: boolean; created_at: string;
}
interface ReportFull extends ReportMeta { report: Diagnosis }

const UNDO_LIMIT = 50;
const SNAP_DEBOUNCE = 600;

/** 面板标题栏（左右栏共用）：44px，标题 14px 中黑 + 右侧图标组 */
function PanelBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border pl-6 pr-4">
      <span className="text-[14px] leading-[22px] font-medium text-foreground">{title}</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}
function IconBtn({ children, label, onClick, disabled }: {
  children: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground">
      {children}
    </button>
  );
}

export function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  // 模式：?mode=，兼容旧 ?step=（optimize→diagnose、export→layout）
  const raw = sp.get("mode") ?? sp.get("step");
  const mode: Mode = raw === "layout" || raw === "export" ? "layout" : "diagnose";
  const setMode = (m: Mode) => setSp({ mode: m }, { replace: true });

  const {
    title, resumeId, version, dirty, conflict, hydrationKey, resume,
    loadRecord, setTitle, restoreSnapshot,
  } = useStore();
  const { saving, saveNow } = useAutoSave(id);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightView, setRightView] = useState<RightView>("diagnose");
  const [showIncomplete, setShowIncomplete] = useState(false);

  const issues = validateResumeForm(resume);
  // 诊断/下载前完整性检查（不阻断，仅提示 §4.3）：有缺项则亮黄条
  const flagIncomplete = () => { if (validateResumeForm(useStore.getState().resume).length) setShowIncomplete(true); };
  // 点缺项 → 展开左栏 + 滚动到对应分节（固定节 sec-*，扩展模块 mod-*）
  const scrollToSection = (key: string) => {
    setLeftOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`sec-${key}`) || document.getElementById(`mod-${key}`)
        || document.querySelector('[id^="mod-custom-"]');
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };
  const download = () => { flagIncomplete(); printRef.current(); };
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
        if (window.confirm("存在未解决的版本冲突，离开将丢弃你的本地改动。确定离开？")) blocker.proceed();
        else blocker.reset();
        return;
      }
      if (window.confirm("有未保存的修改。确定=保存后离开；取消=留在本页。")) {
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

  // ---- 键盘撤销/重做（顶栏图标位让给 版本记录/诊断记录，undo/redo 走 ⌘Z / ⇧⌘Z）----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      // 表单控件内不接管：让浏览器做输入框自身的文本撤销，避免双重回退
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current(); else undoRef.current();
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
    if (!window.confirm("回滚到该版本？当前内容会先自动快照，可再回滚回来。")) return;
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

  const status = conflict ? "冲突" : saving ? "保存中…" : dirty ? "未保存" : "已自动保存";

  return (
    <div className="anim-in flex h-screen flex-col bg-background">
      {/* ===== 全局顶栏 52px ===== */}
      <header className="relative flex h-[52px] shrink-0 items-center border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button aria-label="返回列表" onClick={() => nav("/")}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <input aria-label="简历名称" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="未命名简历"
            className="w-[160px] truncate rounded bg-transparent text-[16px] leading-6 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-border" />
          <span className={cn("flex shrink-0 items-center gap-1 text-[12px] leading-[17px]",
            conflict ? "text-destructive" : "text-muted-foreground")}>
            {!dirty && !saving && !conflict && <Check className="h-3 w-3" />}
            {status} · v{version}
          </span>
        </div>

        {/* 诊断/排版 分段（绝对居中） */}
        <div className="absolute left-1/2 top-1/2 flex h-8 w-[120px] -translate-x-1/2 -translate-y-1/2 items-center rounded-[8px] bg-muted p-[2px]">
          {([["diagnose", "诊断"], ["layout", "排版"]] as const).map(([m, lbl]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}
              className={cn("h-7 w-14 rounded-[6px] text-[12px] leading-4",
                mode === m ? "bg-background text-foreground shadow-card" : "text-muted-foreground")}>
              {lbl}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center">
          {/* 面板开关 */}
          <div className="flex items-center gap-1 px-1.5">
            <IconBtn label={leftOpen ? "收起左栏" : "展开左栏"} onClick={() => setLeftOpen(!leftOpen)}>
              <PanelLeft className={cn("h-4 w-4", !leftOpen && "opacity-50")} />
            </IconBtn>
            <IconBtn label="双栏全开" onClick={() => { setLeftOpen(true); setRightOpen(true); }}>
              <Columns2 className="h-4 w-4" />
            </IconBtn>
            <IconBtn label={rightOpen ? "收起右栏" : "展开右栏"} onClick={() => setRightOpen(!rightOpen)}>
              <PanelRight className={cn("h-4 w-4", !rightOpen && "opacity-50")} />
            </IconBtn>
          </div>
          <div className="ml-[14px] flex items-center gap-2">
            <button aria-label="版本记录" title="版本记录（内容变更自动快照，可回滚）" onClick={openHistory}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground">
              <History className="h-4 w-4" />
            </button>
            <button aria-label="诊断报告记录" title="诊断报告记录（历次诊断的只读快照）" onClick={openReports}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground">
              <FileClock className="h-4 w-4" />
            </button>
            <button onClick={() => setImportOpen(true)}
              className="flex h-8 w-[70px] items-center rounded-[8px] border border-border pl-2.5 text-[14px] text-foreground hover:bg-accent/40">
              <Upload className="h-4 w-4" /><span className="pl-1">导入</span>
            </button>
            <button onClick={download}
              className="flex h-8 w-[70px] items-center rounded-[8px] border border-border pl-2.5 text-[14px] text-foreground hover:bg-accent/40">
              <Download className="h-4 w-4" /><span className="pl-1">下载</span>
            </button>
            <button disabled={saving || !dirty || conflict} onClick={() => void saveNow()}
              className="flex h-8 w-[70px] items-center rounded-[8px] bg-primary pl-2.5 text-[14px] text-primary-foreground disabled:opacity-50">
              <Save className="h-4 w-4" /><span className="pl-1">保存</span>
            </button>
          </div>
        </div>
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

      {showIncomplete && issues.length > 0 && (
        <Alert tone="amber" className="mx-4 mt-3 shrink-0">
          <div className="flex items-start">
            <div className="flex-1">
              <b>简历还有 {issues.length} 处必填未完整</b>（不影响保存，建议补全后再诊断/导出）：
              <ul className="mt-1 space-y-0.5">
                {issues.slice(0, 8).map((it, i) => (
                  <li key={i}>
                    <button onClick={() => scrollToSection(it.sectionKey)}
                      className="text-left underline underline-offset-2 hover:opacity-70">{it.msg}</button>
                  </li>
                ))}
              </ul>
            </div>
            <button aria-label="关闭提示" onClick={() => setShowIncomplete(false)}
              className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </Alert>
      )}

      {/* ===== 三栏 ===== */}
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background">
            <PanelBar title={mode === "layout" ? "模板" : "编辑简历"}>
              <IconBtn label="收起" onClick={() => setLeftOpen(false)}><X className="h-4 w-4" /></IconBtn>
            </PanelBar>
            {mode === "layout"
              ? <TemplatesPanel />
              : <div key={hydrationKey} className="min-h-0 flex-1 overflow-y-auto"><SectionEditor /></div>}
          </aside>
        )}

        <PreviewCanvas device={device} showPolish={mode === "diagnose"}
          onPolish={() => { setRightView("polish"); setRightOpen(true); }}
          onImport={() => setImportOpen(true)} printApi={printApi} />

        {rightOpen && (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-border bg-background">
            {mode === "layout" ? (
              <PanelBar title="样式">
                <IconBtn label="收起" onClick={() => setRightOpen(false)}><X className="h-4 w-4" /></IconBtn>
              </PanelBar>
            ) : (
              /* 诊断模式：标题栏内嵌「诊断 / AI 润色」双 tab（Figma 843:268）——并置互切，取代旧的整栏切换+返回 */
              <div className="flex h-11 shrink-0 items-center border-b border-border pl-6 pr-4">
                <div className="flex items-center gap-2">
                  {([["diagnose", "诊断", FileText], ["polish", "AI 润色", Sparkles]] as const).map(([v, lbl, Icon]) => (
                    <button key={v} aria-pressed={rightView === v} onClick={() => setRightView(v)}
                      className={cn("flex h-8 items-center gap-1 rounded-[8px] pl-2 pr-2 text-[14px] leading-6",
                        rightView === v
                          ? "border border-border bg-background text-foreground shadow-card"
                          : "text-foreground hover:bg-accent/40")}>
                      <Icon className={cn("h-4 w-4", v === "polish" && "text-indigo-500")} />
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <IconBtn label="诊断报告记录" onClick={openReports}><FileClock className="h-4 w-4" /></IconBtn>
                  <IconBtn label="收起" onClick={() => setRightOpen(false)}><X className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            )}
            {mode === "layout"
              ? <StylePanel device={device} setDevice={setDevice} onExport={download} />
              : rightView === "polish" ? <PolishPanel /> : <DiagnosePanel onBeforeRun={flagIncomplete} />}
          </aside>
        )}
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {reportsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setReportsOpen(false); }}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1">
                {reportView && (
                  <Button variant="ghost" aria-label="返回报告列表" onClick={() => setReportView(null)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <h3 className="text-heading-20">{reportView ? "诊断报告" : "诊断报告记录"}</h3>
              </div>
              <Button variant="ghost" aria-label="关闭" onClick={() => setReportsOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            {!reportView && (
              <>
                {reports === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
                {reports?.length === 0 && (
                  <p className="text-copy-14 text-muted-foreground">还没有诊断记录（右栏运行「诊断」后自动存档）。</p>
                )}
                <div className="min-h-0 overflow-y-auto">
                  {reports?.map((r) => (
                    <button key={r.id} onClick={() => openReport(r.id)}
                      className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left hover:bg-accent/30">
                      <div className="flex-1">
                        <div className="text-copy-14">
                          {r.role_label} · {r.score}/{r.max_score}
                          {r.has_jd && <span className="ml-2 text-label-12 text-muted-foreground">含 JD 覆盖度</span>}
                        </div>
                        <div className="text-label-12 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <span className="text-label-12 text-muted-foreground">查看</span>
                    </button>
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
          </div>
        </div>
      )}

      {histOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setHistOpen(false); }}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-heading-20">历史版本</h3>
              <Button variant="ghost" aria-label="关闭" onClick={() => setHistOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            {revisions === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
            {revisions?.length === 0 && <p className="text-copy-14 text-muted-foreground">还没有历史版本（内容变更时自动快照）。</p>}
            <div className="max-h-[50vh] overflow-y-auto">
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
          </div>
        </div>
      )}
    </div>
  );
}
