// 左栏 · 分节编辑器：常驻、按 section 折叠；编辑实时防抖写 store（store 为唯一真相源）。
// 载入/回滚时由外层 hydrationKey 重挂，本组件只在挂载时从 store 取初值。
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import type { Resume } from "@/types";
import { Plus, X } from "lucide-react";

function Section({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-b border-border">
      <summary className="cursor-pointer px-4 py-3 text-button-14 select-none">{title}</summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function SectionEditor() {
  const { resume, warnings, usedOcr, editResume, setLinkQuery } = useStore();
  const [d, setD] = useState<Resume>(() => structuredClone(resume ?? {}));
  const first = useRef(true);

  // 每次编辑同步推入 store（简历对象很小，clone 廉价；LivePreview/autosave 各有自己的防抖）。
  // 好处：dirty 即时置位（导航守卫无 300ms 盲窗）、无卸载 flush、无旧草稿覆盖新文档的窗口。
  useEffect(() => {
    if (first.current) { first.current = false; return; }  // 挂载不推，避免载入即置 dirty
    editResume(structuredClone(d));
  }, [d]);

  const bump = () => setD({ ...d });
  const b = (d.basics ??= {});

  return (
    // 聚焦任意字段 → 把其值设为联动定位目标（SourcePanel 在原文中近似高亮）
    <div onFocusCapture={(e) => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement;
      if ("value" in t && t.value) setLinkQuery(t.value);
    }}>
      {usedOcr && <Alert tone="amber" className="m-3">本简历经图片 OCR 识别，个别文字可能有误，请重点核对。</Alert>}
      {warnings.length > 0 && (
        <Alert tone="amber" className="m-3">
          <b>核对提示</b>（未在原文精确找到，请核对）：
          <ul className="mt-1 list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      )}

      <Section title="基本信息">
        {([["name", "姓名"], ["email", "邮箱"], ["phone", "电话"], ["url", "个人站/作品集"]] as const).map(([k, lbl]) => (
          <div key={k} className="mb-2"><Label htmlFor={`b-${k}`}>{lbl}</Label>
            <Input id={`b-${k}`} aria-label={lbl} value={(b as any)[k] ?? ""} onChange={(e) => { (b as any)[k] = e.target.value; bump(); }} /></div>
        ))}
        <div><Label htmlFor="b-summary">个人简介</Label>
          <Textarea id="b-summary" rows={3} aria-label="个人简介" value={b.summary ?? ""} onChange={(e) => { b.summary = e.target.value; bump(); }} /></div>
      </Section>

      {(d.work ?? []).map((w, i) => (
        <Section key={i} title={`工作经历 ${i + 1} · ${w.name || "未填公司"}`}>
          {([["name", "公司"], ["position", "职位"], ["startDate", "起"], ["endDate", "止"]] as const).map(([k, lbl]) => (
            <div key={k} className="mb-2"><Label htmlFor={`w-${i}-${k}`}>{lbl}</Label>
              <Input id={`w-${i}-${k}`} aria-label={`工作经历 ${i + 1} ${lbl}`} value={(w as any)[k] ?? ""} onChange={(e) => { (w as any)[k] = e.target.value; bump(); }} /></div>
          ))}
          <div className="mb-2"><Label htmlFor={`w-${i}-summary`}>职责</Label>
            <Textarea id={`w-${i}-summary`} rows={2} aria-label={`工作经历 ${i + 1} 职责`} value={w.summary ?? ""} onChange={(e) => { w.summary = e.target.value; bump(); }} /></div>
          <Label>成果要点</Label>
          {(w.highlights ?? []).map((h, j) => (
            <div key={j} className="mb-1.5 flex gap-2">
              <Input aria-label={`工作经历 ${i + 1} 成果要点 ${j + 1}`} value={h} onChange={(e) => { w.highlights![j] = e.target.value; bump(); }} />
              <Button variant="ghost" aria-label={`删除成果要点 ${j + 1}`} onClick={() => { w.highlights!.splice(j, 1); bump(); }}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" className="mt-1" onClick={() => { (w.highlights ??= []).push(""); bump(); }}>
            <Plus className="h-4 w-4" />加一条
          </Button>
        </Section>
      ))}

      {(d.skills?.length ?? 0) > 0 && (
        <Section title="核心能力">
          {d.skills!.map((s, i) => (
            <div key={i} className="mb-2"><Label htmlFor={`sk-${i}`}>{s.name}</Label>
              <Input id={`sk-${i}`} aria-label={`${s.name} 关键词`} value={(s.keywords ?? []).join("、")}
                onChange={(e) => { s.keywords = e.target.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean); bump(); }} /></div>
          ))}
        </Section>
      )}

      {(d.education?.length ?? 0) > 0 && (
        <Section title="教育经历" defaultOpen={false}>
          {d.education!.map((e0, i) => (
            <div key={i} className="mb-3">
              {([["institution", "学校"], ["studyType", "学历"], ["area", "专业"]] as const).map(([k, lbl]) => (
                <div key={k} className="mb-2"><Label htmlFor={`e-${i}-${k}`}>{lbl}</Label>
                  <Input id={`e-${i}-${k}`} aria-label={`教育经历 ${i + 1} ${lbl}`} value={(e0 as any)[k] ?? ""} onChange={(ev) => { (e0 as any)[k] = ev.target.value; bump(); }} /></div>
              ))}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
