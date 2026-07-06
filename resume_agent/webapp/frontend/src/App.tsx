import { useState } from "react";
import { createBrowserRouter, RouterProvider, Outlet, Navigate, Link, useParams } from "react-router-dom";
import { Dashboard } from "@/pages/Dashboard";
import { EditorPage } from "@/pages/EditorPage";
import { ConfirmHost } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

// key={id} 强制重挂：切到另一份简历时干净重建编辑态（见 frontend-wysiwyg-editor.md §五）
function EditorRoute() { const { id } = useParams(); return <EditorPage key={id} />; }
// 退役 /preview/:id：排版并入外壳的 export 步（共用同一 load/autosave），旧链接重定向
function PreviewRedirect() { const { id } = useParams(); return <Navigate to={`/editor/${id}?mode=layout`} replace />; }

function Layout() {
  const [dark, setDark] = useState(false);
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle("dark", d); };
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 全局顶栏 52px（Figma 814:469）：品牌「实至 · On Merit」；暗色切换为既有功能保留右侧 */}
      <header className="flex h-[52px] items-center border-b border-border px-4">
        <Link to="/" className="text-[16px] leading-6 font-semibold text-foreground">实至 · On Merit</Link>
        <Button variant="ghost" className="ml-auto" aria-pressed={dark}
          aria-label={dark ? "切换到浅色主题" : "切换到深色主题"} onClick={toggle}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
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
      { path: "/", element: <Dashboard /> },
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
