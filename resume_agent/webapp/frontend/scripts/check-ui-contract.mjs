import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// fileURLToPath 才能正确解码路径中的空格等转义字符（URL.pathname 会保留 %20）
const root = fileURLToPath(new URL("../src/", import.meta.url));
const findings = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path;
  }));
  return files.flat();
}

function report(file, source, rule, pattern) {
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(`${relative(root, file)}:${line}  ${rule}: ${match[0]}`);
  }
}

for (const file of await walk(root)) {
  if (extname(file) !== ".tsx") continue;
  const source = await readFile(file, "utf8");
  const path = relative(root, file);

  // shadcn 基础组件内部必须落到原生元素；业务与组合组件不得绕过它们。
  if (path !== "components/ui/button.tsx") {
    report(file, source, "请使用 shadcn Button", /<button\b/g);
  }
  if (path !== "components/ui/input.tsx") {
    report(file, source, "请使用 shadcn Input/Textarea", /<(?:input|textarea|select)\b/g);
  }

  report(file, source, "尺寸必须使用设计 Token", /(?:^|\s)(?:w|h|min-w|max-w|min-h|max-h|gap|mt|mb|ml|mr|p|px|py|top|right|bottom|left)-\[[^\]]+\]/gm);
  report(file, source, "颜色必须使用设计 Token", /#[0-9a-fA-F]{3,8}\b/g);
  report(file, source, "cn 必须从 @\/lib\/cn 导入", /@\/lib\/utils/g);
}

if (findings.length) {
  console.error("前端 UI 规范检查失败：\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("前端 UI 规范检查通过：业务 TSX 无原生控件、硬编码颜色或尺寸型任意值。");
