import { useState } from "react";
import { createBrowserRouter, RouterProvider, Outlet, Navigate, Link, useParams } from "react-router-dom";
import { Dashboard } from "@/pages/Dashboard";
import { EditorPage } from "@/pages/EditorPage";
import { PreviewPage } from "@/pages/PreviewPage";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

// key={id} 强制重挂：切到另一份简历时干净重建编辑态（见 frontend-wysiwyg-editor.md §五）
function EditorRoute() { const { id } = useParams(); return <EditorPage key={id} />; }
function PreviewRoute() { const { id } = useParams(); return <PreviewPage key={id} />; }

function Layout() {
  const [dark, setDark] = useState(false);
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle("dark", d); };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-baseline gap-4 flex-wrap border-b border-border px-6 md:px-8 py-4">
        <Link to="/" className="text-heading-20 text-primary">简历优化 <span className="text-label-13 text-muted-foreground font-normal">Resume Agent</span></Link>
        <div className="text-copy-14 text-muted-foreground hidden sm:block">诊断 → 修改 → 排版：诚信地把真实经历讲到位</div>
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
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/editor/:id", element: <EditorRoute /> },
      { path: "/preview/:id", element: <PreviewRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
