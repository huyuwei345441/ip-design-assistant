#!/usr/bin/env node
/**
 * 规范顾问 — 三合一引擎
 * 自动识别模式：查规范 / 合规检查 / 场景决策
 * Usage: node scripts/ask-check.js "<问题>"
 *        node scripts/ask-check.js --check "<描述>"
 */

const input = process.argv.slice(2).join(" ");

// ── 模式识别 ──
const SCENE_KEYWORDS = /场景.*决策|场景.*配置|怎么.*配置|如何.*配置|怎么.*放|怎么.*排|弹窗.*怎么|空状态|缺省|结果页|Toast|轻提示|底部弹窗|活动弹窗|营销弹窗|状态图例|浮标|下拉刷新|加载|默认|首页/;
const CHECK_KEYWORDS = /--check|合规|检查|遮挡|违规|挡住|错误|审查|能不能|可不可以|是否.*可以|合规.*检查/;
const SCENE_STRONG = /场景决策|场景.*配置|弹窗.*配置|配置.*IP|怎么配|如何配/;

let mode = "ask";
let query = input;

// 显式 --check 标记
if (input.startsWith("--check")) {
  mode = "check";
  query = input.replace("--check", "").trim();
}
// 强场景信号优先
else if (SCENE_STRONG.test(input) || (SCENE_KEYWORDS.test(input) && !CHECK_KEYWORDS.test(input))) {
  mode = "scene";
}
// 合规检查信号
else if (CHECK_KEYWORDS.test(input)) {
  mode = "check";
}

// ── 知识库 ──
const KNOWLEDGE = [
  // 弹窗/UI 规范
  { q: /弹窗.*尺寸|弹窗.*大小|弹窗.*多大/, a: "弹窗IP高度弹性区间为200-400px。" },
  { q: /IP.*离.*关闭|关闭.*距离|关闭.*多远|关闭按钮.*IP|IP.*关闭按钮/, a: "关闭按钮热区范围为88x88px，IP任何部分不得进入此区域。IP下沿距离标题文字>=32px。" },
  { q: /破形|超出.*多少|超出.*上沿|超出.*1\/3|能超出/, a: "IP可适度超出弹窗上沿进行破形排列，但超出高度严格控制在IP自身高度的1/3以内。" },
  { q: /按钮.*遮挡|遮挡.*按钮|不.*挡.*按钮|按钮.*上方/, a: "IP不得遮挡主操作按钮及其上方16px区域。" },
  { q: /弹窗.*位置|IP.*放在|IP.*放哪|弹窗.*IP.*在哪|IP.*在哪|IP.*位置/, a: "确认弹窗/提示弹窗：IP在弹窗上方居右或居中，可破形。活动/营销弹窗：IP在弹窗上方，可破形。Toast：容器内左侧或内右侧。底部弹窗：弹窗上方居右或居中，可破形。" },
  { q: /Toast.*IP|轻提示.*IP/, a: "Toast中IP位于容器内左侧或内右侧，高度不小于100px，组合模式为IP+文案。" },
  { q: /几个.*IP|多少.*IP|IP.*几个|IP.*次数|数量.*限制/, a: "同一页面内IP出现次数不超过1处（浮标除外）。" },
  { q: /动画.*多久|动画.*时长|动画.*秒|动画.*几秒/, a: "IP动画时长不超过5秒。" },
  { q: /遮挡|挡住|挡到|遮盖/, a: "IP形象不得遮挡关键信息文本、按钮、导航元素。IP色彩需与页面整体色调协调。" },
  { q: /什么.*不能用|什么.*禁止|不可用|不可使用|哪些.*不能|哪些.*流程|流程.*哪些|ui.*流程|可用.*列表|可用.*场景|支付.*能用|密码.*能用|可以.*放.*吗/, a: "以下场景不可用IP：支付流程、密码/验证码输入、人脸/生物识别、协议/合同签署、风险提示/披露、500/系统错误、数据报表/详情页。以下场景条件可用：浮标/悬浮入口（需产品经理确认）、下拉刷新。" },
  { q: /哪些.*能用|哪些.*可用|哪些.*可以|什么.*可用|什么.*能用|可用.*哪些|能用.*哪些|IP.*能.*用|能用.*IP|可以.*用.*IP|IP.*可以.*用/, a: "以下场景可用IP：启动/闪屏、首页/首页缺省、弹窗（确认/提示）、活动/营销弹窗、加载/等待、结果页、空状态。以下条件可用：浮标/悬浮入口（需产品经理确认）、下拉刷新。" },
  { q: /浮标.*能用|浮标.*可以|悬浮.*能不能/, a: "浮标/悬浮入口为条件可用，需产品经理确认，不遮挡主要内容。下拉刷新同样为条件可用。" },
  { q: /IP.*修改|IP.*改|能不能改|可以改吗|自由度|能改|修改.*形象/, a: "可根据业务属性对插图元素和颜色进行调整，但插图中高亮辅助色需与业务同色系且明度饱和度不得超过业务主色。IP形象本身不可修改。" },
  { q: /设计原则|核心原则|原则/, a: "设计三原则：情感共鸣、圆润融合、主次分明。IP使用3D形象，需由背景衬底（角度渐变、弥散渐变、纯色等）。" },
  { q: /缺省.*尺寸|空状态.*尺寸|32px|栅格|缺省页.*大小/, a: "缺省页基于32px栅格比例等比放大，确保视觉和谐。" },
  // 新增条目
  { q: /品牌色|主色|色彩|颜色.*规范/, a: "品牌主色：信任蓝 #0058FF（消金品牌色）；心意橙 #FF4614（乐业贷品牌色）。" },
  { q: /弹窗.*类型|有哪些.*弹窗|弹窗.*分类/, a: "弹窗类型包括：确认弹窗、提示弹窗、活动/营销弹窗、轻提示Toast、底部弹窗。每种弹窗的IP配置有所不同。" },
  { q: /IP.*高度|高度.*多少|IP.*多大/, a: "弹窗中IP高度弹性区间为200-400px。Toast中IP高度不小于100px。" },
  { q: /背景.*怎么|背景.*什么|背景.*颜色|IP.*背景/, a: "IP在UI中需由背景衬底，可选形式：角度渐变、弥散渐变、纯色等。色彩需与页面整体色调协调，且与业务同色系。" },
  { q: /正向|负向|中性|反馈.*类型|状态.*类型/, a: "IP反馈类型分三种：正向（成功/完成，暖色渐变背景）、负向（失败/错误，冷色背景）、中性（等待/提示）。" },
  { q: /穿搭|穿着|服装|衣服|穿什么/, a: "福宝IP默认穿搭为蓝色衬衫配领带。注意：当IP出现在UI状态场景（弹窗、空状态、结果页、Toast、加载页等）时，IP形象保持默认形态不穿衣服（不添加职业穿搭或人物服装）。只有在运营活动场景（营销活动、节日推广、品牌周边等）中，IP才可穿着与活动主题匹配的服装。" },
];

// ── 场景决策数据 ──
const POPUP_TABLE = {
  "确认弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 说明 + 按钮" },
  "提示弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 说明 + 按钮" },
  "活动弹窗": { position: "弹窗上方，可破形", height: "200-400px", layout: "IP + 标题 + 内容 + 按钮" },
  "营销弹窗": { position: "弹窗上方，可破形", height: "200-400px", layout: "IP + 标题 + 内容 + 按钮" },
  "Toast": { position: "容器内左侧或内右侧", height: "高度不小于100px", layout: "IP + 文案" },
  "轻提示": { position: "容器内左侧或内右侧", height: "高度不小于100px", layout: "IP + 文案" },
  "底部弹窗": { position: "弹窗上方居右或居中，可破形", height: "200-400px", layout: "IP + 标题 + 列表 + 按钮" }
};

const BLOCKED = /支付流程|密码|验证码|人脸|生物识别|协议|合同签署|风险提示|风险披露|500|系统错误|数据报表|详情页/;
const CONDITIONAL = /浮标|悬浮入口|下拉刷新/;

const COPYWRITING = [
  { k: /加载失败|加载.*错/, t: "即使暂时停滞，也是前进路上的小憩" },
  { k: /网络异常|断线|网络.*异常|无网络/, t: "即使网络暂时断线，我们的连接永不中断" },
  { k: /暂无数据|无数据|没有数据|空.*数据/, t: "空白也是一种美，等待被探索和填充" },
  { k: /暂无身份|无身份|未认证/, t: "暂时的迷茫，是发现自我的开始" },
  { k: /成功|完成|通过/, t: "星光不问赶路人，时光不负有心人" },
  { k: /额度|权益|信用/, t: "每一份额度，都是向未来的一次勇敢迈步" },
  { k: /保障|维稳/, t: "在风雨和阳光中，我们一直在你身边" },
  { k: /等待|审核|加载中/, t: "每一刻等待，都是未来的铺垫" },
  { k: /失败|错误|异常|超时/, t: "失败不是终点，而是另一个开始的机会" },
];

const CONSTRAINTS = [
  "超出弹窗 ≤ 自身高度1/3",
  "距标题文字 ≥ 32px",
  "关闭按钮热区 88x88px",
  "按钮及上方16px不可遮挡",
  "每页 ≤ 1处（浮标除外）",
  "动画 ≤ 5秒",
];

// ── 合规检查规则 ──
const CHECK_RULES = [
  {
    id: "closeButton",
    check: (q) => /关闭|close/.test(q),
    validate: (q) => {
      if (/IP.*遮挡.*关闭|遮挡.*关闭|IP.*挡.*关闭|关闭.*下方.*IP|IP.*在.*关闭.*下方|IP.*压在.*关闭/.test(q))
        return { pass: false, issue: "IP不得遮挡关闭按钮，热区范围88x88px", severity: "error" };
      return { pass: true, note: "确认IP未进入关闭按钮88x88px热区" };
    }
  },
  {
    id: "buttonBlock",
    check: (q) => /按钮|button/.test(q),
    validate: (q) => {
      if (/IP.*遮挡.*按钮|遮挡.*按钮|IP.*挡.*按钮/.test(q))
        return { pass: false, issue: "IP不得遮挡主操作按钮及其上方16px区域", severity: "error" };
      return { pass: true };
    }
  },
  {
    id: "forbiddenScene",
    check: (q) => /支付|密码|验证码|人脸|生物识别|协议|合同|风险提示|风险披露|500|系统错误|报表|详情/.test(q),
    validate: (q) => {
      if (/(支付|密码|验证码|人脸识别|生物识别|协议签署|合同签署|风险提示|风险披露|500错误|系统错误|数据报表|详情页)/.test(q)) {
        if (/能用|可以用|是否|能不能|可以放|可以加/.test(q))
          return { pass: false, issue: "此场景为IP禁止场景（来源：流程可用性规范）", severity: "error" };
        return { pass: false, issue: "检测到IP可能处于禁止场景，请对照流程可用性矩阵确认", severity: "warning" };
      }
      return { pass: true };
    }
  },
  {
    id: "ipCount",
    check: (q) => /多个|两个|几个/.test(q),
    validate: (q) => {
      if (/页面.*多个.*IP|多个.*IP.*页面|一页.*两|两.*IP/.test(q))
        return { pass: false, issue: "同一页面内IP不超过1处（浮标除外）", severity: "warning" };
      return { pass: true };
    }
  },
  {
    id: "animation",
    check: (q) => /动画|秒/.test(q),
    validate: (q) => {
      if (/([6-9]|\d{2,})\s*秒/.test(q))
        return { pass: false, issue: "IP动画时长不超过5秒", severity: "error" };
      return { pass: true };
    }
  },
  {
    id: "ipOverflow",
    check: (q) => /超出|破形|上沿/.test(q),
    validate: (q) => {
      if (/超出.*一半|超出.*1\/2|超出.*2\/3|超出.*全部/.test(q))
        return { pass: false, issue: "IP超出弹窗上沿不得超过自身高度1/3", severity: "error" };
      return { pass: true, note: "超出高度不超过IP自身高度1/3" };
    }
  },
  {
    id: "ipModify",
    check: (q) => /修改.*IP|IP.*修改|改.*形象|改.*福宝/.test(q),
    validate: () => ({ pass: false, issue: "IP形象本身不可修改", severity: "error" })
  }
];

// ── 函数 ──
function ask(q) {
  for (const item of KNOWLEDGE) {
    if (item.q.test(q)) return { mode: "ask", query: q, answer: item.a };
  }
  return {
    mode: "ask", query: q,
    answer: "请在IP应用规范文档中查找对应场景的规范，或联系设计团队确认。",
    hint: "可以描述具体场景（如弹窗、缺省页、浮标），或提出具体约束问题（如IP离关闭按钮多远）"
  };
}

function check(q) {
  const details = [];
  let hasIssue = false;
  for (const rule of CHECK_RULES) {
    if (rule.check(q)) {
      const r = rule.validate(q);
      details.push(r);
      if (!r.pass) hasIssue = true;
    }
  }
  if (details.length === 0)
    return { mode: "check", query: q, summary: "未发现明显违规项，建议对照规范文档人工复核", details: [] };
  return { mode: "check", query: q, summary: hasIssue ? "检测到以下需关注的项目：" : "检查通过：", details };
}

function scene(q) {
  // 检测弹窗类型
  let popupType = null;
  for (const [type, config] of Object.entries(POPUP_TABLE)) {
    if (q.includes(type)) { popupType = { type, ...config }; break; }
  }

  // 流程检查
  let flow;
  if (BLOCKED.test(q)) flow = { allowed: false, level: "🚫 不可用" };
  else if (CONDITIONAL.test(q)) flow = { allowed: "conditional", level: "⚠️ 条件可用" };
  else flow = { allowed: true, level: "✅ 可用" };

  // 文案匹配
  let copy = null;
  for (const c of COPYWRITING) {
    if (c.k.test(q)) { copy = c.t; break; }
  }

  // 场景类型
  let sceneType = "通用场景";
  let config = null;
  const isPopup = /弹窗|弹框|dialog|modal|popup|Toast|轻提示/.test(q);
  const isEmpty = /缺省|空状态|无数据|暂无|没有数据|空白页/.test(q);

  if (popupType) {
    sceneType = "弹窗场景";
    config = {
      弹窗类型: popupType.type,
      IP位置: popupType.position,
      高度弹性区间: popupType.height,
      组合模式: popupType.layout
    };
  } else if (isPopup) {
    sceneType = "弹窗场景";
    config = {
      高度弹性区间: "200-400px",
      IP位置: "弹窗上方居右或居中，可破形"
    };
  } else if (isEmpty) {
    sceneType = "缺省页场景";
    config = { 说明: "基于32px栅格比例等比放大，确保视觉和谐" };
  }

  return {
    mode: "scene", query: q, sceneType,
    config,
    flowAvailability: flow,
    copywriting: copy || "请参照规范文档中的文案库选择",
    constraints: CONSTRAINTS
  };
}

// ── 执行 ──
let result;
if (mode === "scene") result = scene(query);
else if (mode === "check") result = check(query);
else result = ask(query);

console.log(JSON.stringify(result, null, 2));
