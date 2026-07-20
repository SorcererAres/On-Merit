import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider, Outlet, Navigate, Link, useParams } from "react-router-dom";
import { ConfirmHost } from "@/components/confirm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FileText } from "lucide-react";

const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const EditorPage = lazy(() => import("@/pages/EditorPage").then((m) => ({ default: m.EditorPage })));

function PageFallback() {
  return (
    <div className="mx-auto flex min-h-page-fallback max-w-content items-center justify-center px-6" role="status">
      <div className="flex items-center gap-3 text-copy-14 text-muted-foreground">
        <FileText className="h-5 w-5 animate-pulse" aria-hidden />
        正在打开工作台…
      </div>
    </div>
  );
}

// key={id} 强制重挂：切到另一份简历时干净重建编辑态（见 frontend-wysiwyg-editor.md §五）
function EditorRoute() { const { id } = useParams(); return <Suspense fallback={<PageFallback />}><EditorPage key={id} /></Suspense>; }
// 退役 /preview/:id：排版并入外壳的 export 步（共用同一 load/autosave），旧链接重定向
function PreviewRedirect() { const { id } = useParams(); return <Navigate to={`/editor/${id}?mode=layout`} replace />; }

function Layout() {
  return (
    <div className="min-h-screen bg-gallery text-gallery-foreground">
      {/* 全局顶栏 52px（Figma 814:469）：品牌 + 主题切换。 */}
      <header className="flex h-app-header items-center border-b border-gray-200 px-4">
        <Link to="/" className="text-heading-16 text-gallery-foreground">实至 · On Merit</Link>
        <ThemeToggle className="ml-auto" />
      </header>
      <Outlet />
    </div>
  );
}

// 数据路由（useBlocker 需要它）
const router = createBrowserRouter([
  // 编辑器 v3 外壳自带全局顶栏，放 Layout 外（Dashboard 仍走 Layout）
  { path: "/editor/:id", element: <EditorRoute /> },
  { path: "/preview/:id", element: <PreviewRedirect /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Suspense fallback={<PageFallback />}><Dashboard /></Suspense> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      {/* 命令式确认弹窗宿主（confirmDialog 替代 window.confirm），全局仅此一处 */}
      <ConfirmHost />
    </>
  );
}
