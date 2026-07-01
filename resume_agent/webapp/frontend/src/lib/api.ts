// fetch 封装：结构化错误信封 + AbortController（「停止等待」）。
import type { ApiError } from "@/types";

export class ApiErr extends Error {
  code: string; retryable: boolean; requestId?: string; fieldErrors?: Record<string, string>;
  constructor(e: ApiError) {
    super(e.message);
    this.code = e.code; this.retryable = e.retryable;
    this.requestId = e.requestId; this.fieldErrors = e.fieldErrors;
  }
}

async function parse<T>(r: Response): Promise<T> {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // 结构化信封；兜底旧格式
    throw new ApiErr(
      data.code ? data : { code: "HTTP_" + r.status, message: data.detail || data.message || r.statusText, retryable: r.status >= 500 },
    );
  }
  return data as T;
}

export function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  }).then((r) => parse<T>(r));
}

export function postForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return fetch(path, { method: "POST", body: form, signal }).then((r) => parse<T>(r));
}

export function getJSON<T>(path: string): Promise<T> {
  return fetch(path).then((r) => parse<T>(r));
}
