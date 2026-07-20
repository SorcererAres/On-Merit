// 左栏 · 编辑简历（v3 分节手风琴表单）：基础信息 + 教育/工作/项目条目 CRUD + 个人优势/技能。
// 描述用 RichTextarea（工具栏插 md）；扩展模块见 ExtraModules。
// 本地草稿 d：挂载克隆 store，编辑实时推回（editResume=clone+bump），autosave/undo/预览零改动。
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { validateResumeForm } from "@/lib/validateResumeForm";
import {
  AccordionSection, Field, BareInput, MonthRange,
  TagInput, RichTextarea, ItemCard, AddButton,
} from "./formControls";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ExtraModules } from "./ExtraModules";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthPicker } from "@/components/ui/month-picker";
import { ImageUp } from "lucide-react";
import { toast } from "sonner";
import type { Resume, Education, Work, Project } from "@/types";

let _uid = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${_uid++}`;

// 头像压缩：任意图片 → 256×256 居中裁切的 JPEG data URL（控制 base64 体量，后端 PHOTO_MAX 兜底）
function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const S = 256;
        const canvas = document.createElement("canvas");
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas 不可用"));
        const scale = Math.max(S / img.width, S / img.height);   // cover 裁切
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));   // 污染画布/编码异常在 onload 内抛，须转 reject，否则 await 永挂
      } catch (err) {
        reject(err instanceof Error ? err : new Error("图片处理失败"));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
    img.src = url;
  });
}

/** 头像上传：预览 + 上传/更换/移除；存 basics.photo（压缩后的 data URL） */
function PhotoUpload({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";   // 允许重复选同一文件
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast.error("请选择图片文件"); return; }
    try { onChange(await resizePhoto(f)); }
    catch { toast.error("图片处理失败，请换一张"); }
  };
  return (
    <div className="flex items-center rounded-md border border-border px-3 py-2">
      <span className="w-20 shrink-0 text-copy-14 text-muted-foreground">头像</span>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {value
          ? <img src={value} alt="头像预览" className="h-12 w-12 rounded-md object-cover" />
          : <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageUp className="h-5 w-5" /></div>}
        <Button type="button" variant="ghost" onClick={() => ref.current?.click()}
          className="px-2 text-copy-13">{value ? "更换" : "上传"}</Button>
        {value && <Button type="button" variant="ghost" onClick={() => onChange("")}
          className="px-2 text-copy-13 text-muted-foreground hover:text-destructive">移除</Button>}
      </div>
      <Input ref={ref} type="file" accept="image/*" aria-label="上传头像" onChange={pick} className="hidden" />
    </div>
  );
}
// 给条目补稳定 id（React key + 删除不错位）；补在本地草稿上，随保存持久化，后端忽略。
function ensureIds(r: Resume): Resume {
  for (const sec of ["education", "work", "projects"] as const) {
    for (const it of (r[sec] || []) as Record<string, unknown>[]) if (!it.id) it.id = uid(sec[0]);
  }
  return r;
}

// Radix Select 禁止空串 value，「不填/请选择」用哨兵值映射（存储层仍是 delete 字段）
const UNSET = "__unset__";
const GENDERS = [[UNSET, "不填"], ["male", "男"], ["female", "女"]] as const;
const STUDY_TYPES = ["博士", "硕士", "本科", "大专", "其他"];
const STUDY_MODES = [[UNSET, "不填"], ["full_time", "全日制"], ["part_time", "非全日制"]] as const;

export function SectionEditor() {
  const { resume, warnings, usedOcr, editResume, setLinkQuery } = useStore();
  const [d, setD] = useState<Resume>(() => ensureIds(structuredClone(resume ?? {})));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    editResume(structuredClone(d));
  }, [d]);

  const bump = () => setD({ ...d });
  const touch = (path: string) => setTouched((s) => new Set(s).add(path));
  useEffect(() => {
    const revealIssue = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (path) touch(path);
    };
    window.addEventListener("resume:focus-issue", revealIssue);
    return () => window.removeEventListener("resume:focus-issue", revealIssue);
  }, []);
  const issues = validateResumeForm(d);
  const errOf = (path: string) => (touched.has(path) ? issues.find((i) => i.path === path)?.msg : undefined);

  const b = (d.basics ??= {});
  const link = (v?: string) => v && setLinkQuery(v);

  // 通用条目 CRUD
  const addItem = (sec: "education" | "work" | "projects", init: Record<string, unknown>) => {
    const arr = ((d as any)[sec] ??= []) as unknown[];
    arr.push({ id: uid(sec[0]), ...init }); bump();
  };
  const delItem = (sec: "education" | "work" | "projects", i: number) => {
    (d[sec] as unknown[]).splice(i, 1); bump();
  };

  return (
    <div onFocusCapture={(e) => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement;
      if ("value" in t && t.value) setLinkQuery(t.value);
    }}>
      {usedOcr && <Alert tone="amber" className="m-4">本简历经图片 OCR 识别，个别文字可能有误，请重点核对。</Alert>}
      {warnings.length > 0 && (
        <Alert tone="amber" className="m-4"><b>核对提示</b>（未在原文精确找到，请核对）：
          <ul className="mt-1 list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      )}

      {/* 基础信息 */}
      <AccordionSection title="基础信息" id="sec-basics">
        <PhotoUpload value={b.photo} onChange={(v) => { if (v) b.photo = v; else delete b.photo; bump(); }} />
        <Field label="姓名" required path="basics.name" error={errOf("basics.name")}>
          <BareInput aria-label="姓名" value={b.name ?? ""} placeholder="请输入姓名"
            onBlur={() => touch("basics.name")}
            onChange={(e) => { b.name = e.target.value; bump(); }} />
        </Field>
        <Field label="性别">
          <Select value={b.gender ?? UNSET}
            onValueChange={(v) => { if (v === UNSET) delete b.gender; else b.gender = v as "male" | "female"; bump(); }}>
            <SelectTrigger bare aria-label="性别"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GENDERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="生日">
          <MonthPicker value={b.birthMonth} ariaLabel="生日" placeholder="选择出生年月"
            onChange={(v) => { b.birthMonth = v; bump(); }} />
        </Field>
        <div onBlur={() => touch("basics.contact")}>
          <Field label="电话" path="basics.contact" error={errOf("basics.contact")}>
            <BareInput aria-label="电话" value={b.phone ?? ""} placeholder="请填写电话"
              onChange={(e) => { b.phone = e.target.value; bump(); }} />
          </Field>
        </div>
        <Field label="微信">
          <BareInput aria-label="微信" value={b.wechat ?? ""} placeholder="请填写微信"
            onChange={(e) => { b.wechat = e.target.value; bump(); }} />
        </Field>
        <Field label="邮箱">
          <BareInput aria-label="邮箱" value={b.email ?? ""} placeholder="请填写邮箱"
            onChange={(e) => { b.email = e.target.value; bump(); }} />
        </Field>
        <Field label="籍贯">
          <BareInput aria-label="籍贯" value={b.hometown ?? ""} placeholder="请填写籍贯城市"
            onChange={(e) => { b.hometown = e.target.value; bump(); }} />
        </Field>
        <TagInput label="自定义标签" tags={b.tags ?? []} max={8} maxLen={12}
          placeholder="请输入标签，输入后回车添加"
          onChange={(t) => { if (t.length) b.tags = t; else delete b.tags; bump(); }} />
      </AccordionSection>

      {/* 教育经历 */}
      <AccordionSection title="教育经历" id="sec-education">
        {(d.education ?? []).map((e0, i) => {
          const e = e0 as Education & { id: string };
          return (
            <ItemCard key={e.id} title={e.institution || "未填学校"} onDelete={() => delItem("education", i)}>
              <Field label="学校" required path={`education[${i}].institution`} error={errOf(`education[${i}].institution`)}>
                <BareInput aria-label={`教育 ${i + 1} 学校`} value={e.institution ?? ""} placeholder="请输入毕业院校"
                  onBlur={() => touch(`education[${i}].institution`)}
                  onChange={(ev) => { e.institution = ev.target.value; bump(); }} />
              </Field>
              <Field label="学历">
                <Select value={e.studyType ?? UNSET}
                  onValueChange={(v) => { e.studyType = v === UNSET ? undefined : v; bump(); }}>
                  <SelectTrigger bare aria-label={`教育 ${i + 1} 学历`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>请选择学历</SelectItem>
                    {STUDY_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    {/* §3.5 旧值不在枚举 → 动态追加，不丢不改 */}
                    {e.studyType && !STUDY_TYPES.includes(e.studyType) && <SelectItem value={e.studyType}>{e.studyType}</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="学制">
                <Select value={e.studyMode ?? UNSET}
                  onValueChange={(v) => { if (v === UNSET) delete e.studyMode; else e.studyMode = v as any; bump(); }}>
                  <SelectTrigger bare aria-label={`教育 ${i + 1} 学制`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STUDY_MODES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="专业">
                <BareInput aria-label={`教育 ${i + 1} 专业`} value={e.area ?? ""} placeholder="请输入专业名称"
                  onChange={(ev) => { e.area = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="时间" start={e.startDate} end={e.endDate} path={`education[${i}].endDate`} error={errOf(`education[${i}].endDate`)}
                onStart={(v) => { e.startDate = v; bump(); }} onEnd={(v) => { e.endDate = v; bump(); }} />
              <RichTextarea value={e.description} polishKind="edu"
                genContext={[e.institution, e.studyType, e.area].filter(Boolean).join(" · ")}
                placeholder="可填写专业、课程、成绩、论文、奖项"
                onFocus={() => link(e.description)}
                onChange={(v) => { e.description = v; bump(); }} />
            </ItemCard>
          );
        })}
        <AddButton label="新增教育经历" onClick={() => addItem("education", { institution: "" })} />
      </AccordionSection>

      {/* 工作经历 */}
      <AccordionSection title="工作经历" id="sec-work">
        {(d.work ?? []).map((w0, i) => {
          const w = w0 as Work & { id: string };
          return (
            <ItemCard key={w.id} title={w.name || "未填公司"} onDelete={() => delItem("work", i)}>
              <Field label="公司名称" required path={`work[${i}].name`} error={errOf(`work[${i}].name`)}>
                <BareInput aria-label={`工作 ${i + 1} 公司`} value={w.name ?? ""} placeholder="请输入公司名称"
                  onBlur={() => touch(`work[${i}].name`)}
                  onChange={(ev) => { w.name = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="工作时间" start={w.startDate} end={w.endDate} path={`work[${i}].endDate`} error={errOf(`work[${i}].endDate`)}
                onStart={(v) => { w.startDate = v; bump(); }} onEnd={(v) => { w.endDate = v; bump(); }} />
              <Field label="岗位名称">
                <BareInput aria-label={`工作 ${i + 1} 岗位`} value={w.position ?? ""} placeholder="请输入岗位名称"
                  onChange={(ev) => { w.position = ev.target.value; bump(); }} />
              </Field>
              <RichTextarea value={w.description} polishKind="work"
                genContext={[w.name, w.position, [w.startDate, w.endDate].filter(Boolean).join("–")].filter(Boolean).join(" · ")}
                placeholder="请填写工作职责与成果"
                onFocus={() => link(w.description)}
                onChange={(v) => { w.description = v; bump(); }} />
            </ItemCard>
          );
        })}
        <AddButton label="新增工作经历" onClick={() => addItem("work", { name: "" })} />
      </AccordionSection>

      {/* 项目经历 */}
      <AccordionSection title="项目经历" id="sec-projects">
        {(d.projects ?? []).map((p0, i) => {
          const p = p0 as Project & { id: string };
          return (
            <ItemCard key={p.id} title={p.name || "未填项目"} onDelete={() => delItem("projects", i)}>
              <Field label="项目名称" required path={`projects[${i}].name`} error={errOf(`projects[${i}].name`)}>
                <BareInput aria-label={`项目 ${i + 1} 名称`} value={p.name ?? ""} placeholder="请输入项目名称"
                  onBlur={() => touch(`projects[${i}].name`)}
                  onChange={(ev) => { p.name = ev.target.value; bump(); }} />
              </Field>
              <Field label="担任角色">
                <BareInput aria-label={`项目 ${i + 1} 角色`} value={p.role ?? ""} placeholder="请输入担任角色"
                  onChange={(ev) => { p.role = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="项目时间" start={p.startDate} end={p.endDate} path={`projects[${i}].endDate`} error={errOf(`projects[${i}].endDate`)}
                onStart={(v) => { p.startDate = v; bump(); }} onEnd={(v) => { p.endDate = v; bump(); }} />
              <RichTextarea value={p.description} polishKind="project"
                genContext={[p.name, p.role].filter(Boolean).join(" · ")}
                placeholder="请填写项目经历描述"
                onFocus={() => link(p.description)}
                onChange={(v) => { p.description = v; bump(); }} />
            </ItemCard>
          );
        })}
        <AddButton label="新增项目经历" onClick={() => addItem("projects", { name: "" })} />
      </AccordionSection>

      {/* 个人优势 */}
      <AccordionSection title="个人优势" id="sec-summary">
        <RichTextarea value={b.summary} polishKind="summary" placeholder="请填写个人优势"
          onFocus={() => link(b.summary)}
          onChange={(v) => { b.summary = v; bump(); }} />
      </AccordionSection>

      {/* 掌握技能 */}
      <AccordionSection title="掌握技能" id="sec-skills">
        <RichTextarea value={typeof d.skills_md === "string" ? d.skills_md : ""} polishKind="skills" placeholder="请填写掌握的技能"
          onFocus={() => link(d.skills_md)}
          onChange={(v) => { d.skills_md = v; bump(); }} />
      </AccordionSection>

      {/* 扩展模块 + 添加模块面板 */}
      <ExtraModules d={d} bump={bump} link={link} errOf={errOf} touch={touch} />
    </div>
  );
}

// 供 EditorPage 诊断/下载前黄条滚动定位（sectionKey → 分节锚点 id）
export const sectionAnchor = (key: string) => `sec-${key}`;
