#!/usr/bin/env node
/**
 * 场景决策引擎
 * 数据来源：ip设计助手skill/IP 应用规范文档/
 * Usage: node scripts/scene-match.js "<场景描述>"
 */

const input = process.argv[2] || "";

// 弹窗配置表 — 来源：与弹窗结合规范.md
const POPUP_TABLE = {
  "确认弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 说明 + 按钮" },
  "提示弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 说明 + 按钮" },
  "活动弹窗": { position: "弹窗上方，可破形", height: "200-400px", layout: "IP + 标题 + 内容 + 按钮" },
  "营销弹窗": { position: "弹窗上方，可破形", height: "200-400px", layout: "IP + 标题 + 内容 + 按钮" },
  "Toast": { position: "容器内左侧或内右侧", height: "高度不小于100px", layout: "IP + 文案" },
  "轻提示": { position: "容器内左侧或内右侧", height: "高度不小于100px", layout: "IP + 文案" },
  "底部弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 列表 + 按钮" }
};

// 缺省页 — 来源：缺省页与结果页应用规范.md（32px栅格等比放大）
const EMPTY_STATE = {
  note: "基于32px栅格比例等比放大",
};

// 流程可用性 — 来源：流程可用性规范.md
const BLOCKED_SCENES = /支付流程|密码|验证码|人脸|生物识别|协议|合同签署|风险提示|风险披露|500|系统错误|数据报表|详情页/;
const CONDITIONAL_SCENES = /浮标|悬浮入口|下拉刷新/;

// 文案库 — 来源：缺省页与结果页应用规范.md（原文案）
const COPYWRITING = [
  { keywords: /加载失败/, text: "即使暂时停滞，也是前进路上的小憩" },
  { keywords: /网络异常|断线|网络.*异常|无网络/, text: "即使网络暂时断线，我们的连接永不中断" },
  { keywords: /暂无数据|无数据|没有数据|空.*数据/, text: "空白也是一种美，等待被探索和填充" },
  { keywords: /暂无身份|无身份|未认证/, text: "暂时的迷茫，是发现自我的开始" },
  { keywords: /成功|完成|通过/, text: "星光不问赶路人，时光不负有心人" },
  { keywords: /额度|权益|信用/, text: "每一份额度，都是向未来的一次勇敢迈步" },
  { keywords: /保障|维稳/, text: "在风雨和阳光中，我们一直在你身边" },
  { keywords: /等待|审核|加载中/, text: "每一刻等待，都是未来的铺垫" },
  { keywords: /失败|错误|异常|超时/, text: "失败不是终点，而是另一个开始的机会" },
];

// 约束 — 来源：与弹窗结合规范.md + 在页面中的应用规范.md
const CONSTRAINTS = [
  "超出弹窗 ≤ 自身高度1/3",
  "距标题文字 ≥ 32px",
  "关闭按钮热区 88x88px",
  "按钮及上方16px不可遮挡",
  "每页 ≤ 1处（浮标除外）",
  "动画 ≤ 5秒",
];

function detectPopupType(text) {
  for (const [type, config] of Object.entries(POPUP_TABLE)) {
    if (text.includes(type)) return { type, ...config };
  }
  return null;
}

function detectEmptyState(text) {
  if (/缺省|空状态|无数据|暂无|没有数据|空白页/.test(text)) return true;
  return false;
}

function flowCheck(text) {
  if (BLOCKED_SCENES.test(text)) return { allowed: false, level: "🚫 不可用" };
  if (CONDITIONAL_SCENES.test(text)) return { allowed: "conditional", level: "⚠️ 条件可用" };
  return { allowed: true, level: "✅ 可用" };
}

function matchCopywriting(text) {
  for (const item of COPYWRITING) {
    if (item.keywords.test(text)) return item.text;
  }
  return null;
}

function match(scene) {
  const popup = detectPopupType(scene);
  const is_empty = detectEmptyState(scene);
  const is_popup = /弹窗|弹框|dialog|modal|popup|Toast|轻提示/.test(scene);
  const flow = flowCheck(scene);
  const copywriting = matchCopywriting(scene);

  let sceneType = "通用场景";
  let config = null;

  if (popup) {
    sceneType = "弹窗场景";
    config = { 弹窗类型: popup.type, IP位置: popup.position, 高度弹性区间: popup.height, 组合模式: popup.layout };
  } else if (is_popup) {
    sceneType = "弹窗场景";
    config = { 高度弹性区间: "200-400px", IP位置: "弹窗上方居右或居中，可破形" };
  } else if (is_empty) {
    sceneType = "缺省页场景";
    config = { 说明: EMPTY_STATE.note };
  }

  return {
    input: scene,
    sceneType,
    config,
    flowAvailability: flow,
    copywriting: copywriting || "请参照规范文档中的文案库选择",
    constraints: CONSTRAINTS
  };
}

console.log(JSON.stringify(match(input), null, 2));
