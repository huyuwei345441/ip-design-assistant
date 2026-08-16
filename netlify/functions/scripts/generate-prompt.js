#!/usr/bin/env node
/**
 * 提示词生成器
 * 参照历史优质 prompt 格式（来源：ip设计助手skill/历史优质prompt/）
 * Usage: node scripts/generate-prompt.js --scene <场景> [可选参数...]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].replace("--", "");
      const val = args[i + 1];
      if (val && !val.startsWith("--")) { params[key] = val; i++; }
      else { params[key] = true; }
    }
  }
  return params;
}

/**
 * 参照历史优质 prompt 的结构：
 * - 主体描述 + 表情 + 动作 + 道具 + 穿搭 + 背景 + 光线 + 渲染风格 + 构图 + 固定约束
 * 每部分由用户指定或留空
 */
function buildPrompt(params) {
  const parts = [];

  // 主体
  parts.push("参考图中的卡通形象");

  // 表情
  if (params.expression) parts.push(params.expression);

  // 动作
  if (params.action) parts.push(params.action);

  // 道具
  if (params.prop) parts.push(params.prop);

  // 穿搭
  if (params.outfit) parts.push(`，穿${params.outfit}`);

  // 背景
  if (params.background) {
    parts.push(`，${params.background}`);
  } else {
    parts.push("，纯色简洁背景");
  }

  // 光线
  parts.push("，柔和均匀人工光");

  // 渲染风格
  parts.push("，3D软萌治愈系渲染");

  // 构图
  if (params.composition) {
    parts.push(`，${params.composition}`);
  } else {
    parts.push("，平视中景居中展示");
  }

  // 固定约束（来自历史 prompt 中的统一尾部描述）
  parts.push("，整体可爱Q版形象特征严格参考参考图，不做改变");

  // 额外描述
  if (params.extra) parts.push(`，${params.extra}`);

  return parts.join("");
}

function main() {
  const params = parseArgs();

  if (!params.scene) {
    console.log(JSON.stringify({
      error: "缺少必填参数",
      required: ["--scene"],
      optional: ["--expression", "--action", "--prop", "--outfit", "--background", "--composition", "--extra"],
      usage: "node scripts/generate-prompt.js --scene <场景描述> [--expression <表情>] [--action <动作>] [--prop <道具>] [--outfit <穿搭>] [--background <背景描述>] [--composition <构图>] [--extra <额外描述>]"
    }, null, 2));
    return;
  }

  const prompt = buildPrompt(params);
  console.log(JSON.stringify({ prompt, params }, null, 2));
}

main();
