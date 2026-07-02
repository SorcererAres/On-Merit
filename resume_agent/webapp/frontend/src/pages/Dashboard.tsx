// 仪表盘：简历列表卡片（新建 / 打开 / 复制 / 删除）。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, delJSON } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import type { ResumeRecord } from "@/store/useStore";
import { FilePlus2, Copy, Trash2, FileText } from "lucide-react";

interface ResumeMeta { id: string; title: string; role: string; version: number; updated_at: string }
interface Role { key: string; label: string }

export function Dashboard() {
  const nav = useNavigate();
  const [list, setList] = useState<ResumeMeta[] | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = () => getJSON<{ resumes: ResumeMeta[] }>("/api/resumes").then((d) => setList(d.resumes)).catch((e) => toast.error(e.message));
  useEffect(() => {
    refresh();
    getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(Object.fromEntries(d.roles.map((r) => [r.key, r.label])))).catch(() => {});
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const rec = await postJSON<ResumeRecord>("/api/resumes", { title: "未命名简历" });
      nav(`/editor/${rec.id}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const duplicate = async (id: string) => {
    try { await postJSON(`/api/resumes/${id}/duplicate`, {}); toast.success("已复制"); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`确定永久删除「${title}」？此操作会一并清除其历史版本，且不可撤销。`)) return;
    try { await delJSON(`/api/resumes/${id}`); toast.success("已删除"); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-heading-24">我的简历</h1>
          <p className="text-copy-14 text-muted-foreground mt-1">诊断 → 修改 → 排版，诚信地把真实经历讲到位。</p>
        </div>
        <Button disabled={busy} onClick={create}><FilePlus2 className="h-4 w-4" /> 新建简历</Button>
      </div>

      {list === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
      {list && list.length === 0 && (
        <Card className="text-center py-12">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-copy-14 text-muted-foreground">还没有简历，点「新建简历」开始。</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list?.map((r) => (
          <Card key={r.id} className="flex flex-col gap-3">
            <button className="text-left" onClick={() => nav(`/editor/${r.id}`)}>
              <div className="text-heading-20 truncate">{r.title || "未命名简历"}</div>
              <div className="mt-1 text-label-12 text-muted-foreground">
                {roles[r.role] || r.role} · v{r.version} · {new Date(r.updated_at).toLocaleString()}
              </div>
            </button>
            <div className="mt-auto flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => nav(`/editor/${r.id}`)}>打开</Button>
              <Button variant="ghost" aria-label="复制" onClick={() => duplicate(r.id)}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" aria-label="删除" onClick={() => remove(r.id, r.title)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
