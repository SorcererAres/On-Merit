// 与后端 app.py 契约一一对应的 TS 类型（本地手写；试点补 OpenAPI codegen）

export interface Basics {
  name?: string; email?: string; phone?: string; url?: string; summary?: string;
  location?: { city?: string }; profiles?: { network?: string; url?: string }[];
  meta?: Record<string, unknown>;
  // 编辑表单 v3 新增（见 docs/plans/resume-edit-form-v3.md）
  gender?: "male" | "female"; birthMonth?: string; wechat?: string;
  hometown?: string; tags?: string[];
}
export interface Work {
  name?: string; position?: string; startDate?: string; endDate?: string;
  summary?: string; highlights?: string[]; url?: string;
  description?: string;   // v3 富文本；存在则优先于 summary/highlights
}
export interface Skill { name?: string; level?: string; keywords?: string[] }
export interface Education {
  institution?: string; studyType?: string; area?: string; score?: string;
  startDate?: string; endDate?: string;
  studyMode?: "full_time" | "part_time"; description?: string;   // v3 新增
}
export interface Project {
  name?: string; url?: string; description?: string; technologies?: string[];
  role?: string; startDate?: string; endDate?: string;   // v3 新增
}
// v3 扩展模块条目
export interface JobIntent { positions?: string[]; city?: string }
export interface OrgEntry { name?: string; role?: string; startDate?: string; endDate?: string; description?: string }
export interface VolunteerEntry {
  organization?: string; position?: string; summary?: string; highlights?: string[];
  startDate?: string; endDate?: string; description?: string;
}
export interface CampusEntry { name?: string; startDate?: string; endDate?: string; description?: string }
export interface ThesisEntry { title?: string; date?: string; description?: string }
export interface CompetitionEntry { name?: string; award?: string; date?: string; description?: string }
export interface AwardEntry { title?: string; awarder?: string; date?: string; summary?: string; note?: string }
export interface CustomSection { id?: string; title?: string; content?: string }
export interface Resume {
  basics?: Basics; work?: Work[]; projects?: Project[]; skills?: Skill[];
  education?: Education[]; certificates?: unknown[]; meta?: Record<string, unknown>;
  // v3 新增
  skills_md?: string; job_intent?: JobIntent; internships?: Work[];
  organizations?: OrgEntry[]; volunteer?: VolunteerEntry[]; campus?: CampusEntry[];
  thesis?: ThesisEntry[]; competitions?: CompetitionEntry[]; awards?: AwardEntry[];
  custom_sections?: CustomSection[]; modules_order?: string[];
  [k: string]: unknown;
}

export interface Warning { severity: string; message: string; path?: string }

export interface Requirement { text: string; category: string; importance: "must" | "nice" }
export interface Match { coverage: "covered" | "partial" | "missing"; evidence: string; suggestion: string; grounded: boolean }
export interface MatchSummary {
  total: number; covered: number; partial: number; missing: number;
  coverage_pct: number; must_total: number; must_covered: number;
  must_have_gaps: string[]; must_risks: { text: string; coverage: string }[];
}
export interface MatchReport {
  requirements: Requirement[]; matches: Match[]; summary: MatchSummary; warnings: string[];
}

export interface Change { kind: "modified" | "added" | "removed"; path: string; old: string; new: string }
export interface ImproveResult {
  before: MatchReport; changes: Change[]; notes: string[]; must_supplements: string[];
}

export interface CategoryScore { score: number; max: number; evidence: string }
export interface Evaluation {
  scores: Record<string, CategoryScore>;
  bonus_points: { total: number; breakdown: string };
  deductions: { total: number; reasons: string };
  key_strengths: string[]; areas_for_improvement: string[];
}
export interface EvalResult {
  evaluation: Evaluation; score: number; max: number; gaps: string[]; role_label: string;
  dim_labels?: Record<string, string>;   // 维度机器键 → 人类可读标签
}

export interface ApiError {
  code: string; message: string; retryable: boolean; requestId?: string;
  fieldErrors?: Record<string, string>;
}
export interface Role { key: string; label: string }
export interface Patch { op: string; path: string; old: string | null; value: unknown }
export interface ApplyResult {
  resume: Resume; results: { path: string; status: string; error?: string }[];
  validation_errors: string[]; committed: boolean;
}
