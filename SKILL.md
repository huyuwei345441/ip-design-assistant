---
name: ip-manager
description: 58金融品牌IP"福宝"形象设计助手。提供规范顾问、提示词生成、创意工坊、IP素材库、IP规范手册五大能力。
argument-hint: "[查规范|场景决策|生成提示词|创意方案|素材库|规范手册] <问题>"
metadata:
  author: 58金融设计团队
  version: "2.1.0"
---

# 福宝 IP 设计助手

58金融品牌IP"福宝"（海獭形象）的设计运维工具。五大模块覆盖IP设计全流程。

## 环境

- 后端服务：`http://localhost:3000`（Express.js，`npm start`）
- 脚本目录：`scripts/`
- 知识库：`../../ip设计助手skill/` 目录下 16 个 Markdown 参考文档
- **AI 功能需要用户自行配置免费 API Key**（Google Gemini，无需信用卡）

---

## 五大模块

### 1. 🎯 规范顾问

**功能**：两种模式自动切换
- **查规范**：回答 IP 使用规范问题（尺寸、位置、颜色、原则等）
- **场景决策**：根据场景描述推荐 IP 配置方案（弹窗类型、位置、文案、约束）

**调用**：
```bash
# 脚本
node scripts/ask-check.js "弹窗IP离关闭按钮多远"
# API
curl -s http://localhost:3000/api/ask -H "Content-Type: application/json" -d '{"query":"<问题>"}'
curl -s http://localhost:3000/api/scene -H "Content-Type: application/json" -d '{"scene":"<场景>"}'
```

---

### 2. ✨ 提示词生成

**功能**：结构化参数 → AI 优化（或模板推导） → 标准化生图 Prompt。

**表单字段**：使用场景*、职业/穿搭（自动推导）、表情、颜色、动作（双手姿态）、道具、背景、额外描述

**关键规则**：
- UI 状态场景（弹窗/空状态/Toast等）→ IP 保持默认形态不穿衣服
- 运营活动场景 → 根据职业推导详细穿搭（样式、颜色、细节、配饰）
- Prompt 尾部固定包含"头身比1:1"
- 需搭配 IP 参考图生图

**调用**：
```bash
curl -s http://localhost:3000/api/prompt -H "Content-Type: application/json" \
  -d '{"scene":"活动弹窗","occupation":"白领","color":"正红色","expression":"微笑"}'
```

**职业穿搭推导**：内置 60+ 职业库（白领/医生/教师/程序员等），AI 模式覆盖任意职业。
配置 `GEMINI_API_KEY`（免费）或 `ANTHROPIC_API_KEY` 启用 AI 智能优化。

---

### 3. 💡 创意工坊

**功能**：输入业务需求 → AI 生成完整创意方案（方向/表情/动作/道具/穿搭/背景/Prompts）。

**调用**：
```bash
curl -s http://localhost:3000/api/create -H "Content-Type: application/json" \
  -d '{"requirement":"58好借双11活动，面向新市民"}'
```

**🔑 API Key 配置（用户自行设置，免费）**：
```bash
# 推荐：Google Gemini（免费，1500次/日，无需信用卡）
# 到 https://aistudio.google.com/ 获取 Key
export GEMINI_API_KEY=你的密钥

# 或：Anthropic Claude
export ANTHROPIC_API_KEY=你的密钥
```

未配置 Key 时网页显示"待接入"引导界面，不消耗任何人额度。

---

### 4. 🖼️ IP素材库

**功能**：浏览 69 张福宝 IP 素材，支持上传、下载、删除。

**API**：
```bash
# 素材列表
curl -s http://localhost:3000/api/materials | jq .
# 按分类筛选（可选）
curl -s "http://localhost:3000/api/materials?category=IP状态图例" | jq .
# 上传（base64）
curl -s -X POST http://localhost:3000/api/materials/upload \
  -H "Content-Type: application/json" -d '{"filename":"img.png","data":"data:image/png;base64,..."}'
# 删除
curl -s -X DELETE "http://localhost:3000/api/materials/filename.png"
```

---

### 5. 📖 IP规范手册

**功能**：品牌规范 + UI 规范文档浏览，支持 Markdown 图片和链接渲染。

**文档**：品牌规范 5 篇 + UI 规范 11 篇

**调用**：
```bash
curl -s http://localhost:3000/api/handbook | jq .
```

---

## 核心规范速查

### 弹窗规范
| 弹窗类型 | IP位置 | IP高度 | 组合模式 |
|----------|--------|--------|----------|
| 确认弹窗 | 上方居右或居中，可破形 | 200-400px | IP+标题+说明+按钮 |
| 提示弹窗 | 上方居右或居中，可破形 | 200-400px | IP+标题+说明+按钮 |
| 活动/营销弹窗 | 上方，可破形 | 200-400px | IP+标题+内容+按钮 |
| 轻提示Toast | 容器内左侧或内右侧 | ≥100px | IP+文案 |
| 底部弹窗 | 上方居右或居中，可破形 | 200-400px | IP+标题+列表+按钮 |

### 核心约束
- IP上沿可超出弹窗 ≤ 自身高度1/3
- IP下沿距离标题文字 ≥ 32px
- 关闭按钮热区范围：88×88px
- 主操作按钮上方16px区域不可遮挡
- 同一页面IP不超过1处（浮标除外）
- IP动画时长不超过5秒
- **UI状态场景（弹窗/空状态/Toast等）IP不穿衣服，保持默认形态**

### 流程可用性
- ✅ 可用：启动/闪屏、首页、弹窗、活动页、加载/等待、结果页、空状态、浮标（条件）
- 🚫 不可用：支付流程、密码/验证码、人脸/生物识别、协议签署、风险提示、500错误、数据报表

### 品牌色
- 信任蓝 #0058FF（消金品牌色）
- 心意橙 #FF4614（乐业贷品牌色）

---

## 脚本速查

| 脚本 | 功能 | 用法 |
|------|------|------|
| `scripts/ask-check.js` | 规范顾问 | `node scripts/ask-check.js "<问题>"` |
| `scripts/generate-prompt.js` | 提示词生成 | `node scripts/generate-prompt.js --scene "..."` |
| `scripts/scene-match.js` | 场景决策 | `node scripts/scene-match.js "<场景>"` |

## API 速查

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/ask` | POST | 规范问答 |
| `/api/scene` | POST | 场景决策 |
| `/api/prompt` | POST | 提示词生成（支持 AI 优化） |
| `/api/create` | POST | 创意工坊（需用户配置 API Key） |
| `/api/materials` | GET | 素材库列表 |
| `/api/materials/upload` | POST | 素材上传 |
| `/api/materials/:filename` | DELETE | 素材删除 |
| `/api/handbook` | GET | 规范手册文档 |
| `/api/status` | GET | AI 可用状态检测 |
