import { postJSON } from "@/lib/api";
import { withAiBusy } from "@/lib/aiBusy";
import { useStore } from "@/store/useStore";
import type { Resume, Skill } from "@/types";
import { marked, Renderer } from "marked";
import { toast } from "sonner";

type Rec = Record<string, any>;

export const INLINE_BASIC_FIELDS = [
  "name", "gender", "birthMonth", "hometown", "email", "phone", "wechat", "city", "url",
] as const;
export type InlineBasicField = (typeof INLINE_BASIC_FIELDS)[number];
export type CanvasInlineTarget =
  | { kind: "field"; id: InlineBasicField; label: string }
  | { kind: "subfield"; id: string; label: string; valueKind: "text" | "month" | "csv" }
  | { kind: "entry"; id: string; label: string };

export interface CanvasInlineSession {
  target: CanvasInlineTarget;
  node: HTMLElement;
  commit: () => boolean;
  cancel: () => void;
}

const POLISH_KIND: Record<string, string> = {
  "basics.summary": "summary", skills: "skills", work: "work", projects: "project", education: "edu",
  internships: "internship", organizations: "activity", volunteer: "activity", campus: "activity",
  thesis: "thesis", competitions: "competition", custom_sections: "custom",
};

const BASIC_META: Record<InlineBasicField, { placeholder: string; type?: "text" | "month" | "email" | "tel" | "url" }> = {
  name: { placeholder: "请输入姓名" }, gender: { placeholder: "请选择性别" },
  birthMonth: { placeholder: "选择出生年月", type: "month" }, hometown: { placeholder: "请输入籍贯城市" },
  email: { placeholder: "请输入邮箱", type: "email" }, phone: { placeholder: "请输入电话", type: "tel" },
  wechat: { placeholder: "请输入微信号" }, city: { placeholder: "请输入所在城市" },
  url: { placeholder: "请输入个人主页", type: "url" },
};

function skillsMarkdown(resume: Resume): string {
  if (typeof resume.skills_md === "string" && resume.skills_md.trim()) return resume.skills_md;
  return (resume.skills || []).map((skill: Skill) => {
    const name = skill.name?.trim() || "技能";
    const words = (skill.keywords || []).filter(Boolean).join("、");
    return `- **${name}**${words ? `：${words}` : ""}`;
  }).join("\n");
}

function descriptionFallback(item: Rec): string {
  if (typeof item.description === "string" && item.description.trim()) return item.description;
  const lines: string[] = [];
  if (item.summary) lines.push(String(item.summary));
  if (Array.isArray(item.highlights)) lines.push(...item.highlights.filter(Boolean).map((x: unknown) => `- ${String(x)}`));
  return lines.join("\n");
}

function initialDraft(resume: Resume, target: string): Rec {
  if (target === "basics.summary") return { content: resume.basics?.summary || "" };
  if (target === "skills") return { content: skillsMarkdown(resume) };
  if (target === "job_intent") return {
    positions: (resume.job_intent?.positions || []).join("、"), city: resume.job_intent?.city || "",
  };
  if (target === "metrics") {
    const rows = (((resume.meta as Rec | undefined)?.metrics || []) as Rec[]);
    return { content: rows.map((row) => [row.label, row.value, row.unit].filter(Boolean).join(" | ")).join("\n") };
  }
  const match = target.match(/^([a-z_]+)\.(\d+)$/);
  if (!match) return {};
  const [, section, rawIndex] = match;
  const item = ((resume as Rec)[section] || [])[Number(rawIndex)] as Rec | undefined;
  const draft = structuredClone(item || {});
  if (["work", "projects", "education", "internships", "organizations", "volunteer", "campus", "thesis", "competitions", "custom_sections"].includes(section)) {
    draft.description = section === "custom_sections" ? (draft.content || "") : descriptionFallback(draft);
  }
  if (section === "projects") draft.technologiesText = (draft.technologies || []).join("、");
  if (section === "awards" || section === "certificates") draft.description = draft.summary || draft.note || "";
  return draft;
}

function saveBasic(field: InlineBasicField, value: string) {
  const state = useStore.getState();
  if (!state.resume) return;
  const next = structuredClone(state.resume);
  const basics = (next.basics ??= {});
  if (field === "gender") {
    if (value === "male" || value === "female") basics.gender = value;
    else delete basics.gender;
  } else if (field === "city") {
    const location = (basics.location ??= {});
    if (value.trim()) location.city = value.trim();
    else {
      delete location.city;
      if (!Object.keys(location).length) delete basics.location;
    }
  } else {
    const key = field as Exclude<InlineBasicField, "gender" | "city">;
    if (value.trim()) (basics as Rec)[key] = value.trim();
    else delete (basics as Rec)[key];
  }
  state.editResumeFromPreview(next);
}

function saveSubfield(path: string, value: string, valueKind: "text" | "month" | "csv") {
  const state = useStore.getState();
  if (!state.resume) return;
  const [section, rawIndex, ...keyParts] = path.split(".");
  const key = keyParts.join(".");
  const index = Number(rawIndex);
  if (!section || !Number.isInteger(index) || !key) return;
  const next = structuredClone(state.resume) as Rec;
  const item = ((next[section] ??= []) as Rec[])[index];
  if (!item) return;
  const cleanValue = value.trim();
  if (valueKind === "csv") item[key] = cleanValue.split(/[、,，\n]/).map((part) => part.trim()).filter(Boolean);
  else if (key === "studyMode") item[key] = cleanValue === "全日制" ? "full_time" : cleanValue === "非全日制" ? "part_time" : undefined;
  else item[key] = cleanValue;
  state.editResumeFromPreview(next as Resume);
}

function saveEntry(target: string, draft: Rec) {
  const state = useStore.getState();
  if (!state.resume) return;
  const next = structuredClone(state.resume) as Rec;
  if (target === "basics.summary") {
    (next.basics ??= {}).summary = draft.content || "";
  } else if (target === "skills") {
    next.skills_md = draft.content || "";
  } else if (target === "job_intent") {
    const content = String(draft.content || "");
    const positionLine = content.split("\n").find((line) => /^意向岗位[：:]/.test(line.trim()));
    const cityLine = content.split("\n").find((line) => /^意向城市[：:]/.test(line.trim()));
    next.job_intent = {
      positions: String(positionLine?.replace(/^\s*意向岗位[：:]\s*/, "") || content)
        .split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 5),
      city: String(cityLine?.replace(/^\s*意向城市[：:]\s*/, "") || "").trim(),
    };
  } else if (target === "metrics") {
    (next.meta ??= {}).metrics = String(draft.content || "").split("\n").map((line) => {
      const [label = "", value = "", unit = ""] = line.split("|").map((part) => part.trim());
      return { label, value, unit };
    }).filter((row) => row.label || row.value || row.unit);
  } else {
    const match = target.match(/^([a-z_]+)\.(\d+)$/);
    if (!match) return;
    const [, section, rawIndex] = match;
    const index = Number(rawIndex);
    const arr = (next[section] ??= []) as Rec[];
    const value = structuredClone(arr[index] || {});
    if (section === "custom_sections") {
      value.content = draft.description || "";
    } else if (section === "awards" || section === "certificates") value.summary = draft.description || "";
    else value.description = draft.description || "";
    arr[index] = value;
  }
  state.editResumeFromPreview(next as Resume);
}

function sectionOf(target: string) {
  return target.match(/^([a-z_]+)\.(\d+)$/)?.[1] || target;
}

function button(doc: Document, text: string, label: string, action: () => void) {
  const el = doc.createElement("button");
  el.type = "button";
  el.className = "canvas-inline-tool";
  el.textContent = text;
  el.setAttribute("aria-label", label);
  el.title = label;
  el.addEventListener("pointerdown", (event) => event.preventDefault());
  el.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); action(); });
  return el;
}

const editorRenderer = new Renderer();
editorRenderer.html = () => "";
const markdownToEditorHtml = (md: string) => marked.parse(md, { async: false, breaks: true, renderer: editorRenderer }) as string;

function editableToMarkdown(root: HTMLElement): string {
  const visit = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    const element = node as HTMLElement;
    const children = () => Array.from(element.childNodes).map(visit).join("");
    if (element.tagName === "BR") return "\n";
    if (element.tagName === "STRONG" || element.tagName === "B") return `**${children()}**`;
    if (element.tagName === "EM" || element.tagName === "I") return `*${children()}*`;
    if (element.tagName === "LI") return children().replace(/^\s+|\s+$/g, "");
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.children).map((item, index) =>
        `${element.tagName === "OL" ? `${index + 1}.` : "-"} ${visit(item)}`).join("\n") + "\n\n";
    }
    if (element.tagName === "P" || element.tagName === "DIV") return `${children()}\n\n`;
    return children();
  };
  return Array.from(root.childNodes).map(visit).join("")
    .replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function applyRichCommand(doc: Document, editable: HTMLElement, command: string) {
  editable.focus();
  doc.execCommand(command, false);
  const InputEventCtor = doc.defaultView?.InputEvent || InputEvent;
  editable.dispatchEvent(new InputEventCtor("input", { bubbles: true, inputType: "formatBold" }));
}

function createMonthPanel(doc: Document, anchor: HTMLElement, initialValue: string, onPick: (value: string) => void) {
  const panel = doc.createElement("div");
  panel.className = "canvas-month-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "选择年月");
  let year = Number(initialValue.slice(0, 4)) || new Date().getFullYear();
  const header = doc.createElement("div"); header.className = "canvas-month-header";
  const prev = button(doc, "‹", "上一年", () => { year -= 1; render(); });
  const title = doc.createElement("strong");
  const next = button(doc, "›", "下一年", () => { year += 1; render(); });
  header.append(prev, title, next);
  const grid = doc.createElement("div"); grid.className = "canvas-month-grid";
  panel.append(header, grid); doc.body.appendChild(panel);
  const render = () => {
    title.textContent = String(year);
    grid.replaceChildren();
    Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const value = `${year}-${String(month).padStart(2, "0")}`;
      const item = button(doc, `${month}月`, `选择${year}年${month}月`, () => onPick(value));
      item.classList.add("canvas-month-option");
      item.setAttribute("aria-pressed", String(value === initialValue));
      if (value === initialValue) item.classList.add("is-selected");
      grid.appendChild(item);
    });
  };
  render();
  const rect = anchor.getBoundingClientRect();
  const width = 276;
  const viewportWidth = doc.documentElement.clientWidth;
  panel.style.left = `${Math.max(12, Math.min(viewportWidth - width - 12, rect.left))}px`;
  panel.style.top = `${rect.bottom + 6}px`;
  return panel;
}

function buildBasicEditor(doc: Document, node: HTMLElement, target: CanvasInlineTarget & { kind: "field" }, value: string) {
  const meta = BASIC_META[target.id];
  let control: HTMLInputElement | HTMLSelectElement;
  if (target.id === "gender") {
    const select = doc.createElement("select");
    [["", "不填"], ["male", "男"], ["female", "女"]].forEach(([optionValue, label]) => {
      const option = doc.createElement("option"); option.value = optionValue; option.textContent = label; select.appendChild(option);
    });
    control = select;
  } else {
    const input = doc.createElement("input");
    input.type = meta.type || "text";
    input.placeholder = meta.placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    control = input;
  }
  control.className = `canvas-inline-basic${target.id === "name" ? " is-name" : ""}`;
  control.value = value;
  control.setAttribute("aria-label", target.label);
  node.replaceChildren(control);
  return control;
}

export function createCanvasInlineEditor({
  doc, node, target, pointer, onFinish, onResize,
}: {
  doc: Document;
  node: HTMLElement;
  target: CanvasInlineTarget;
  pointer?: { x: number; y: number };
  onFinish: () => void;
  onResize: () => void;
}): CanvasInlineSession | null {
  const state = useStore.getState();
  const resume = state.resume;
  if (!resume) return null;
  const originalHTML = node.innerHTML;
  const originalTabIndex = node.getAttribute("tabindex");
  const originalRole = node.getAttribute("role");
  const originalTitle = node.getAttribute("title");
  const originalAriaLabel = node.getAttribute("aria-label");
  let finished = false;
  let readValue: () => string = () => "";
  let readDraft: () => Rec = () => ({});
  let isDirty: () => boolean = () => false;
  let floatingPanel: HTMLElement | null = null;
  let floatingToolbar: HTMLElement | null = null;
  let toolbarCleanup: (() => void) | null = null;

  node.classList.add("is-inline-selected", "is-canvas-editing");
  node.removeAttribute("role");
  node.removeAttribute("title");

  if (target.kind === "field") {
    const basics = resume.basics || {};
    const value = target.id === "city" ? basics.location?.city || ""
      : target.id === "gender" ? basics.gender || ""
      : String((basics as Rec)[target.id] ?? "");
    const control = buildBasicEditor(doc, node, target, value);
    readValue = () => control.value;
    isDirty = () => readValue() !== value;
    if (target.id === "birthMonth" && control.tagName === "INPUT") {
      const monthInput = control as HTMLInputElement;
      monthInput.type = "text";
      monthInput.readOnly = true;
      floatingPanel = createMonthPanel(doc, monthInput, value, (picked) => {
        monthInput.value = picked;
        session.commit();
      });
    }
    requestAnimationFrame(() => {
      control.focus();
      if (control.tagName === "INPUT" && target.id !== "birthMonth") (control as HTMLInputElement).select();
    });
  } else if (target.kind === "subfield") {
    const value = node.textContent || "";
    let currentValue = value;
    readValue = () => currentValue;
    isDirty = () => currentValue.trim() !== value.trim();
    node.classList.add("canvas-inline-subfield");
    if (target.valueKind === "month") {
      node.setAttribute("role", "textbox");
      node.setAttribute("aria-label", target.label);
      floatingPanel = createMonthPanel(doc, node, value, (picked) => {
        currentValue = picked;
        node.textContent = picked;
        session.commit();
      });
    } else {
      node.contentEditable = "true";
      node.spellcheck = false;
      node.setAttribute("role", "textbox");
      node.setAttribute("aria-label", target.label);
      node.addEventListener("input", () => { currentValue = node.textContent || ""; onResize(); });
      requestAnimationFrame(() => {
        node.focus();
        const selection = doc.getSelection();
        if (selection) { const range = doc.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range); }
      });
    }
  } else {
    const section = sectionOf(target.id);
    const draft = initialDraft(resume, target.id);
    const bodyNode = node.querySelector<HTMLElement>("[data-resume-entry-body]");
    if (!bodyNode) return null;
    const richWrap = doc.createElement("div"); richWrap.className = "canvas-inline-rich";
    const toolbar = doc.createElement("div"); toolbar.className = "canvas-inline-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "文字格式");
    bodyNode.classList.add("canvas-inline-content");
    bodyNode.contentEditable = "true";
    bodyNode.spellcheck = false;
    bodyNode.setAttribute("role", "textbox");
    bodyNode.setAttribute("aria-multiline", "true");
    bodyNode.setAttribute("aria-label", `编辑${target.label}正文`);
    bodyNode.dataset.placeholder = target.id === "metrics" ? "每行填写：指标 | 数值 | 单位" : "直接在这里编辑内容";
    if (!bodyNode.textContent?.trim()) bodyNode.innerHTML = "<p><br></p>";
    toolbar.append(
      button(doc, "B", "加粗", () => applyRichCommand(doc, bodyNode, "bold")),
      button(doc, "I", "斜体", () => applyRichCommand(doc, bodyNode, "italic")),
      button(doc, "U", "下划线", () => applyRichCommand(doc, bodyNode, "underline")),
      button(doc, "•", "无序列表", () => applyRichCommand(doc, bodyNode, "insertUnorderedList")),
      button(doc, "1.", "有序列表", () => applyRichCommand(doc, bodyNode, "insertOrderedList")),
    );
    const kind = POLISH_KIND[section];
    if (kind) {
      toolbar.append(button(doc, "AI生成", "AI 生成", async () => {
        const active = bodyNode;
        try {
          const current = useStore.getState();
          const result = await withAiBusy("edit", (signal) =>
            postJSON<{ md: string; mode: "extract" | "template" }>("/api/generate-field", {
              kind, source_text: current.sourceText || undefined, entry_context: target.label,
            }, signal));
          if (!result || finished || !active.isConnected) return;
          active.innerHTML = markdownToEditorHtml(result.md.slice(0, 1000)); onResize();
          toast.success(result.mode === "template" ? "已插入结构模板，请填写真实经历" : "已插入原件提取内容，请核实");
        } catch (error) { toast.error((error as Error).message || "生成失败，请重试"); }
      }));
      toolbar.append(button(doc, "AI润色", "AI 润色", async () => {
        const original = editableToMarkdown(bodyNode);
        if (original.length < 10) { toast.message("至少填写 10 个字后再润色"); return; }
        const active = bodyNode;
        try {
          const current = useStore.getState();
          const result = await withAiBusy("polish", (signal) =>
            postJSON<{ md: string }>("/api/polish-field", {
              text: original, kind, jd: current.jd?.trim() || undefined,
            }, signal));
          if (!result || finished || !active.isConnected || editableToMarkdown(active) !== original) {
            if (result) toast.message("内容已变化，请重新润色");
            return;
          }
          active.innerHTML = markdownToEditorHtml(result.md.slice(0, 1000)); onResize();
          toast.success("已应用润色，请核实内容");
        } catch (error) { toast.error((error as Error).message || "润色失败，请重试"); }
      }));
    }
    bodyNode.addEventListener("input", onResize);
    bodyNode.before(richWrap);
    richWrap.append(bodyNode);
    doc.body.appendChild(toolbar);
    floatingToolbar = toolbar;
    let toolbarHovered = false;
    let frame = 0;
    const placeToolbar = (x: number, y: number) => {
      const rect = toolbar.getBoundingClientRect();
      const viewportWidth = doc.documentElement.clientWidth;
      const viewportHeight = doc.documentElement.clientHeight;
      const left = Math.max(10, Math.min(viewportWidth - rect.width - 10, x - rect.width / 2));
      const above = y - rect.height - 14;
      const top = above >= 10 ? above : Math.min(viewportHeight - rect.height - 10, y + 16);
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${Math.max(10, top)}px`;
      toolbar.style.visibility = "visible";
    };
    const followPointer = (event: PointerEvent) => {
      if (toolbarHovered || event.pointerType === "touch" || !bodyNode.contains(event.target as Node)) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => placeToolbar(event.clientX, event.clientY));
    };
    const pauseFollow = () => { toolbarHovered = true; };
    const resumeFollow = () => { toolbarHovered = false; };
    doc.addEventListener("pointermove", followPointer, { passive: true });
    toolbar.addEventListener("pointerenter", pauseFollow);
    toolbar.addEventListener("pointerleave", resumeFollow);
    toolbarCleanup = () => {
      doc.removeEventListener("pointermove", followPointer);
      toolbar.removeEventListener("pointerenter", pauseFollow);
      toolbar.removeEventListener("pointerleave", resumeFollow);
      window.cancelAnimationFrame(frame);
    };
    readDraft = () => {
      const next = structuredClone(draft);
      const content = editableToMarkdown(bodyNode);
      if (target.id === "basics.summary" || target.id === "skills" || target.id === "metrics" || target.id === "job_intent") next.content = content;
      else next.description = content;
      return next;
    };
    const initialMarkdown = editableToMarkdown(bodyNode);
    isDirty = () => editableToMarkdown(bodyNode) !== initialMarkdown;
    requestAnimationFrame(() => {
      onResize();
      bodyNode.focus();
      const rect = bodyNode.getBoundingClientRect();
      placeToolbar(pointer?.x ?? rect.left + rect.width / 2, pointer?.y ?? rect.top + 24);
    });
  }

  const restore = () => {
    floatingPanel?.remove();
    toolbarCleanup?.();
    floatingToolbar?.remove();
    node.innerHTML = originalHTML;
    node.classList.remove("canvas-inline-subfield", "is-inline-selected", "is-canvas-editing");
    node.contentEditable = "inherit";
    node.spellcheck = true;
    if (originalTabIndex === null) node.removeAttribute("tabindex"); else node.setAttribute("tabindex", originalTabIndex);
    if (originalRole === null) node.removeAttribute("role"); else node.setAttribute("role", originalRole);
    if (originalTitle === null) node.removeAttribute("title"); else node.setAttribute("title", originalTitle);
    if (originalAriaLabel === null) node.removeAttribute("aria-label"); else node.setAttribute("aria-label", originalAriaLabel);
  };
  const finish = (save: boolean) => {
    if (finished) return false;
    finished = true;
    const changed = save && isDirty();
    // 先恢复正式简历 DOM：即使数据未变化、srcDoc 不会重挂，也必须退出编辑态。
    restore();
    onFinish();
    if (changed) {
      if (target.kind === "field") saveBasic(target.id, readValue());
      else if (target.kind === "subfield") saveSubfield(target.id, readValue(), target.valueKind);
      else saveEntry(target.id, readDraft());
    }
    onResize();
    return changed;
  };
  const session: CanvasInlineSession = {
    target, node,
    commit: () => finish(true),
    cancel: () => finish(false),
  };
  node.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); session.cancel(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey || target.kind !== "entry")) {
      event.preventDefault(); event.stopPropagation(); session.commit();
    }
  });
  return session;
}
