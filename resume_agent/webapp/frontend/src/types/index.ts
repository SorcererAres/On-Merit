// 与后端 app.py 契约一一对应的 TS 类型（本地手写；试点补 OpenAPI codegen）

export interface Basics {
  name?: string; email?: string; phone?: string; url?: string; summary?: string;
  location?: { city?: string }; profiles?: { network?: string; url?: string }[];
  meta?: Record<string, unknown>;
}
export interface Work {
  name?: string; position?: string; startDate?: string; endDate?: string;
  summary?: string; highlights?: string[]; url?: string;
}
export interface Skill { name?: string; level?: string; keywords?: string[] }
export interface Education {
  institution?: string; studyType?: string; area?: string; score?: string;
  startDate?: string; endDate?: string;
}
export interface Project { name?: string; url?: string; description?: string; technologies?: string[] }
export interface Resume {
  basics?: Basics; work?: Work[]; projects?: Project[]; skills?: Skill[];
  education?: Education[]; certificates?: unknown[]; meta?: Record<string, unknown>;
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
