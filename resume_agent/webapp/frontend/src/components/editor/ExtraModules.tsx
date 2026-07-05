// 编辑表单 v3 · 扩展模块系统（「添加模块」，方案 §二）：已启用模块节（配置驱动） + 底部添加面板。
// 「已添加」判定=字段存在；添加=初始化字段并滚动聚焦；移除=删字段（自定义按条目 id 删）。
// 复用现有字段的模块(awards/volunteer/certificates)旧数据非空时自动视为已添加。描述用 RichTextarea（工具栏插 md，预览实时渲染）。
import {
  AccordionSection, Field, BareInput, MonthRange, RichTextarea,
  TagInput, ItemCard, AddButton,
} from "./formControls";
import { cn } from "@/lib/cn";
import { Plus, Trash2, Calendar } from "lucide-react";
import type { Resume } from "@/types";

type Rec = Record<string, any>;
let _uid = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${_uid++}`;

// 经历型模块配置：主字段(必填) + 可选副字段 + 时间(range 区间 / date 单月) + 描述
interface ExpCfg {
  label: string; nameKey: string; nameLabel: string; namePh: string;
  extra?: [string, string, string][];   // [key, label, placeholder]
  range?: boolean; date?: boolean; addLabel: string;
}
const EXP: Record<string, ExpCfg> = {
  internships: { label: "实习经历", nameKey: "name", nameLabel: "公司名称", namePh: "请输入公司名称",
    extra: [["position", "岗位名称", "请输入岗位名称"]], range: true, addLabel: "新增实习经历" },
  organizations: { label: "学生会 / 社团经历", nameKey: "name", nameLabel: "社团名称", namePh: "请输入社团名称",
    extra: [["role", "担任角色", "请输入担任角色"]], range: true, addLabel: "新增学生会/社团经历" },
  volunteer: { label: "志愿者活动", nameKey: "organization", nameLabel: "组织", namePh: "请输入组织名称",
    extra: [["position", "担任角色", "请输入担任角色"]], range: true, addLabel: "新增志愿者活动" },
  campus: { label: "校园大使", nameKey: "name", nameLabel: "主办方·品牌", namePh: "请输入主办方或品牌",
    range: true, addLabel: "新增校园大使经历" },
  thesis: { label: "毕业设计 / 论文", nameKey: "title", nameLabel: "课题名", namePh: "请输入课题名",
    date: true, addLabel: "新增毕业设计" },
  competitions: { label: "学术竞赛", nameKey: "name", nameLabel: "竞赛名称", namePh: "请输入竞赛名称",
    extra: [["award", "所获奖项", "请输入所获奖项"]], date: true, addLabel: "新增学术竞赛" },
};
// 简单模块（无描述）：字段列表 [key,label,placeholder,required?,kind?]
interface SimpleCfg { label: string; addLabel: string; fields: [string, string, string, boolean?, "date"?][] }
const SIMPLE: Record<string, SimpleCfg> = {
  awards: { label: "所获荣誉", addLabel: "新增荣誉信息", fields: [
    ["title", "荣誉名称", "请输入荣誉名称", true], ["awarder", "颁发方", "请输入颁发方"],
    ["date", "获得时间", "", false, "date"], ["summary", "说明", "请一句话说明（≤100 字）"] ] },
  certificates: { label: "资格证书", addLabel: "新增资格证书", fields: [
    ["name", "证书名称", "请输入证书名称", true], ["date", "取得时间", "", false, "date"] ] },
};
// 经历型模块 → polish-field kind（社团/志愿者/校园大使共用 activity）
const POLISH_KIND: Record<string, string> = {
  internships: "internship", organizations: "activity", volunteer: "activity",
  campus: "activity", thesis: "thesis", competitions: "competition",
};
// 面板顺序（自定义永驻末位）
const PANEL = [
  "job_intent", "internships", "organizations", "awards", "volunteer",
  "campus", "thesis", "competitions", "certificates", "custom_sections",
];
const LABEL: Record<string, string> = {
  job_intent: "求职意向", custom_sections: "自定义模块",
  ...Object.fromEntries(Object.entries(EXP).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(SIMPLE).map(([k, v]) => [k, v.label])),
};

function MonthCell({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const legacy = !!value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input type={legacy ? "text" : "month"} aria-label={label} value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-2.5 text-[14px] text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-0" />
        <Calendar className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Field>
  );
}

export function ExtraModules({ d, bump, link, errOf, touch }: {
  d: Resume; bump: () => void; link: (v?: string) => void;
  errOf: (path: string) => string | undefined; touch: (p: string) => void;
}) {
  const dd = d as Rec;
  const enabled = (key: string) => key !== "custom_sections" && dd[key] !== undefined;

  const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  const removeModule = (key: string, label: string) => {
    if (!window.confirm(`移除「${label}」将删除该模块已填内容，确定？`)) return;
    delete dd[key]; bump();
  };
  const add = (key: string) => {
    if (key === "job_intent") dd.job_intent = { positions: [], city: "" };
    else if (key === "custom_sections") (dd.custom_sections ??= []).push({ id: uid("cs"), title: "", content: "" });
    else if (EXP[key]) dd[key] = [expEntry(key)];   // 经历型：加一个空条目
    else dd[key] = [];                               // 简单型：空态（⊕ 新增）
    bump();
    scrollTo(`mod-${key}`);
  };
  const expEntry = (key: string): Rec => ({ id: uid(key), [EXP[key].nameKey]: "" });

  const removeBtn = (key: string, label: string) => (
    <button aria-label={`移除${label}`} onClick={() => removeModule(key, label)}
      className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive">
      <Trash2 className="h-4 w-4" />
    </button>
  );

  // 经历型模块节
  const expSection = (key: string) => {
    const cfg = EXP[key]; const arr = (dd[key] ?? []) as Rec[];
    return (
      <AccordionSection key={key} id={`mod-${key}`} title={cfg.label} right={removeBtn(key, cfg.label)}>
        {arr.map((it, i) => (
          <ItemCard key={it.id ?? i} title={it[cfg.nameKey] || `未填${cfg.nameLabel}`}
            onDelete={() => { arr.splice(i, 1); bump(); }}>
            <Field label={cfg.nameLabel} required error={errOf(`${key}[${i}].${cfg.nameKey}`)}>
              <BareInput aria-label={`${cfg.label} ${i + 1} ${cfg.nameLabel}`} value={it[cfg.nameKey] ?? ""} placeholder={cfg.namePh}
                onBlur={() => touch(`${key}[${i}].${cfg.nameKey}`)}
                onChange={(e) => { it[cfg.nameKey] = e.target.value; bump(); }} />
            </Field>
            {(cfg.extra ?? []).map(([fk, fl, ph]) => (
              <Field key={fk} label={fl}>
                <BareInput aria-label={`${cfg.label} ${i + 1} ${fl}`} value={it[fk] ?? ""} placeholder={ph}
                  onChange={(e) => { it[fk] = e.target.value; bump(); }} />
              </Field>
            ))}
            {cfg.range && (
              <MonthRange label="时间" start={it.startDate} end={it.endDate} error={errOf(`${key}[${i}].endDate`)}
                onStart={(v) => { it.startDate = v; bump(); }} onEnd={(v) => { it.endDate = v; bump(); }} />
            )}
            {cfg.date && <MonthCell label="时间" value={it.date} onChange={(v) => { it.date = v; bump(); }} />}
            <RichTextarea value={it.description} placeholder="请填写描述" polishKind={POLISH_KIND[key]}
              genContext={[it[cfg.nameKey], ...(cfg.extra ?? []).map(([fk]) => it[fk])].filter(Boolean).join(" · ")}
              onFocus={() => link(it.description)}
              onChange={(v) => { it.description = v; bump(); }} />
          </ItemCard>
        ))}
        <AddButton label={cfg.addLabel} onClick={() => { arr.push(expEntry(key)); dd[key] = arr; bump(); }} />
      </AccordionSection>
    );
  };

  // 简单模块节（荣誉/证书）
  const simpleSection = (key: string) => {
    const cfg = SIMPLE[key]; const arr = (dd[key] ?? []) as Rec[];
    return (
      <AccordionSection key={key} id={`mod-${key}`} title={cfg.label} right={removeBtn(key, cfg.label)}>
        {arr.map((it, i) => (
          <ItemCard key={it.id ?? i} title={it[cfg.fields[0][0]] || `未填${cfg.fields[0][1]}`}
            onDelete={() => { arr.splice(i, 1); bump(); }}>
            {cfg.fields.map(([fk, fl, ph, req, kind]) => kind === "date"
              ? <MonthCell key={fk} label={fl} value={it[fk]} onChange={(v) => { it[fk] = v; bump(); }} />
              : (
                <Field key={fk} label={fl} required={req} error={req ? errOf(`${key}[${i}].${fk}`) : undefined}>
                  <BareInput aria-label={`${cfg.label} ${i + 1} ${fl}`} value={it[fk] ?? ""} placeholder={ph}
                    maxLength={fk === "summary" ? 100 : undefined}
                    onBlur={req ? () => touch(`${key}[${i}].${fk}`) : undefined}
                    onChange={(e) => { it[fk] = e.target.value; bump(); }} />
                </Field>
              ))}
          </ItemCard>
        ))}
        <AddButton label={cfg.addLabel} onClick={() => { arr.push({ id: uid(key) }); dd[key] = arr; bump(); }} />
      </AccordionSection>
    );
  };

  // 求职意向节
  const jobIntentSection = () => {
    const ji = (dd.job_intent ?? {}) as Rec;
    return (
      <AccordionSection key="job_intent" id="mod-job_intent" title="求职意向" right={removeBtn("job_intent", "求职意向")}>
        <TagInput label="求职岗位" tags={ji.positions ?? []} max={5} maxLen={20}
          placeholder="请填写意向岗位，输入后回车添加"
          onChange={(t) => { ji.positions = t; dd.job_intent = ji; bump(); }} />
        <Field label="求职城市">
          <BareInput aria-label="求职城市" value={ji.city ?? ""} placeholder="请填写求职城市"
            onChange={(e) => { ji.city = e.target.value; dd.job_intent = ji; bump(); }} />
        </Field>
      </AccordionSection>
    );
  };

  // 自定义模块（每条一节，标题可编辑）
  const customSections = () => ((dd.custom_sections ?? []) as Rec[]).map((cs, i) => (
    <AccordionSection key={cs.id ?? i} id={`mod-custom-${cs.id}`} title={cs.title || "自定义模块"}
      right={
        <button aria-label="移除该自定义模块" onClick={() => {
          if (!window.confirm("移除该自定义模块将删除其内容，确定？")) return;
          (dd.custom_sections as Rec[]).splice(i, 1);
          if (!(dd.custom_sections as Rec[]).length) delete dd.custom_sections;
          bump();
        }} className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>}>
      <Field label="模块标题" required error={errOf(`custom_sections[${i}].title`)}>
        <BareInput aria-label={`自定义模块 ${i + 1} 标题`} value={cs.title ?? ""} placeholder="请输入模块标题" maxLength={10}
          onBlur={() => touch(`custom_sections[${i}].title`)}
          onChange={(e) => { cs.title = e.target.value; bump(); }} />
      </Field>
      <RichTextarea value={cs.content} placeholder="请输入模块正文" polishKind="custom"
        genContext={cs.title || undefined}
        onFocus={() => link(cs.content)}
        onChange={(v) => { cs.content = v; bump(); }} />
    </AccordionSection>
  ));

  const panelCards = PANEL.filter((k) => k === "custom_sections" || !enabled(k));

  return (
    <>
      {enabled("job_intent") && jobIntentSection()}
      {Object.keys(EXP).filter(enabled).map(expSection)}
      {Object.keys(SIMPLE).filter(enabled).map(simpleSection)}
      {customSections()}

      {/* 添加模块面板 */}
      <section className="px-5 py-5">
        <h3 className="text-[16px] leading-6 font-semibold text-foreground">添加模块</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {panelCards.map((k) => (
            <button key={k} onClick={() => add(k)}
              className={cn("flex items-center justify-between rounded-[10px] border border-border px-4 py-3.5 text-left",
                "text-[14px] text-foreground transition hover:border-muted-foreground hover:bg-accent/30")}>
              {LABEL[k]}
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
