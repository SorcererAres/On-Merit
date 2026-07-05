// 共享必填/顺序校验（见 resume-edit-form-v3.md §四.3）：表单失焦红框与 EditorPage 诊断/下载
// 前黄条共用同一函数；store.resume 即唯一真相，无跨组件状态。校验不阻断 autosave（草稿照存）。
import type { Resume } from "@/types";

export interface FormIssue { path: string; sectionKey: string; msg: string }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const has = (s?: string) => !!(s && s.trim());
// 两端均为年月格式时才比较顺序（旧自由文本/「至今」放行）
function badOrder(start?: string, end?: string): boolean {
  return !!(start && end && MONTH.test(start) && MONTH.test(end) && start > end);
}

export function validateResumeForm(resume: Resume | null): FormIssue[] {
  if (!resume) return [];
  const out: FormIssue[] = [];
  const b = resume.basics || {};

  if (!has(b.name)) out.push({ path: "basics.name", sectionKey: "basics", msg: "请填写姓名" });
  if (!has(b.phone) && !has(b.email) && !has(b.wechat))
    out.push({ path: "basics.contact", sectionKey: "basics", msg: "请至少填写一项联系方式（电话/微信/邮箱）" });

  const checkList = (arr: unknown[] | undefined, sectionKey: string, label: string,
                     nameField: string, dateFields?: [string, string]) => {
    (arr || []).forEach((it, i) => {
      const item = it as Record<string, string>;
      if (!has(item[nameField]))
        out.push({ path: `${sectionKey}[${i}].${nameField}`, sectionKey, msg: `${label} 第 ${i + 1} 条：${label==="教育经历"?"请填写学校":label==="工作经历"?"请填写公司名称":"请填写名称"}` });
      if (dateFields && badOrder(item[dateFields[0]], item[dateFields[1]]))
        out.push({ path: `${sectionKey}[${i}].${dateFields[1]}`, sectionKey, msg: `${label} 第 ${i + 1} 条：结束时间早于开始时间` });
    });
  };

  checkList(resume.education, "education", "教育经历", "institution", ["startDate", "endDate"]);
  checkList(resume.work, "work", "工作经历", "name", ["startDate", "endDate"]);
  checkList(resume.projects, "projects", "项目经历", "name", ["startDate", "endDate"]);
  // 扩展模块必填名
  checkList(resume.internships, "internships", "实习经历", "name", ["startDate", "endDate"]);
  checkList(resume.organizations, "organizations", "学生会/社团", "name", ["startDate", "endDate"]);
  checkList(resume.volunteer, "volunteer", "志愿者活动", "organization", ["startDate", "endDate"]);
  checkList(resume.campus, "campus", "校园大使", "name", ["startDate", "endDate"]);
  checkList(resume.thesis, "thesis", "毕业设计", "title");
  checkList(resume.competitions, "competitions", "学术竞赛", "name");
  checkList(resume.awards, "awards", "所获荣誉", "title");
  checkList(resume.custom_sections, "custom_sections", "自定义模块", "title");

  return out;
}
