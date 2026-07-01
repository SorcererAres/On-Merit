import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import type { Resume } from "@/types";
import { Plus, X } from "lucide-react";

// 本地草稿编辑，"保存并继续" 一次性 commit 到 store（不每次按键写全局）。
export function StepReview() {
  const { resume, warnings, setResume, unlock, goStep } = useStore();
  const [d, setD] = useState<Resume>(() => structuredClone(resume ?? {}));
  const [rawOpen, setRawOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [rawErr, setRawErr] = useState("");
  const bump = () => setD({ ...d });

  const b = (d.basics ??= {});
  const commit = () => { setResume(d, warnings); unlock(3); goStep(3); };

  return (
    <section>
      <h2 className="text-heading-24 mb-1">核对与纠错</h2>
      <p className="text-copy-14 text-muted-foreground mb-4">结构化由 AI 完成，可能漏字/误读。核对改错后再继续。</p>

      {warnings.length > 0 && (
        <Alert tone="amber" className="mb-4">
          <b>核对提示</b>（以下内容未在原文精确找到，请核对）：
          <ul className="mt-1 list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      )}

      <Card className="mb-4">
        <CardTitle>基本信息</CardTitle>
        {([["name", "姓名"], ["email", "邮箱"], ["phone", "电话"], ["url", "个人站/作品集"]] as const).map(([k, lbl]) => (
          <div key={k} className="mb-2"><Label>{lbl}</Label>
            <Input value={(b as any)[k] ?? ""} onChange={(e) => { (b as any)[k] = e.target.value; bump(); }} /></div>
        ))}
        <div className="mb-1"><Label>个人简介</Label>
          <Textarea rows={3} value={b.summary ?? ""} onChange={(e) => { b.summary = e.target.value; bump(); }} /></div>
      </Card>

      {(d.work ?? []).map((w, i) => (
        <Card key={i} className="mb-4">
          <CardTitle>工作经历 {i + 1}</CardTitle>
          {([["name", "公司"], ["position", "职位"], ["startDate", "起"], ["endDate", "止"]] as const).map(([k, lbl]) => (
            <div key={k} className="mb-2"><Label>{lbl}</Label>
              <Input value={(w as any)[k] ?? ""} onChange={(e) => { (w as any)[k] = e.target.value; bump(); }} /></div>
          ))}
          <div className="mb-2"><Label>职责</Label>
            <Textarea rows={2} value={w.summary ?? ""} onChange={(e) => { w.summary = e.target.value; bump(); }} /></div>
          <Label>成果要点</Label>
          {(w.highlights ?? []).map((h, j) => (
            <div key={j} className="mb-1.5 flex gap-2">
              <Input value={h} onChange={(e) => { w.highlights![j] = e.target.value; bump(); }} />
              <Button variant="ghost" aria-label="删除" onClick={() => { w.highlights!.splice(j, 1); bump(); }}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" className="mt-1" onClick={() => { (w.highlights ??= []).push(""); bump(); }}>
            <Plus className="h-4 w-4" />加一条
          </Button>
        </Card>
      ))}

      {(d.skills?.length ?? 0) > 0 && (
        <Card className="mb-4">
          <CardTitle>核心能力</CardTitle>
          {d.skills!.map((s, i) => (
            <div key={i} className="mb-2"><Label>{s.name}</Label>
              <Input value={(s.keywords ?? []).join("、")}
                onChange={(e) => { s.keywords = e.target.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean); bump(); }} /></div>
          ))}
        </Card>
      )}

      <details className="mb-4" open={rawOpen} onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open; setRawOpen(open);
        if (open) setRaw(JSON.stringify(d, null, 2));
      }}>
        <summary className="cursor-pointer text-label-13 text-muted-foreground">查看/编辑原始 JSON</summary>
        <Textarea rows={10} className="mt-2 font-mono text-copy-13" value={raw} onChange={(e) => setRaw(e.target.value)} />
        {rawErr && <p className="text-copy-13 text-destructive mt-1">{rawErr}</p>}
        <Button variant="secondary" className="mt-2" onClick={() => {
          try { setD(JSON.parse(raw)); setRawErr(""); setRawOpen(false); } catch (e) { setRawErr("JSON 格式错误：" + (e as Error).message); }
        }}>应用 JSON</Button>
      </details>

      <Button onClick={commit}>保存并继续：岗位匹配</Button>
    </section>
  );
}
