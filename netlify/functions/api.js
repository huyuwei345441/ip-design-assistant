// Netlify Function - API handler
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const SCRIPTS_DIR = path.join(__dirname, "..", "..", "scripts");
const DOCS_DIR = path.join(__dirname, "..", "..", "docs");
const ASSETS_DIR = path.join(__dirname, "..", "..", "assets");
const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const p = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(p)) return resolve({ error: "脚本不可用" });
    execFile("node", [p, ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err && stderr && !stdout) return reject(new Error(stderr));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ raw: (stdout || stderr || "").trim() }); }
    });
  });
}

function readDoc(relPath) {
  const fp = path.join(DOCS_DIR, relPath);
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf-8").replace(/\n{4,}/g, "\n\n\n").trim();
}

const HANDBOOK = (() => {
  const brand = [
    { title: "品牌背景", file: "品牌背景", content: readDoc("58金融品牌基础规范/背景.md") },
    { title: "设计理念", file: "设计理念", content: readDoc("58金融品牌基础规范/设计理念.md") },
    { title: "色彩系统", file: "色彩系统", content: readDoc("58金融品牌基础规范/色彩系统.md") },
    { title: "IP介绍", file: "IP介绍", content: readDoc("ip人设文档/IP介绍.md") },
    { title: "IP手册", file: "IP手册", content: readDoc("IP 应用规范文档/IP手册.md") },
  ];
  const ui = [
    { title: "设计原则", file: "设计原则", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/设计原则.md") },
    { title: "与弹窗结合规范", file: "与弹窗结合规范", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/与弹窗结合规范.md") },
    { title: "在页面中的应用规范", file: "在页面中的应用规范", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/在页面中的应用规范.md") },
    { title: "缺省页与结果页应用规范", file: "缺省页与结果页应用规范", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/缺省页与结果页应用规范.md") },
    { title: "IP状态图例", file: "IP状态图例", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/IP 状态图例.md") },
    { title: "流程可用性规范", file: "流程可用性规范", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/流程可用性规范.md") },
    { title: "浮标应用规范", file: "浮标应用规范", content: readDoc("IP 应用规范文档/IP应用规范（UI场景）/浮标应用规范.md") },
    { title: "使用原则-场景/体验/运营", file: "使用原则", content: readDoc("IP 应用规范文档/ip使用规范全场景/使用原则 场景_体验_运营.md") },
    { title: "福宝线上应用案例", file: "线上应用案例", content: readDoc("IP 应用规范文档/ip使用规范全场景/福宝线上应用案例.md") },
    { title: "错误示例", file: "错误示例", content: readDoc("IP 应用规范文档/ip使用规范全场景/错误示例.md") },
    { title: "品牌与周边案例", file: "品牌与周边案例", content: readDoc("IP 应用规范文档/ip使用规范全场景/品牌与周边案例.md") },
  ];
  return { brand, ui };
})();

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const url = event.path.replace("/api", "");
  const method = event.httpMethod;

  try {
    // GET /api/status
    if (url === "/status" && method === "GET") {
      return { statusCode: 200, headers, body: JSON.stringify({ aiAvailable: false, provider: null, platform: "netlify" }) };
    }

    // GET /api/handbook
    if (url === "/handbook" && method === "GET") {
      return { statusCode: 200, headers, body: JSON.stringify(HANDBOOK) };
    }

    // GET /api/materials
    if (url === "/materials" && method === "GET") {
      const category = event.queryStringParameters?.category;
      let items = [];
      if (fs.existsSync(MANIFEST_PATH)) {
        items = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
      }
      if (category) items = items.filter(i => i.category === category);
      const grouped = {};
      for (const item of items) {
        const cat = item.category || "未分类";
        if (!grouped[cat]) grouped[cat] = { category: cat, count: 0, files: [] };
        grouped[cat].count++;
        grouped[cat].files.push({ file: item.file, width: item.width, height: item.height, sizeKB: item.sizeKB });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ total: items.length, groups: Object.values(grouped) }) };
    }

    // POST /api/materials/upload
    if (url === "/materials/upload" && method === "POST") {
      return { statusCode: 200, headers, body: JSON.stringify({
        error: "Netlify 静态托管暂不支持上传。请部署完整后端服务使用此功能。",
        hint: "本地运行 npm start 后访问 http://localhost:3000 即可使用上传功能"
      }) };
    }

    // DELETE /api/materials/:filename
    if (url.startsWith("/materials/") && method === "DELETE") {
      return { statusCode: 200, headers, body: JSON.stringify({
        error: "Netlify 静态托管暂不支持删除。请部署完整后端服务使用此功能。",
        hint: "本地运行 npm start 后访问 http://localhost:3000 即可使用删除功能"
      }) };
    }

    // POST /api/ask
    if (url === "/ask" && method === "POST") {
      const { query, mode } = JSON.parse(event.body);
      if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: "请输入问题" }) };
      const args = mode === "check" ? ["--check", query] : [query];
      const result = await runScript("ask-check.js", args);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // POST /api/scene
    if (url === "/scene" && method === "POST") {
      const { scene } = JSON.parse(event.body);
      if (!scene) return { statusCode: 400, headers, body: JSON.stringify({ error: "请输入场景描述" }) };
      const result = await runScript("scene-match.js", [scene]);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // POST /api/prompt
    if (url === "/prompt" && method === "POST") {
      const { scene, expression, action, prop, outfit, background, extra, occupation, color } = JSON.parse(event.body);
      if (!scene) return { statusCode: 400, headers, body: JSON.stringify({ error: "场景描述为必填" }) };
      const args = ["--scene", scene];
      if (expression) args.push("--expression", expression);
      if (action) args.push("--action", action);
      if (prop) args.push("--prop", prop);
      if (outfit) args.push("--outfit", outfit);
      if (background) args.push("--background", background);
      if (extra) args.push("--extra", extra);
      const promptResult = await runScript("generate-prompt.js", args);

      const isUIState = /弹窗|空状态|结果页|加载|等待|Toast|轻提示|缺省|首页|闪屏|浮标|下拉刷新/.test(scene);
      const isActivity = /活动|营销|运营|双11|节日|推广|广告|品牌|周边|创意/.test(scene);
      const skipOutfit = isUIState && !isActivity;

      let outfitDetail = skipOutfit ? "UI状态场景 — IP保持默认形象" : "";
      if (!skipOutfit && occupation) outfitDetail = inferOutfit(occupation) || occupation;
      if (outfit) outfitDetail = outfit;

      return { statusCode: 200, headers, body: JSON.stringify({
        prompt: promptResult.prompt || promptResult.raw || "",
        outfitDetail,
        params: { scene, expression, action, prop, outfit, background, occupation, color },
        optimized: false,
        hint: "本地部署后端服务可使用 AI 优化"
      }) };
    }

    // POST /api/create
    if (url === "/create" && method === "POST") {
      return { statusCode: 200, headers, body: JSON.stringify({
        error: "创意工坊需要配置 API Key 的后端服务。请在本地运行 npm start 后使用。",
        hint: "设置 GEMINI_API_KEY 免费启用 AI 创意生成"
      }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Not Found: " + url }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function inferOutfit(occ) {
  const map = {
    "白领": "浅灰色修身西装外套，白色丝绸飘带衬衫，黑色直筒九分西裤，黑色尖头高跟鞋，银色细链锁骨项链，简约皮革手提包，珍珠耳钉",
    "经理": "深蓝色修身西装套装，白色衬衫内搭，深棕色皮鞋，简约金属腕表",
    "医生": "白色医用大褂，浅蓝色衬衫，听诊器挂于胸前，黑色休闲皮鞋",
    "教师": "浅灰色针织开衫，白色衬衫内搭，深色长裤，简约帆布鞋",
    "程序员": "深灰色连帽卫衣外套，白色印花T恤，深蓝色直筒牛仔裤，白色运动鞋，双肩电脑背包",
    "设计师": "时尚黑色高领毛衣，修身长裤，切尔西短靴，银色简约项链",
    "律师": "深灰色西装套装，白衬衫配深蓝色领带，黑色牛津皮鞋，皮质公文包",
    "销售": "深蓝色西装套装，亮色领带，黑色商务皮鞋，皮质手提包",
    "学生": "学院风V领针织衫，白衬衫内搭，百褶裙，中筒袜配小皮鞋",
    "厨师": "白色双排扣厨师制服，厨师高帽，黑白条纹围裙，黑色防滑厨师鞋",
    "空乘": "深蓝色制服套装，丝巾领结，黑色中跟皮鞋",
    "快递员": "品牌红色冲锋衣工作服，黑色工装长裤，黑色防滑运动鞋",
    "上班族": "卡其色风衣外套，白色圆领针织衫，深蓝色牛仔裤，棕色乐福鞋",
    "职场": "藏青色小西装外套，白色飘带衬衫，灰色九分西裤，黑色中跟皮鞋",
    "金融": "深炭灰色西装三件套，法式袖扣白衬衫，深蓝色斜纹领带，黑色牛津鞋",
  };
  for (const k of Object.keys(map)) {
    if (occ && occ.includes(k)) return map[k];
  }
  return "";
}
