// 左栏 · 编辑简历（v3 分节手风琴表单）：基础信息 + 教育/工作/项目条目 CRUD + 个人优势/技能。
// 描述本期用计数 Textarea（富文本留 E3）；扩展模块系统留 E2b。
// 本地草稿 d：挂载克隆 store，编辑实时推回（editResume=clone+bump），autosave/undo/预览零改动。
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { validateResumeForm } from "@/lib/validateResumeForm";
import {
  AccordionSection, Field, BareInput, BareSelect, MonthRange,
  TagInput, CountedTextarea, ItemCard, AddButton,
} from "./formControls";
import { ExtraModules } from "./ExtraModules";
import { Alert } from "@/components/ui/misc";
import { Calendar } from "lucide-react";
import type { Resume, Education, Work, Project } from "@/types";

let _uid = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${_uid++}`;
// 给条目补稳定 id（React key + 删除不错位）；补在本地草稿上，随保存持久化，后端忽略。
function ensureIds(r: Resume): Resume {
  for (const sec of ["education", "work", "projects"] as const) {
    for (const it of (r[sec] || []) as Record<string, unknown>[]) if (!it.id) it.id = uid(sec[0]);
  }
  return r;
}

const GENDERS = [["", "不填"], ["male", "男"], ["female", "女"]] as const;
const STUDY_TYPES = ["博士", "硕士", "本科", "大专", "其他"];
const STUDY_MODES = [["", "不填"], ["full_time", "全日制"], ["part_time", "非全日制"]] as const;

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
        <Field label="姓名" required error={errOf("basics.name")}>
          <BareInput aria-label="姓名" value={b.name ?? ""} placeholder="请输入姓名"
            onBlur={() => touch("basics.name")}
            onChange={(e) => { b.name = e.target.value; bump(); }} />
        </Field>
        <Field label="性别">
          <BareSelect aria-label="性别" value={b.gender ?? ""}
            onChange={(e) => { const v = e.target.value; if (v) b.gender = v as any; else delete b.gender; bump(); }}>
            {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </BareSelect>
        </Field>
        <Field label="生日">
          <div className="flex items-center gap-1">
            <input type="month" aria-label="生日" value={b.birthMonth ?? ""}
              onChange={(e) => { b.birthMonth = e.target.value; bump(); }}
              className="w-full bg-transparent py-2.5 text-[14px] text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-0" />
            <Calendar className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </Field>
        <div onBlur={() => touch("basics.contact")}>
          <Field label="电话" error={errOf("basics.contact")}>
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
              <Field label="学校" required error={errOf(`education[${i}].institution`)}>
                <BareInput aria-label={`教育 ${i + 1} 学校`} value={e.institution ?? ""} placeholder="请输入毕业院校"
                  onBlur={() => touch(`education[${i}].institution`)}
                  onChange={(ev) => { e.institution = ev.target.value; bump(); }} />
              </Field>
              <Field label="学历">
                <BareSelect aria-label={`教育 ${i + 1} 学历`} value={e.studyType ?? ""}
                  onChange={(ev) => { e.studyType = ev.target.value || undefined; bump(); }}>
                  <option value="">请选择学历</option>
                  {STUDY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  {e.studyType && !STUDY_TYPES.includes(e.studyType) && <option value={e.studyType}>{e.studyType}</option>}
                </BareSelect>
              </Field>
              <Field label="学制">
                <BareSelect aria-label={`教育 ${i + 1} 学制`} value={e.studyMode ?? ""}
                  onChange={(ev) => { const v = ev.target.value; if (v) e.studyMode = v as any; else delete e.studyMode; bump(); }}>
                  {STUDY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </BareSelect>
              </Field>
              <Field label="专业">
                <BareInput aria-label={`教育 ${i + 1} 专业`} value={e.area ?? ""} placeholder="请输入专业名称"
                  onChange={(ev) => { e.area = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="时间" start={e.startDate} end={e.endDate} error={errOf(`education[${i}].endDate`)}
                onStart={(v) => { e.startDate = v; bump(); }} onEnd={(v) => { e.endDate = v; bump(); }} />
              <CountedTextarea value={e.description} placeholder="可填写专业、课程、成绩、论文、奖项"
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
              <Field label="公司名称" required error={errOf(`work[${i}].name`)}>
                <BareInput aria-label={`工作 ${i + 1} 公司`} value={w.name ?? ""} placeholder="请输入公司名称"
                  onBlur={() => touch(`work[${i}].name`)}
                  onChange={(ev) => { w.name = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="工作时间" start={w.startDate} end={w.endDate} error={errOf(`work[${i}].endDate`)}
                onStart={(v) => { w.startDate = v; bump(); }} onEnd={(v) => { w.endDate = v; bump(); }} />
              <Field label="岗位名称">
                <BareInput aria-label={`工作 ${i + 1} 岗位`} value={w.position ?? ""} placeholder="请输入岗位名称"
                  onChange={(ev) => { w.position = ev.target.value; bump(); }} />
              </Field>
              <CountedTextarea value={w.description} placeholder="请填写工作职责与成果"
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
              <Field label="项目名称" required error={errOf(`projects[${i}].name`)}>
                <BareInput aria-label={`项目 ${i + 1} 名称`} value={p.name ?? ""} placeholder="请输入项目名称"
                  onBlur={() => touch(`projects[${i}].name`)}
                  onChange={(ev) => { p.name = ev.target.value; bump(); }} />
              </Field>
              <Field label="担任角色">
                <BareInput aria-label={`项目 ${i + 1} 角色`} value={p.role ?? ""} placeholder="请输入担任角色"
                  onChange={(ev) => { p.role = ev.target.value; bump(); }} />
              </Field>
              <MonthRange label="项目时间" start={p.startDate} end={p.endDate} error={errOf(`projects[${i}].endDate`)}
                onStart={(v) => { p.startDate = v; bump(); }} onEnd={(v) => { p.endDate = v; bump(); }} />
              <CountedTextarea value={p.description} placeholder="请填写项目经历描述"
                onFocus={() => link(p.description)}
                onChange={(v) => { p.description = v; bump(); }} />
            </ItemCard>
          );
        })}
        <AddButton label="新增项目经历" onClick={() => addItem("projects", { name: "" })} />
      </AccordionSection>

      {/* 个人优势 */}
      <AccordionSection title="个人优势" id="sec-summary">
        <CountedTextarea value={b.summary} placeholder="请填写个人优势"
          onFocus={() => link(b.summary)}
          onChange={(v) => { b.summary = v; bump(); }} />
      </AccordionSection>

      {/* 掌握技能 */}
      <AccordionSection title="掌握技能" id="sec-skills">
        <CountedTextarea value={typeof d.skills_md === "string" ? d.skills_md : ""} placeholder="请填写掌握的技能"
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
