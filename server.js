const express = require("express");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

const SCRIPTS_DIR = path.join(__dirname, "scripts");
const SOURCE_DIR = path.join(__dirname, "docs");

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    execFile("node", [scriptPath, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err && stderr && !stdout) return reject(new Error(stderr));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ raw: (stdout || stderr || "").trim() }); }
    });
  });
}

// 获取 AI 客户端（用户需要自行配置 API Key）
function getAIClient() {
  // Google Gemini 免费 API（推荐，每日1500次免费）
  const geminiKey = process.env.GEMINI_API_KEY;
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

  // Anthropic API（用户自行配置）
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const Anthropic = require("@anthropic-ai/sdk").default;
  const client = new Anthropic({ apiKey });
  client.model = "claude-sonnet-4-6";
  client.provider = "anthropic";
  return client;
}

// 统一 AI 调用（兼容 Gemini 和 Anthropic）
async function aiChat(ai, systemPrompt, userContent, maxTokens = 1024) {
  if (ai.provider === "gemini") {
    return await ai.chat(systemPrompt, userContent, maxTokens);
  }
  // Anthropic SDK
  const msg = await ai.messages.create({
    model: ai.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }]
  });
  return msg.content.find(c => c.type === "text")?.text || "";
}

function loadSourceDocs() {
  const files = [
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
  let docs = "";
  for (const file of files) {
    const fp = path.join(SOURCE_DIR, file);
    if (fs.existsSync(fp)) docs += `\n\n=== ${file} ===\n${fs.readFileSync(fp, "utf-8")}`;
  }
  return docs;
}

// 读取单个源文档
function readDoc(relPath) {
  const fp = path.join(SOURCE_DIR, relPath);
  if (!fs.existsSync(fp)) return "";
  let text = fs.readFileSync(fp, "utf-8");
  // 去多余空行
  text = text.replace(/\n{4,}/g, "\n\n\n").trim();
  return text;
}

// ========== API: 场景决策 ==========
app.post("/api/scene", async (req, res) => {
  try {
    const { scene } = req.body;
    if (!scene) return res.status(400).json({ error: "请输入场景描述" });
    res.json(await runScript("scene-match.js", [scene]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 规范问答 ==========
app.post("/api/ask", async (req, res) => {
  try {
    const { query, mode } = req.body;
    if (!query) return res.status(400).json({ error: "请输入问题" });
    const args = mode === "check" ? ["--check", query] : [query];
    res.json(await runScript("ask-check.js", args));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== API: 提示词生成 ==========
app.post("/api/prompt", async (req, res) => {
  try {
    const { scene, expression, action, prop, outfit, background, composition, extra, occupation, color } = req.body;
    if (!scene) return res.status(400).json({ error: "场景描述为必填" });

    // 场景检测：UI状态场景下IP保持默认形态不穿衣服
    const isUIState = /弹窗|空状态|结果页|加载|等待|Toast|轻提示|缺省|首页|闪屏|浮标|下拉刷新|确认|提示|系统|错误/.test(scene);
    const isActivity = /活动|营销|运营|双11|节日|推广|广告|品牌|周边|创意/.test(scene);
    const skipOutfit = isUIState && !isActivity;

    const ai = getAIClient();

    // ── AI 优化模式 ──
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
${!skipOutfit && occupation ? "职业/穿搭："+occupation+"（请根据职业详细推导穿搭样式、颜色、细节、配饰）" : ""}
${expression ? "表情："+expression : ""}
${action ? "动作："+action : ""}
${prop ? "道具："+prop : ""}
${color ? "主色调："+color : ""}
${background ? "背景："+background : ""}
${extra ? "额外描述："+extra : ""}
${composition ? "构图："+composition : ""}
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
      // 解析失败降级到模板
    }

    // ── 模板模式（无 API Key 或 AI 失败）──
    const parts = [];
    parts.push("参考图中的卡通形象");

    // 职业+穿搭合并为一项：UI状态场景下IP不穿衣服
    const occOrOutfit = occupation || outfit;
    if (occOrOutfit && !skipOutfit) {
      const inferred = inferOutfit(occOrOutfit);
      if (inferred) {
        parts.push(`，穿着${inferred}`);
      } else {
        parts.push(`，穿着${occOrOutfit}`);
      }
    } else if (skipOutfit) {
      // UI状态场景：IP保持默认形态，不穿衣服
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

    // 构建详细的穿搭描述（用于前端展示）
    let outfitDetail = "";
    if (skipOutfit) {
      outfitDetail = "UI状态场景 — IP保持默认形象（不穿衣服）";
    } else if (occOrOutfit) {
      const inferredOutfit2 = inferOutfit(occOrOutfit);
      outfitDetail = inferredOutfit2 || occOrOutfit;
    }
    let actionDesc = action || "";
    let colorDesc = color ? `整体色调以${color}为主` : "";

    res.json({
      prompt,
      outfitDetail,
      actionOptimized: actionDesc,
      colorScheme: colorDesc,
      params: { scene, expression, action, prop, outfit, background, composition, extra, occupation, color },
      optimized: false,
      hint: "设置 GEMINI_API_KEY（免费获取：aistudio.google.com）或 ANTHROPIC_API_KEY 可启用 AI 智能优化"
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 职业 → 穿搭/配饰推理（模板模式）
function analyzeOccupation(occ) {
  const map = {
    "白领": "干练利落气质，优雅职业姿态", "金领": "自信从容神态，高管气场", "上班族": "精神饱满，通勤职业姿态", "职场": "专业从容气质，自信干练姿态",
    "经理": "干练沉稳气质，专业自信姿态", "商务": "稳重专业神态，商务社交姿态", "公务员": "端正严谨神态，标准站姿",
    "金融": "严谨专业神态，锐利洞察目光", "会计": "细致专注表情，沉稳坐姿", "咨询顾问": "睿智洞察神态，从容自信站姿", "分析师": "深度思考表情，数据解读手势",
    "医生": "亲切温和神态，专业可靠姿态", "护士": "温柔体贴微笑，细心看护姿态", "药剂师": "细致严谨表情，专业配药手势", "牙医": "温和安抚神态，精密操作姿态", "兽医": "温柔关爱表情，动物安抚手势",
    "教师": "和蔼可亲表情，知识传递手势", "教授": "睿智深沉神态，学者风范站姿", "幼师": "温暖亲切笑容，蹲姿与儿童平视", "教练": "激励振奋表情，示范教学姿态",
    "程序员": "专注思考表情，双手自然垂放", "产品经理": "热情表达手势，逻辑推演神态", "设计师": "时尚品味神态，创意展示动作", "工程师": "严谨专注表情，实操演示手势", "运维": "随时响应神态，技术排查手势",
    "律师": "严谨正直神态，稳重站姿",
    "服务员": "亲切微笑，标准服务站姿", "前台": "甜美职业微笑，优雅接待手势", "客服": "耐心倾听神态，温和应答表情", "导游": "热情洋溢讲解表情，指引手势", "空乘": "优雅微笑，标准礼仪站姿", "理发师": "专注创作表情，精剪操作手势",
    "销售": "热情开朗笑容，自信说服手势", "房产中介": "诚恳推荐表情，专业介绍手势", "保险代理": "稳重可靠神态，耐心讲解姿态",
    "记者": "敏锐观察表情，采访提问手势", "摄影师": "专注构图神态，相机操作姿态", "导演": "艺术思考表情，指挥调度手势", "画家": "灵感迸发神态，画笔创作手势", "音乐家": "情感投入表情，演奏姿态", "作家": "沉思文艺神态，执笔创作手势", "编辑": "精细审阅表情，红色批注手势",
    "歌手": "情感饱满演唱表情，舞台表演姿态", "演员": "丰富戏剧表情，表演展示姿态", "舞者": "优雅灵动表情，舞蹈动作姿态", "网红主播": "活力互动表情，展示产品手势",
    "运动员": "活力四射表情，动感竞技姿态", "健身教练": "力量展示表情，标准示范动作", "瑜伽教练": "宁静平和表情，优雅体式示范",
    "厨师": "热情洋溢笑容，烹饪展示动作", "咖啡师": "专注手艺神态，拉花操作手势", "调酒师": "酷炫表演表情，花式调酒动作", "烘焙师": "温暖幸福笑容，烘焙制作手势",
    "消防员": "坚毅勇敢表情，随时待命姿态", "警察": "正直威严神态，标准立正站姿", "军人": "刚毅坚定表情，标准军姿",
    "快递员": "热情高效神态，派送交付手势", "外卖骑手": "快速送达表情，骑行姿态", "工人": "踏实勤劳表情，熟练操作姿态", "司机": "专注驾驶神态，标准坐姿", "农民": "质朴淳厚笑容，田间劳作姿态", "渔夫": "沧桑坚毅表情，撒网捕鱼姿态",
    "科学家": "探究好奇表情，实验展示手势",
    "学生": "青春活泼笑容，轻松自然站姿",
    "艺术家": "创意灵感神态，随性洒脱姿态",
  };
  // 按关键词长度降序匹配，避免"教练"误匹配"瑜伽教练"
  const sortedKeys = Object.keys(map).sort((a,b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (occ.includes(k)) return map[k];
  }
  return "";
}

function inferOutfit(occ) {
  const map = {
    // ── 通用职场 ──
    "白领": "浅灰色修身西装外套，白色丝绸飘带衬衫，黑色直筒九分西裤，黑色尖头高跟鞋，银色细链锁骨项链，简约皮革手提包，珍珠耳钉",
    "金领": "深藏青色意式西装三件套，温莎领白衬衫配金色袖扣，酒红色丝绸领带，黑色牛津雕花皮鞋，玫瑰金机械腕表，鳄鱼皮公文包",
    "上班族": "卡其色中长款风衣，白色圆领针织衫内搭，深蓝色直筒牛仔裤，棕色乐福鞋，帆布双肩背包，简约皮质腕表",
    "职场": "藏青色小西装外套，白色飘带系蝴蝶结衬衫，灰色九分烟管西裤，黑色中跟尖头皮鞋，珍珠耳钉，金属细框眼镜，链条小方包",
    "金融": "深炭灰色英式西装三件套，法式双叠袖白衬衫配银色袖扣，深蓝色斜纹领带，黑色牛津皮鞋，镶钻机械腕表，鳄鱼纹皮质公文包",
    "商务": "深蓝色暗条纹西装套装，意式尖领白衬衫，暗红色口袋巾，深棕色布洛克雕花皮鞋，金色袖扣，棕色皮革公文包",
    "公务员": "深蓝色行政夹克，白色衬衫内搭，深灰色西裤，黑色系带皮鞋，简约石英腕表，金属框架眼镜",
    // ── 医疗健康 ──
    "医生": "白色医用大褂（左胸口袋插笔），浅蓝色V领手术服内搭，听诊器挂于颈间，黑色软底休闲皮鞋，简约不锈钢腕表",
    "护士": "淡粉色短袖护士服（V领设计），白色护士裤，白色软底护士鞋，护士帽配蓝色横纹，胸口挂电子体温计，银色护士怀表",
    "药剂师": "白色短款药剂师大褂，浅绿色衬衫内搭，深色长裤，黑色软底便鞋，圆框金属眼镜，胸前工牌",
    "牙医": "浅蓝色短袖医用工作服，白色内搭T恤，深蓝色医用长裤，防护面罩推至额头，蓝色医用橡胶手套，白色防滑洞洞鞋",
    "兽医": "卡其色兽医工作服，浅绿色Polo衫内搭，深色工装裤，棕色防滑短靴，听诊器挂于胸前，动物图案胸针",
    // ── 教育 ──
    "教师": "浅灰色V领针织开衫，白色牛津纺衬衫内搭，深卡其色斜纹长裤，棕色皮革乐福鞋，玳瑁色板材眼镜，帆布托特包",
    "教授": "深棕色灯芯绒西装外套配皮质肘部补丁，浅蓝色牛津衬衫，深灰色羊毛西裤，棕色德比鞋，金丝圆框眼镜，皮质手提公文包",
    "幼师": "浅粉色连帽卫衣外套，白色纯棉T恤，浅蓝色牛仔裤，白色帆布鞋，彩色串珠手链，卡通图案帆布围裙",
    "教练": "深蓝色运动夹克外套，白色速干Polo衫，黑色运动长裤侧面白色条纹，专业跑鞋，哨子挂绳，运动电子表",
    // ── 科技/互联网 ──
    "程序员": "深灰色连帽卫衣外套，白色印花T恤内搭（印有代码图案），深蓝色直筒牛仔裤，白色运动鞋，黑框板材眼镜，双肩电脑背包",
    "产品经理": "浅蓝色牛津纺衬衫（领口微开），深灰色斜纹棉布长裤，棕色切尔西短靴，Apple Watch运动腕表，帆布双肩背包",
    "设计师": "黑色高领修身毛衣，不对称剪裁深灰色阔腿裤，切尔西短靴，黑框设计师眼镜（玳瑁色），银色简约项链，皮质斜挎小包",
    "工程师": "蓝色牛津纺衬衫卷袖至肘，白色T恤内搭，卡其色工装长裤多口袋设计，棕色工装短靴，黄色安全帽夹于腋下，银色机械腕表",
    "运维": "深蓝色防水冲锋衣外套，灰色抓绒内搭，黑色工装裤，黑色防水短靴，双肩工具背包，头戴式降噪耳机挂于颈间",
    // ── 金融/法律 ──
    "律师": "深灰色双排扣西装套装，法式翻袖白衬衫，深蓝色丝绸领带配银色领带夹，黑色牛津皮鞋配菱形格纹袜，玫瑰金袖扣，棕色鳄鱼皮公文包",
    "会计": "深蓝色单排扣西装，白色衬衫配灰色领带，黑色系带牛津鞋，银色边框眼镜，不锈钢石英腕表，黑色尼龙公文包",
    "咨询顾问": "深蓝色修身西装三件套，尖领白衬衫，银色袖扣，酒红色领带，黑色牛津鞋，极简腕表，碳纤维公文箱",
    "分析师": "灰色格纹西装外套，白色衬衫配深蓝针织领带，深灰色羊毛西裤，黑色德比鞋，黑框眼镜，皮质平板电脑包",
    // ── 服务行业 ──
    "服务员": "白衬衫配黑色蝴蝶领结，黑色修身马甲，黑色围裙半身（腰间系带），黑色直筒西裤，黑色防滑皮鞋，银色圆形托盘",
    "前台": "浅蓝色丝质衬衫配蝴蝶结飘带，深灰色A字半身裙，肤色丝袜，黑色中跟浅口皮鞋，珍珠耳钉，精致淡妆，银色胸针",
    "客服": "浅紫色V领针织衫，深灰色西裤，黑色乐福鞋，简约珍珠耳钉，头戴式降噪耳麦，淡雅裸色妆容",
    "导游": "亮色防晒冲锋衣外套，白色速干T恤，卡其色多口袋工装短裤，棕色户外徒步鞋，挂脖式证件套，遮阳帽，便携小蜜蜂扩音器",
    "空乘": "深蓝色空乘制服套装（收腰设计），蓝白条纹丝巾领结，黑色中跟浅口皮鞋，精致空乘妆容，珍珠耳钉，银色姓名胸牌",
    "理发师": "黑色修身V领T恤，深灰色围裙（多个口袋插剪刀和梳子），深色修身牛仔裤，黑色马丁靴，银色耳钉，手腕皮质工具包",
    // ── 销售/市场 ──
    "销售": "深蓝色修身西装套装，白色八字领衬衫，亮色图案领带，黑色系带商务皮鞋，玫瑰金机械腕表，黑色皮质手提公文包",
    "房产中介": "深灰色西装套装，白色衬衫配深蓝色领带，黑色尖头皮鞋，金色徽章胸针，皮质名片夹，黑色公文包",
    "保险代理": "深蓝色西装外套，浅蓝色衬衫配条纹领带，卡其色西裤，棕色皮鞋，金属徽章胸针，黑色皮革文件夹包",
    // ── 媒体/艺术 ──
    "记者": "深蓝色休闲西装外套，白衬衫（领口微开不系领带），深色牛仔裤，棕色沙漠靴，帆布斜挎相机包，挂脖式记者证",
    "摄影师": "多口袋黑色摄影马甲，深灰色T恤，卡其色工装裤，棕色户外徒步鞋，单反相机挂于胸前，棒球帽，户外手表",
    "导演": "黑色宽松亚麻衬衫，灰色阔腿休闲裤，黑色帆布鞋，深色棒球帽，银色项链，导演取景器挂于胸前，墨镜推至额头",
    "画家": "米白色宽松亚麻衬衫（袖口沾有颜料痕迹），深色阔腿裤，赤脚或帆布鞋，贝雷帽歪戴，木质调色盘手持，彩色围巾随意搭于肩上",
    "音乐家": "黑色立领修身演出服，白色衬衫配黑色领结，黑色正装皮鞋，小提琴或指挥棒手持，银色袖扣，精致发型",
    "作家": "深棕色羊绒开衫外套，浅灰色高领毛衣内搭，复古格子羊毛围巾，深色灯芯绒长裤，棕色麂皮软底便鞋，玳瑁色圆框眼镜，手持钢笔",
    "编辑": "深灰色针织开衫，白色圆领T恤内搭，黑色直筒长裤，黑色乐福鞋，黑框眼镜，红色标记笔插于耳后",
    // ── 演艺/表演 ──
    "歌手": "亮片装饰修身舞台礼服，深V领设计，高跟过膝长靴或银色细高跟，层叠金属项链，闪亮耳坠，舞台妆感浓重眼妆，手持无线麦克风",
    "演员": "经典白衬衫外搭深色背带，深灰色西装长裤，棕色复古牛津鞋，复古圆形墨镜，皮质旅行手提箱，丝巾点缀",
    "舞者": "黑色修身芭蕾练功服（交叉背带设计），粉色芭蕾舞鞋（缎面绑带缠绕小腿），驼色护腿针织袜套，束发带，精致锁骨项链",
    "网红主播": "时尚oversize西装外套，白色短款内搭露出腰线，高腰阔腿牛仔裤，白色厚底运动鞋，环形大耳环，多层金属手链，环形补光灯",
    // ── 运动/户外 ──
    "运动员": "速干面料运动套装（拼接撞色设计），专业跑鞋（荧光色厚底气垫底），吸汗运动腕带，运动发带，运动电子表",
    "健身教练": "修身透气运动背心，弹力运动压缩长裤（侧面网眼透气设计），专业训练鞋，运动手套，吸汗毛巾搭于肩上，运动手环",
    "瑜伽教练": "莫代尔棉修身运动背心，高腰弹力瑜伽长裤，赤脚，檀木念珠手链，瑜伽垫卷起夹于腋下，发髻盘发",
    // ── 美食/餐饮 ──
    "厨师": "白色双排扣厨师制服（立领设计），黑色纽扣，厨师高帽，黑白条纹围裙腰间系带，黑色防滑厨师鞋，白色毛巾搭于肩上",
    "咖啡师": "卡其色帆布围裙（多口袋设计），白衬衫卷袖至肘部，深色修身牛仔裤，棕色工装短靴，皮质手腕带，帆布杯套",
    "调酒师": "黑色修身马甲配白色衬衫，黑色领结，深灰色西裤，黑色牛津鞋，银色调酒勺插于胸前口袋，手腕皮质护腕，复古背带",
    "烘焙师": "白色短袖面包师制服（圆领设计），白色围裙沾有面粉痕迹，黑白格子长裤，白色防滑厨师鞋，白色面包师帽，隔热手套",
    // ── 其他职业 ──
    "消防员": "深蓝色消防员制服，黄色反光条带，消防头盔，黑色防护手套，黑色消防靴，对讲机挂于肩章",
    "警察": "深蓝色警服制服（修身版型），银色警徽和编号胸牌，黑色执勤腰带配手铐套和弹夹套，黑色军靴，警帽",
    "军人": "迷彩军服作战套装，战术背心多口袋设计，军靴系带至小腿，头盔，臂章，战术手套",
    "快递员": "品牌红色冲锋衣工作服，深灰色速干T恤内搭，黑色工装长裤，黑色防滑运动鞋，头盔，手持电子签收终端",
    "外卖骑手": "亮黄色防风防水骑行外套（反光条设计），黑色骑行长裤，骑行头盔，防滑骑行手套，骑行靴，保温配送箱背包",
    "工人": "橙色反光安全背心外套，深蓝色工装连体裤多口袋设计，黄色安全头盔，厚底防砸工装靴，劳保手套",
    "司机": "白衬衫配黑色领带，深蓝色西裤，黑色皮鞋，白色驾驶手套，墨镜，银色车钥匙",
    "农民": "浅色宽檐草帽，白色棉麻短袖衬衫，深蓝色宽松棉布裤卷至小腿，赤脚或草编凉鞋，搭肩白色毛巾，锄头倚于肩",
    "渔夫": "亮黄色防水橡胶背带裤连靴一体，白色长袖厚棉T恤，防风雨渔夫帽，防水手套，渔网搭于肩上",
  };
  // 按关键词长度降序匹配，长词优先（如"瑜伽教练"优先于"教练"）
  const sortedKeys = Object.keys(map).sort((a,b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (occ.includes(k)) return map[k];
  }
  return "";
}

// ========== API: 创意工坊（AI）==========
app.post("/api/create", async (req, res) => {
  try {
    const { requirement } = req.body;
    if (!requirement) return res.status(400).json({ error: "请输入业务需求" });
    const ai = getAIClient();
    if (!ai) return res.status(500).json({ error: "未配置 API Key。请设置 GEMINI_API_KEY（免费，无需信用卡）或 ANTHROPIC_API_KEY 环境变量" });
    const sourceDocs = loadSourceDocs();
    const text = await aiChat(ai,
      `你是58金融品牌IP"福宝"的创意顾问。福宝是一只软萌可爱的3D卡通海獭形象（不是熊）。以下为IP规范文档，请基于文档内容为用户设计创意方案。\n\n${sourceDocs}\n\n请输出JSON：{"creativeDirection":"创意方向","expression":"表情","action":"动作","prop":"道具","outfit":"穿搭","background":"背景","prompts":["prompt1"],"usageNote":"应用说明"}`,
      requirement,
      2048
    );
    const m = text.match(/\{[\s\S]*\}/);
    res.json(m ? JSON.parse(m[0]) : { raw: text });
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
      { title: "IP手册", file: "IP手册", content: readDoc("IP 应用规范文档/IP手册.md") },
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
      { title: "品牌与周边案例", file: "品牌与周边案例", content: readDoc("IP 应用规范文档/ip使用规范全场景/品牌与周边案例.md") },
    ]
  };
  res.json(handbook);
});

// ========== API: IP素材库 ==========
app.get("/api/materials", (req, res) => {
  const manifestPath = path.join(__dirname, "public", "assets", "manifest.json");
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: "素材清单未找到" });
  let items = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const category = req.query.category;
  if (category) {
    items = items.filter(i => i.category === category || i.tag === category);
  }
  // 按分类分组
  const grouped = {};
  for (const item of items) {
    const cat = item.category || "未分类";
    if (!grouped[cat]) grouped[cat] = { category: cat, tag: item.tag || "", count: 0, files: [] };
    grouped[cat].count++;
    grouped[cat].files.push({ file: item.file, width: item.width, height: item.height, sizeKB: item.sizeKB });
  }
  res.json({ total: items.length, categoryFilter: category || null, groups: Object.values(grouped) });
});

// ========== API: 素材上传 ==========
app.post("/api/materials/upload", (req, res) => {
  try {
    const { filename, data, category } = req.body;
    if (!filename || !data) return res.status(400).json({ error: "缺少文件名或图片数据" });

    // 解析 base64 数据
    const matches = data.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "图片数据格式不正确" });
    const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    // 安全文件名
    const safeName = filename.replace(/[^a-zA-Z0-9_\-一-鿿\.]/g, "_");
    const finalName = safeName.includes(".") ? safeName : safeName + "." + ext;
    const filePath = path.join(__dirname, "public", "assets", finalName);

    // 避免覆盖：重名加时间戳
    const finalPath = fs.existsSync(filePath)
      ? filePath.replace(/(\.[^.]+)$/, `_${Date.now()}$1`)
      : filePath;
    const savedName = path.basename(finalPath);

    fs.writeFileSync(finalPath, buffer);

    // 更新 manifest.json
    const manifestPath = path.join(__dirname, "public", "assets", "manifest.json");
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : [];
    manifest.push({
      file: savedName,
      width: 0, height: 0,
      sizeKB: Math.round(buffer.length / 1024),
      category: category || "用户上传",
      tag: "上传"
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    res.json({ success: true, file: savedName, sizeKB: Math.round(buffer.length / 1024) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== API: 素材删除 ==========
app.delete("/api/materials/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "public", "assets", filename);
    const manifestPath = path.join(__dirname, "public", "assets", "manifest.json");

    // 安全检查：不允许路径穿越
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ error: "无效文件名" });
    }

    // 删除文件
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // 从 manifest 中移除
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const updated = manifest.filter(i => i.file !== filename);
      fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
    }

    res.json({ success: true, deleted: filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== API: AI 状态检测 ==========
app.get("/api/status", (req, res) => {
  const ai = getAIClient();
  res.json({ aiAvailable: !!ai, provider: ai ? ai.provider : null });
});

if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🦦 http://localhost:${PORT}`));
}
module.exports = app;
