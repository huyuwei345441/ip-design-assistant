/**
 * Netlify Functions — 福宝 IP 设计助手 API
 * 用 Express + serverless-http 承载全部 9 个端点
 * 素材上传/删除用 Netlify Blobs 持久化（免费额度内）
 */
const express = require("express");
const serverless = require("serverless-http");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
app.use(express.json({ limit: "50mb" }));

// 构建期内联数据（素材清单/规范文档/CLI脚本），zisi 打包时随 require 进函数包
const DATA = require("./generated-data.js");
const STATIC_MANIFEST = DATA.manifest;

// Netlify Blobs 存储（用户上传素材持久化）
// v1 函数（Lambda 兼容模式）不会自动注入 Blobs 上下文，
// 回退到显式 siteID + token（站点环境变量 NETLIFY_PAT 提供）
let blobStore = null;
let blobError = null;
const SITE_ID = "fd196c88-0ff7-4ef4-9d5c-6db662e7269b";
function getBlobStore() {
  if (!blobStore && blobError === null) {
    try {
      blobStore = require("@netlify/blobs").getStore("materials");
    } catch (e1) {
      try {
        blobStore = require("@netlify/blobs").getStore({
          name: "materials",
          siteID: SITE_ID,
          token: process.env.NETLIFY_PAT
        });
      } catch (e2) { blobError = (e2 && e2.message) || String(e2); }
    }
  }
  return blobStore;
}
const UPLOAD_MANIFEST_KEY = "__uploads_manifest__.json";

// ── 工具：spawn 脚本（内联内容写入临时文件再执行，脚本只用 Node 内置模块）──
function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const src = DATA.scripts[scriptName];
    if (!src) return reject(new Error("脚本不存在: " + scriptName));
    const tmpPath = path.join(os.tmpdir(), "fubao-" + scriptName);
    try { fs.writeFileSync(tmpPath, src); }
    catch (e) { return reject(e); }
    execFile("node", [tmpPath, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      if (err && stderr && !stdout) return reject(new Error(stderr.slice(0, 500)));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ raw: (stdout || stderr || "").trim() }); }
    });
  });
}

// ── AI 客户端 ──
// 优先使用服务器环境变量，其次使用前端通过 x-api-key 请求头传来的 Key
function getAIClient(req) {
  let headerKey = null;
  if (req) {
    if (typeof req.get === "function") headerKey = req.get("x-api-key");
    if (!headerKey && req.headers) {
      const h = req.headers;
      headerKey = h["x-api-key"] || h["X-Api-Key"] || h["X-API-KEY"] || h["xApiKey"] || null;
    }
  }
  const geminiKey = process.env.GEMINI_API_KEY || headerKey;
  if (geminiKey) {
    return {
      provider: "gemini",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      chat: async (systemPrompt, userContent, maxTokens = 1024) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent?key=${geminiKey}`;
        const body = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
        };
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || "Gemini API 错误");
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || headerKey;
  if (!apiKey) return null;
  try {
    const Anthropic = require("@anthropic-ai/sdk").default;
    const client = new Anthropic({ apiKey });
    client.model = "claude-sonnet-4-6";
    client.provider = "anthropic";
    return client;
  } catch (e) { return null; }
}

async function aiChat(ai, systemPrompt, userContent, maxTokens = 1024) {
  if (ai.provider === "gemini") return await ai.chat(systemPrompt, userContent, maxTokens);
  const msg = await ai.messages.create({
    model: ai.model, max_tokens: maxTokens,
    system: systemPrompt, messages: [{ role: "user", content: userContent }]
  });
  return msg.content.find(c => c.type === "text")?.text || "";
}

// ── 规范文档 ──
const DOC_FILES = [
  "IP 应用规范文档/IP应用规范（UI场景）/设计原则.md",
  "IP 应用规范文档/IP应用规范（UI场景）/与弹窗结合规范.md",
  "IP 应用规范文档/IP应用规范（UI场景）/在页面中的应用规范.md",
  "IP 应用规范文档/IP应用规范（UI场景）/缺省页与结果页应用规范.md",
  "IP 应用规范文档/IP应用规范（UI场景）/IP 状态图例.md",
  "IP 应用规范文档/IP应用规范（UI场景）/流程可用性规范.md",
  "IP 应用规范文档/IP应用规范（UI场景）/浮标应用规范.md",
  "IP 应用规范文档/IP手册.md",
  "IP 应用规范文档/ip使用规范全场景/使用原则 场景_体验_运营.md",
  "IP 应用规范文档/ip使用规范全场景/福宝线上应用案例.md",
  "IP 应用规范文档/ip使用规范全场景/错误示例.md",
  "IP 应用规范文档/ip使用规范全场景/品牌与周边案例.md",
  "ip人设文档/IP介绍.md",
  "58金融品牌基础规范/色彩系统.md",
  "58金融品牌基础规范/设计理念.md",
  "58金融品牌基础规范/背景.md"
];

function readDoc(relPath) {
  const content = DATA.docs[relPath];
  return content ? content.replace(/\n{4,}/g, "\n\n\n").trim() : "";
}

function loadSourceDocs() {
  let docs = "";
  for (const file of DOC_FILES) {
    if (DATA.docs[file]) docs += `\n\n=== ${file} ===\n${DATA.docs[file]}`;
  }
  return docs;
}

// ── 职业穿搭推导（模板模式，与 server.js 保持一致）──
function inferOutfit(occ) {
  const map = {
    "白领": "浅灰色修身西装外套，白色丝绸飘带衬衫，黑色直筒九分西裤，黑色尖头高跟鞋，银色细链锁骨项链，简约皮革手提包，珍珠耳钉",
    "金领": "深藏青色意式西装三件套，温莎领白衬衫配金色袖扣，酒红色丝绸领带，黑色牛津雕花皮鞋，玫瑰金机械腕表，鳄鱼皮公文包",
    "上班族": "卡其色中长款风衣，白色圆领针织衫内搭，深蓝色直筒牛仔裤，棕色乐福鞋，帆布双肩背包，简约皮质腕表",
    "职场": "藏青色小西装外套，白色飘带系蝴蝶结衬衫，灰色九分烟管西裤，黑色中跟尖头皮鞋，珍珠耳钉，金属细框眼镜，链条小方包",
    "金融": "深炭灰色英式西装三件套，法式双叠袖白衬衫配银色袖扣，深蓝色斜纹领带，黑色牛津皮鞋，镶钻机械腕表，鳄鱼纹皮质公文包",
    "商务": "深蓝色暗条纹西装套装，意式尖领白衬衫，暗红色口袋巾，深棕色布洛克雕花皮鞋，金色袖扣，棕色皮革公文包",
    "公务员": "深蓝色行政夹克，白色衬衫内搭，深灰色西裤，黑色系带皮鞋，简约石英腕表，金属框架眼镜",
    "医生": "白色医用大褂（左胸口袋插笔），浅蓝色V领手术服内搭，听诊器挂于颈间，黑色软底休闲皮鞋，简约不锈钢腕表",
    "护士": "淡粉色短袖护士服（V领设计），白色护士裤，白色软底护士鞋，护士帽配蓝色横纹，胸口挂电子体温计，银色护士怀表",
    "药剂师": "白色短款药剂师大褂，浅绿色衬衫内搭，深色长裤，黑色软底便鞋，圆框金属眼镜，胸前工牌",
    "牙医": "浅蓝色短袖医用工作服，白色内搭T恤，深蓝色医用长裤，防护面罩推至额头，蓝色医用橡胶手套，白色防滑洞洞鞋",
    "兽医": "卡其色兽医工作服，浅绿色Polo衫内搭，深色工装裤，棕色防滑短靴，听诊器挂于胸前，动物图案胸针",
    "教师": "浅灰色V领针织开衫，白色牛津纺衬衫内搭，深卡其色斜纹长裤，棕色皮革乐福鞋，玳瑁色板材眼镜，帆布托特包",
    "教授": "深棕色灯芯绒西装外套配皮质肘部补丁，浅蓝色牛津衬衫，深灰色羊毛西裤，棕色德比鞋，金丝圆框眼镜，皮质手提公文包",
    "幼师": "浅粉色连帽卫衣外套，白色纯棉T恤，浅蓝色牛仔裤，白色帆布鞋，彩色串珠手链，卡通图案帆布围裙",
    "教练": "深蓝色运动夹克外套，白色速干Polo衫，黑色运动长裤侧面白色条纹，专业跑鞋，哨子挂绳，运动电子表",
    "程序员": "深灰色连帽卫衣外套，白色印花T恤内搭（印有代码图案），深蓝色直筒牛仔裤，白色运动鞋，黑框板材眼镜，双肩电脑背包",
    "产品经理": "浅蓝色牛津纺衬衫（领口微开），深灰色斜纹棉布长裤，棕色切尔西短靴，Apple Watch运动腕表，帆布双肩背包",
    "设计师": "黑色高领修身毛衣，不对称剪裁深灰色阔腿裤，切尔西短靴，黑框设计师眼镜（玳瑁色），银色简约项链，皮质斜挎小包",
    "工程师": "蓝色牛津纺衬衫卷袖至肘，白色T恤内搭，卡其色工装长裤多口袋设计，棕色工装短靴，黄色安全帽夹于腋下，银色机械腕表",
    "运维": "深蓝色防水冲锋衣外套，灰色抓绒内搭，黑色工装裤，黑色防水短靴，双肩工具背包，头戴式降噪耳机挂于颈间",
    "律师": "深灰色双排扣西装套装，法式翻袖白衬衫，深蓝色丝绸领带配银色领带夹，黑色牛津皮鞋配菱形格纹袜，玫瑰金袖扣，棕色鳄鱼皮公文包",
    "会计": "深蓝色单排扣西装，白色衬衫配灰色领带，黑色系带牛津鞋，银色边框眼镜，不锈钢石英腕表，黑色尼龙公文包",
    "咨询顾问": "深蓝色修身西装三件套，尖领白衬衫，银色袖扣，酒红色领带，黑色牛津鞋，极简腕表，碳纤维公文箱",
    "分析师": "灰色格纹西装外套，白色衬衫配深蓝针织领带，深灰色羊毛西裤，黑色德比鞋，黑框眼镜，皮质平板电脑包",
    "服务员": "白衬衫配黑色蝴蝶领结，黑色修身马甲，黑色围裙半身（腰间系带），黑色直筒西裤，黑色防滑皮鞋，银色圆形托盘",
    "前台": "浅蓝色丝质衬衫配蝴蝶结飘带，深灰色A字半身裙，肤色丝袜，黑色中跟浅口皮鞋，珍珠耳钉，精致淡妆，银色胸针",
    "客服": "浅紫色V领针织衫，深灰色西裤，黑色乐福鞋，简约珍珠耳钉，头戴式降噪耳麦，淡雅裸色妆容",
    "导游": "亮色防晒冲锋衣外套，白色速干T恤，卡其色多口袋工装短裤，棕色户外徒步鞋，挂脖式证件套，遮阳帽，便携小蜜蜂扩音器",
    "空乘": "深蓝色空乘制服套装（收腰设计），蓝白条纹丝巾领结，黑色中跟浅口皮鞋，精致空乘妆容，珍珠耳钉，银色姓名胸牌",
    "理发师": "黑色修身V领T恤，深灰色围裙（多个口袋插剪刀和梳子），深色修身牛仔裤，黑色马丁靴，银色耳钉，手腕皮质工具包",
    "销售": "深蓝色修身西装套装，白色八字领衬衫，亮色图案领带，黑色系带商务皮鞋，玫瑰金机械腕表，黑色皮质手提公文包",
    "房产中介": "深灰色西装套装，白色衬衫配深蓝色领带，黑色尖头皮鞋，金色徽章胸针，皮质名片夹，黑色公文包",
    "保险代理": "深蓝色西装外套，浅蓝色衬衫配条纹领带，卡其色西裤，棕色皮鞋，金属徽章胸针，黑色皮革文件夹包",
    "记者": "深蓝色休闲西装外套，白衬衫（领口微开不系领带），深色牛仔裤，棕色沙漠靴，帆布斜挎相机包，挂脖式记者证",
    "摄影师": "多口袋黑色摄影马甲，深灰色T恤，卡其色工装裤，棕色户外徒步鞋，单反相机挂于胸前，棒球帽，户外手表",
    "导演": "黑色宽松亚麻衬衫，灰色阔腿休闲裤，黑色帆布鞋，深色棒球帽，银色项链，导演取景器挂于胸前，墨镜推至额头",
    "画家": "米白色宽松亚麻衬衫（袖口沾有颜料痕迹），深色阔腿裤，赤脚或帆布鞋，贝雷帽歪戴，木质调色盘手持，彩色围巾随意搭于肩上",
    "音乐家": "黑色立领修身演出服，白色衬衫配黑色领结，黑色正装皮鞋，小提琴或指挥棒手持，银色袖扣，精致发型",
    "作家": "深棕色羊绒开衫外套，浅灰色高领毛衣内搭，复古格子羊毛围巾，深色灯芯绒长裤，棕色麂皮软底便鞋，玳瑁色圆框眼镜，手持钢笔",
    "编辑": "深灰色针织开衫，白色圆领T恤内搭，黑色直筒长裤，黑色乐福鞋，黑框眼镜，红色标记笔插于耳后",
    "歌手": "亮片装饰修身舞台礼服，深V领设计，高跟过膝长靴或银色细高跟，层叠金属项链，闪亮耳坠，舞台妆感浓重眼妆，手持无线麦克风",
    "演员": "经典白衬衫外搭深色背带，深灰色西装长裤，棕色复古牛津鞋，复古圆形墨镜，皮质旅行手提箱，丝巾点缀",
    "舞者": "黑色修身芭蕾练功服（交叉背带设计），粉色芭蕾舞鞋（缎面绑带缠绕小腿），驼色护腿针织袜套，束发带，精致锁骨项链",
    "网红主播": "时尚oversize西装外套，白色短款内搭露出腰线，高腰阔腿牛仔裤，白色厚底运动鞋，环形大耳环，多层金属手链，环形补光灯",
    "运动员": "速干面料运动套装（拼接撞色设计），专业跑鞋（荧光色厚底气垫底），吸汗运动腕带，运动发带，运动电子表",
    "健身教练": "修身透气运动背心，弹力运动压缩长裤（侧面网眼透气设计），专业训练鞋，运动手套，吸汗毛巾搭于肩上，运动手环",
    "瑜伽教练": "莫代尔棉修身运动背心，高腰弹力瑜伽长裤，赤脚，檀木念珠手链，瑜伽垫卷起夹于腋下，发髻盘发",
    "厨师": "白色双排扣厨师制服（立领设计），黑色纽扣，厨师高帽，黑白条纹围裙腰间系带，黑色防滑厨师鞋，白色毛巾搭于肩上",
    "咖啡师": "卡其色帆布围裙（多口袋设计），白衬衫卷袖至肘部，深色修身牛仔裤，棕色工装短靴，皮质手腕带，帆布杯套",
    "调酒师": "黑色修身马甲配白色衬衫，黑色领结，深灰色西裤，黑色牛津鞋，银色调酒勺插于胸前口袋，手腕皮质护腕，复古背带",
    "烘焙师": "白色短袖面包师制服（圆领设计），白色围裙沾有面粉痕迹，黑白格子长裤，白色防滑厨师鞋，白色面包师帽，隔热手套",
    "消防员": "深蓝色消防员制服，黄色反光条带，消防头盔，黑色防护手套，黑色消防靴，对讲机挂于肩章",
    "警察": "深蓝色警服制服（修身版型），银色警徽和编号胸牌，黑色执勤腰带配手铐套和弹夹套，黑色军靴，警帽",
    "军人": "迷彩军服作战套装，战术背心多口袋设计，军靴系带至小腿，头盔，臂章，战术手套",
    "快递员": "品牌红色冲锋衣工作服，深灰色速干T恤内搭，黑色工装长裤，黑色防滑运动鞋，头盔，手持电子签收终端",
    "外卖骑手": "亮黄色防风防水骑行外套（反光条设计），黑色骑行长裤，骑行头盔，防滑骑行手套，骑行靴，保温配送箱背包",
    "工人": "橙色反光安全背心外套，深蓝色工装连体裤多口袋设计，黄色安全头盔，厚底防砸工装靴，劳保手套",
    "司机": "白衬衫配黑色领带，深蓝色西裤，黑色皮鞋，白色驾驶手套，墨镜，银色车钥匙",
    "农民": "浅色宽檐草帽，白色棉麻短袖衬衫，深蓝色宽松棉布裤卷至小腿，赤脚或草编凉鞋，搭肩白色毛巾，锄头倚于肩",
    "渔夫": "亮黄色防水橡胶背带裤连靴一体，白色长袖厚棉T恤，防风雨渔夫帽，防水手套，渔网搭于肩上"
  };
  const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (occ.includes(k)) return map[k];
  }
  return "";
}

// ========== API: AI 状态检测 ==========
app.get("/api/status", (req, res) => {
  const ai = getAIClient(req);
  // 调试：确认 header key 是否被正确读取（仅输出长度/首字符，避免泄露完整 Key）
  let headerKey = null;
  if (req) {
    if (typeof req.get === "function") headerKey = req.get("x-api-key");
    if (!headerKey && req.headers) {
      const h = req.headers;
      headerKey = h["x-api-key"] || h["X-Api-Key"] || h["X-API-KEY"] || null;
    }
  }
  const keys = Object.keys(req.headers || {}).filter(k => /api|key/i.test(k));
  res.json({
    aiAvailable: !!ai, provider: ai ? ai.provider : null,
    seedreamAvailable: !!process.env.ARK_API_KEY,
    debug: {
      hasHeaderKey: !!headerKey,
      keyLen: headerKey ? headerKey.length : 0,
      keyPrefix: headerKey ? headerKey.slice(0, 3) : null,
      matchingHeaderNames: keys,
      hasReqGet: typeof req.get === "function"
    }
  });
});

// ========== API: 规范问答 ==========
app.post("/api/ask", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "请输入问题" });
    res.json(await runScript("ask-check.js", [query]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 场景决策 ==========
app.post("/api/scene", async (req, res) => {
  try {
    const { scene } = req.body;
    if (!scene) return res.status(400).json({ error: "请输入场景描述" });
    res.json(await runScript("scene-match.js", [scene]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 提示词生成 ==========
app.post("/api/prompt", async (req, res) => {
  try {
    const { scene, expression, action, prop, outfit, background, composition, extra, occupation, color } = req.body;
    if (!scene) return res.status(400).json({ error: "场景描述为必填" });

    const isUIState = /弹窗|空状态|结果页|加载|等待|Toast|轻提示|缺省|首页|闪屏|浮标|下拉刷新|确认|提示|系统|错误/.test(scene);
    const isActivity = /活动|营销|运营|双11|节日|推广|广告|品牌|周边|创意/.test(scene);
    const skipOutfit = isUIState && !isActivity;

    const ai = getAIClient(req);

    if (ai) {
      const systemPrompt = `你是58金融品牌IP"福宝"的AI绘画提示词优化专家。你的任务是根据用户的输入参数，生成优化后的详细画面描述，用于生图AI。

关键规则：
1. 主体永远是"参考图中的卡通形象"（福宝是一只软萌可爱的3D卡通海獭，不是熊），特征严格参照参考图不变
2. 动作要精确到两只手的具体姿态（如"左手叉腰，右手抬起打招呼"）
3. 道具描述要具体（含材质、颜色、形状）
4. 重要：当使用场景为UI状态场景（弹窗、空状态、结果页、Toast、加载、缺省页等）时，IP保持默认形态不穿衣服，不要添加职业穿搭描述
5. 当使用场景为运营活动场景（营销活动、节日推广、品牌周边等）时，职业穿搭必须合并为一项详细描述，根据用户输入的职业特点详细推断：衣服样式（如连衣裙、衬衫搭配西装裤、古装长袍等）、衣服颜色（具体色彩名称及色调，如正红色、淡蓝色等）、穿搭细节（领口设计、袖口装饰、裙摆长度等）、配饰（项链、手链、帽子、鞋子等的样式和材质）
6. 整体色调匹配用户指定的颜色输入
7. 固定渲染参数：3D软萌治愈系渲染，柔和均匀人工光，平视中景居中展示，头身比1:1

请输出JSON格式：
{
  "outfitDetail": "职业穿搭详细描述（含衣服样式、颜色、细节、配饰）",
  "actionOptimized": "优化后的精确动作描述（含双手姿态）",
  "colorScheme": "配色方案描述",
  "prompt": "最终合并的完整prompt（尾部固定包含头身比1:1）",
  "optimized": true
}`;
      const userContent = `使用场景：${scene}${skipOutfit ? "（UI状态场景，IP保持默认形态不穿衣服，忽略职业穿搭）" : ""}
${!skipOutfit && occupation ? "职业/穿搭：" + occupation + "（请根据职业详细推导穿搭样式、颜色、细节、配饰）" : ""}
${expression ? "表情：" + expression : ""}
${action ? "动作：" + action : ""}
${prop ? "道具：" + prop : ""}
${color ? "主色调：" + color : ""}
${background ? "背景：" + background : ""}
${extra ? "额外描述：" + extra : ""}
${composition ? "构图：" + composition : ""}
请基于以上参数生成优化后的JSON。`;
      try {
        const text = await aiChat(ai, systemPrompt, userContent, 1024);
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const result = JSON.parse(m[0]);
          result.params = { scene, expression, action, prop, outfit, background, occupation, color };
          return res.json(result);
        }
      } catch (e) { console.error("AI prompt error:", e.message); }
    }

    // ── 模板模式 ──
    const parts = ["参考图中的卡通形象"];
    const occOrOutfit = occupation || outfit;
    if (occOrOutfit && !skipOutfit) {
      const inferred = inferOutfit(occOrOutfit);
      parts.push(inferred ? `，穿着${inferred}` : `，穿着${occOrOutfit}`);
    } else if (skipOutfit) {
      parts.push("，保持IP默认形象（不穿衣服形态）");
    }
    if (expression) parts.push(`，${expression}`);
    if (action) parts.push(`，${action}`);
    if (prop) parts.push(`，手持${prop}`);
    if (color) parts.push(`，整体色调以${color}为主`);
    if (background) parts.push(`，${background}`);
    else if (color) parts.push(`，${color}纯色简洁背景`);
    else parts.push("，纯色简洁背景");
    parts.push("，柔和均匀人工光，3D软萌治愈系渲染");
    parts.push(composition ? `，${composition}` : "，平视中景居中展示");
    parts.push("，整体可爱Q版形象特征严格参考参考图，不做改变，头身比1:1");
    if (extra) parts.push(`，${extra}`);
    const prompt = parts.join("");

    let outfitDetail = "";
    if (skipOutfit) outfitDetail = "UI状态场景 — IP保持默认形象（不穿衣服）";
    else if (occOrOutfit) outfitDetail = inferOutfit(occOrOutfit) || occOrOutfit;

    res.json({
      prompt, outfitDetail,
      actionOptimized: action || "",
      colorScheme: color ? `整体色调以${color}为主` : "",
      params: { scene, expression, action, prop, outfit, background, composition, extra, occupation, color },
      optimized: false,
      hint: "设置 GEMINI_API_KEY（免费获取：aistudio.google.com）或 ANTHROPIC_API_KEY 可启用 AI 智能优化"
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 创意工坊 ==========
app.post("/api/create", async (req, res) => {
  try {
    const { requirement } = req.body;
    if (!requirement) return res.status(400).json({ error: "请输入业务需求" });
    const ai = getAIClient(req);
    if (!ai) return res.status(500).json({ error: "未配置 API Key。请设置 GEMINI_API_KEY（免费，无需信用卡）或 ANTHROPIC_API_KEY 环境变量" });
    const sourceDocs = loadSourceDocs();
    const text = await aiChat(ai,
      `你是58金融品牌IP"福宝"的创意顾问。福宝是一只软萌可爱的3D卡通海獭形象（不是熊）。以下为IP规范文档，请基于文档内容为用户设计创意方案。\n\n${sourceDocs}\n\n请输出JSON：{"creativeDirection":"创意方向","expression":"表情","action":"动作","prop":"道具","outfit":"穿搭","background":"背景","prompts":["prompt1"],"usageNote":"应用说明"}`,
      requirement, 2048);
    const m = text.match(/\{[\s\S]*\}/);
    res.json(m ? JSON.parse(m[0]) : { raw: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: AI 生图（火山方舟 Seedream 5.0 Lite）==========
const SEEDREAM_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const SEEDREAM_MODEL = "doubao-seedream-5-0-260128";

// 提交生图任务（带参考图时自动附加 IP 一致性指令）
function seedreamSubmit(prompt, imageDataURIs, size) {
  const body = {
    model: SEEDREAM_MODEL, prompt, size,
    response_format: "b64_json", output_format: "png", watermark: false
  };
  if (imageDataURIs.length) body.image = imageDataURIs;
  return fetch(SEEDREAM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.ARK_API_KEY },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

// 查询异步任务状态
function seedreamQuery(taskId) {
  return fetch(SEEDREAM_ENDPOINT + "/" + taskId, {
    headers: { Authorization: "Bearer " + process.env.ARK_API_KEY }
  }).then(r => r.json());
}

// 从方舟响应提取图片（兼容 b64_json / image_urls 两种返回格式）
function extractImageFromSeedream(data) {
  if (!data || typeof data !== "object") return null;
  const c = data.content;
  let b64 = null, url = null;
  if (c) {
    if (Array.isArray(c.b64_json) && c.b64_json[0]) b64 = c.b64_json[0];
    else if (Array.isArray(c.image_urls) && c.image_urls[0]) url = c.image_urls[0];
  }
  if (!b64 && !url && Array.isArray(data.data)) {
    b64 = (data.data[0] || {}).b64_json;
    url = (data.data[0] || {}).url;
  }
  if (b64) return "data:image/png;base64," + b64;
  return url;
}

app.post("/api/generate-image", async (req, res) => {
  try {
    if (!process.env.ARK_API_KEY) {
      return res.status(500).json({ error: "未配置火山方舟 Key（ARK_API_KEY）。请在火山引擎控制台开通方舟服务并创建 API Key" });
    }
    const { prompt, referenceImages, size } = req.body;
    if (!prompt) return res.status(400).json({ error: "缺少提示词" });

    // 参考图（最多 2 张，dataURI 格式；前端从素材库或本地上传转 base64）
    const imageDataURIs = (Array.isArray(referenceImages) ? referenceImages : [])
      .filter(u => typeof u === "string" && u.startsWith("data:image/"))
      .slice(0, 2);

    // 参考图一致性指令：参考图负责"是谁"，提示词负责"在哪、做什么"
    const finalPrompt = imageDataURIs.length
      ? prompt + "\n严格保持参考图中IP形象的特征完全一致（脸型、五官、配色、身体比例不变），仅根据提示词调整动作、服装、道具与场景。"
      : prompt;

    const sz = /^\d{3,4}x\d{3,4}$/.test(size) ? size : "2048x2048";

    const data = await seedreamSubmit(finalPrompt, imageDataURIs, sz);
    if (data.error) {
      return res.status(400).json({ error: "方舟 API 错误: " + (data.error.message || JSON.stringify(data.error).slice(0, 200)) });
    }

    // 同步返回或响应直接含图
    const img = extractImageFromSeedream(data);
    if (img) return res.json({ image: img, size: sz, model: SEEDREAM_MODEL });

    // 异步任务：后端轮询最多 8 秒（函数有 26 秒超时，留给前端轮询兜底）
    const taskId = data.id || data.task_id;
    if (!taskId) {
      return res.status(500).json({ error: "方舟返回格式无法识别: " + JSON.stringify(data).slice(0, 300) });
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const q = await seedreamQuery(taskId);
      if (q.status === "failed") return res.status(500).json({ error: "生成失败: " + ((q.error && q.error.message) || "未知错误") });
      const qImg = extractImageFromSeedream(q);
      if (qImg) return res.json({ image: qImg, size: sz, model: SEEDREAM_MODEL });
    }
    // 超时降级：返回任务 ID，前端继续轮询
    res.json({ pending: true, taskId, size: sz });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生图任务查询（前端轮询用）
app.get("/api/generate-image/:taskId", async (req, res) => {
  try {
    const taskId = req.params.taskId;
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) return res.status(400).json({ error: "无效任务 ID" });
    const q = await seedreamQuery(taskId);
    if (q.status === "failed") return res.status(500).json({ error: "生成失败: " + ((q.error && q.error.message) || "未知错误") });
    const img = extractImageFromSeedream(q);
    if (img) return res.json({ image: img });
    res.json({ pending: true, taskId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: IP规范手册 ==========
app.get("/api/handbook", (req, res) => {
  const handbook = {
    brand: [
      { title: "品牌背景", file: "品牌背景", content: readDoc("58金融品牌基础规范/背景.md") },
      { title: "设计理念", file: "设计理念", content: readDoc("58金融品牌基础规范/设计理念.md") },
      { title: "色彩系统", file: "色彩系统", content: readDoc("58金融品牌基础规范/色彩系统.md") },
      { title: "IP介绍", file: "IP介绍", content: readDoc("ip人设文档/IP介绍.md") },
      { title: "IP手册", file: "IP手册", content: readDoc("IP 应用规范文档/IP手册.md") }
    ],
    ui: [
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
      { title: "品牌与周边案例", file: "品牌与周边案例", content: readDoc("IP 应用规范文档/ip使用规范全场景/品牌与周边案例.md") }
    ]
  };
  res.json(handbook);
});

// ========== API: IP素材库 ==========
async function getUploadsManifest() {
  const store = getBlobStore();
  if (!store) return [];
  try {
    const raw = await store.get(UPLOAD_MANIFEST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

async function saveUploadsManifest(manifest) {
  const store = getBlobStore();
  if (store) await store.set(UPLOAD_MANIFEST_KEY, JSON.stringify(manifest));
}

app.get("/api/materials", async (req, res) => {
  try {
    // 静态内置素材（只读）
    const items = [...STATIC_MANIFEST];
    // 用户上传素材（Blobs 持久化）
    const uploads = await getUploadsManifest();

    const category = req.query.category;
    const grouped = {};
    const addItem = (item, isUpload) => {
      if (category && item.category !== category && item.tag !== category) return;
      const cat = item.category || "未分类";
      if (!grouped[cat]) grouped[cat] = { category: cat, tag: item.tag || "", count: 0, files: [] };
      grouped[cat].count++;
      grouped[cat].files.push({
        file: item.file, width: item.width, height: item.height, sizeKB: item.sizeKB,
        src: isUpload ? "/api/materials/file/" + encodeURIComponent(item.file) : "/assets/" + item.file,
        uploaded: !!isUpload
      });
    };
    items.forEach(i => addItem(i, false));
    uploads.forEach(i => addItem(i, true));

    res.json({ total: items.length + uploads.length, categoryFilter: category || null, groups: Object.values(grouped) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 图片二进制代理：优先 Blobs（用户上传），回退静态 assets
app.get("/api/materials/file/:filename", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ error: "无效文件名" });
    }
    const store = getBlobStore();
    if (store) {
      try {
        const data = await store.get("img:" + filename);
        if (data) {
          const m = data.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
          if (m) {
            const ext = m[1] === "jpeg" ? "jpg" : m[1];
            const buf = Buffer.from(m[2], "base64");
            res.setHeader("Content-Type", "image/" + ext);
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(buf);
          }
        }
      } catch (e) { /* 回退静态 */ }
    }
    // 内置素材图片不在函数包内（69 张图走静态目录），重定向到静态路径
    const isBuiltin = STATIC_MANIFEST.some(i => i.file === filename);
    if (isBuiltin) return res.redirect(302, "/assets/" + encodeURIComponent(filename));
    return res.status(404).json({ error: "素材不存在" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 素材上传（Blobs 持久化）==========
app.post("/api/materials/upload", async (req, res) => {
  try {
    const { filename, data, category } = req.body;
    if (!filename || !data) return res.status(400).json({ error: "缺少文件名或图片数据" });

    const matches = data.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "图片数据格式不正确" });
    const ext = matches[1] === "jpeg" ? "jpg" : matches[1];

    // 安全文件名
    const safeName = filename.replace(/[^a-zA-Z0-9_\-一-鿿\.]/g, "_");
    let finalName = safeName.includes(".") ? safeName : safeName + "." + ext;

    // 与内置素材/已上传素材重名时加时间戳
    const uploads = await getUploadsManifest();
    const staticNames = new Set(STATIC_MANIFEST.map(i => i.file));
    const allNames = new Set([...staticNames, ...uploads.map(i => i.file)]);
    while (allNames.has(finalName)) {
      finalName = finalName.replace(/(\.[^.]+)$/, `_${Date.now()}$1`);
    }

    const store = getBlobStore();
    if (!store) return res.status(500).json({ error: "Blobs 存储不可用: " + (blobError || "未知原因") });

    const buffer = Buffer.from(matches[2], "base64");
    const sizeKB = Math.round(buffer.length / 1024);
    await store.set("img:" + finalName, data);

    uploads.push({ file: finalName, width: 0, height: 0, sizeKB, category: category || "用户上传", tag: "上传" });
    await saveUploadsManifest(uploads);

    res.json({ success: true, file: finalName, sizeKB });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 素材删除 ==========
app.delete("/api/materials/:filename", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ error: "无效文件名" });
    }

    // 内置素材不可删除（静态文件系统只读）
    let isStatic = false;
    if (STATIC_MANIFEST.length) {
      isStatic = STATIC_MANIFEST.some(i => i.file === filename);
    }
    if (isStatic) return res.status(400).json({ error: "内置素材不可删除，仅支持删除自己上传的素材" });

    const uploads = await getUploadsManifest();
    const updated = uploads.filter(i => i.file !== filename);
    if (updated.length === uploads.length) return res.status(404).json({ error: "素材不存在" });

    const store = getBlobStore();
    if (store) {
      try { await store.delete("img:" + filename); } catch (e) { /* 忽略 */ }
    }
    await saveUploadsManifest(updated);
    res.json({ success: true, deleted: filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

exports.handler = serverless(app);
