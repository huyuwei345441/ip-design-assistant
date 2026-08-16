/**
 * 构建期脚本（Netlify build command 执行）
 * 把素材清单 / 规范文档 / CLI 脚本内联为 generated-data.js，
 * 供 Netlify Function 通过 require 加载（zisi 打包器会追踪 require 并打进函数包）
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), "utf-8");

// 递归收集 docs/ 下全部 .md，键为相对路径
function walkDocs(dir) {
  const out = {};
  const base = path.join(ROOT, dir);
  (function rec(d) {
    for (const name of fs.readdirSync(d)) {
      const fp = path.join(d, name);
      if (fs.statSync(fp).isDirectory()) rec(fp);
      else if (name.endsWith(".md")) out[path.relative(base, fp)] = fs.readFileSync(fp, "utf-8");
    }
  })(base);
  return out;
}

const data = {
  manifest: JSON.parse(read("assets/manifest.json")),
  docs: walkDocs("docs"),
  scripts: {
    "ask-check.js": read("scripts/ask-check.js"),
    "scene-match.js": read("scripts/scene-match.js"),
    "generate-prompt.js": read("scripts/generate-prompt.js")
  }
};

// U+2028/U+2029 会破坏旧 JS 字符串字面量，转义后再写入
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const out = "// 自动生成，勿手改（部署构建时由 build-data.js 重新生成）\nmodule.exports = " +
  JSON.stringify(data).split(LS).join("\\u2028").split(PS).join("\\u2029") + ";\n";

fs.writeFileSync(path.join(ROOT, "netlify/functions/generated-data.js"), out);
console.log("generated-data.js 生成完成: docs=" + Object.keys(data.docs).length +
  " 篇, 素材=" + data.manifest.length + " 条, 脚本=" + Object.keys(data.scripts).length + " 个");
