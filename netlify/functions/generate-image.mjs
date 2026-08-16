// Seedream 5.0 Lite 生图（Netlify v2 函数，同步上限 60 秒）
// 独立于 v1 的 api.js：带参考图时方舟同步阻塞 30-40 秒，v1 函数 30 秒超时不够
const SEEDREAM_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const SEEDREAM_MODEL = "doubao-seedream-5-0-260128";

function seedreamSubmit(prompt, imageDataURIs, size) {
  const body = { model: SEEDREAM_MODEL, prompt, size, response_format: "b64_json", output_format: "png", watermark: false };
  if (imageDataURIs.length) body.image = imageDataURIs;
  return fetch(SEEDREAM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.ARK_API_KEY },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

function seedreamQuery(taskId) {
  return fetch(SEEDREAM_ENDPOINT + "/" + taskId, {
    headers: { Authorization: "Bearer " + process.env.ARK_API_KEY }
  }).then(r => r.json());
}

function extractImage(d) {
  if (d && Array.isArray(d.data) && d.data.length) {
    const item = d.data[0];
    if (item.b64_json) return "data:image/png;base64," + item.b64_json;
    if (item.url) return item.url;
    if (Array.isArray(item.image_urls) && item.image_urls.length) {
      const u = item.image_urls[0];
      return typeof u === "string" ? u : (u.url || null);
    }
  }
  return null;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers || {}) }
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (!process.env.ARK_API_KEY) {
      return json({ error: "未配置 Seedream API Key，请在 Netlify 环境变量中设置 ARK_API_KEY" }, 503, CORS);
    }
    const url = new URL(req.url);
    // 路径可能是 /generate-image 或 /generate-image/:taskId（经 redirect 转发后保留后缀）
    const path = url.pathname.replace(/^\/?\.netlify\/functions\/generate-image/, "").replace(/\/+$/, "");

    // GET /:taskId —— 前端轮询任务结果
    const mGet = path.match(/^\/([A-Za-z0-9_-]+)$/);
    if (req.method === "GET" && mGet) {
      const q = await seedreamQuery(mGet[1]);
      if (q.status === "failed") {
        return json({ error: "生成失败: " + ((q.error && q.error.message) || "未知错误") }, 500, CORS);
      }
      const img = extractImage(q);
      if (img) return json({ image: img }, 200, CORS);
      return json({ pending: true, taskId: mGet[1], status: q.status || "running" }, 200, CORS);
    }

    // POST / —— 提交生图（带参考图时方舟同步返回图片，30-40 秒）
    if (req.method === "POST" && path === "") {
      const body = await req.json().catch(() => null);
      if (!body || !body.prompt) return json({ error: "缺少 prompt 参数" }, 400, CORS);
      const prompt = String(body.prompt);
      const refs = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
        .filter(x => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 2);
      const size = /^\d{3,4}x\d{3,4}$/.test(body.size || "") ? body.size : "2048x2048";
      const finalPrompt = prompt + (refs.length
        ? "\n严格保持参考图中IP形象的特征完全一致（脸型、五官、配色、身体比例不变），仅根据提示词调整动作、服装、道具与场景。"
        : "");

      const data = await seedreamSubmit(finalPrompt, refs, size);
      if (!data || data.error) {
        return json({ error: "方舟提交失败: " + JSON.stringify(data).slice(0, 300) }, 500, CORS);
      }
      const img = extractImage(data);
      if (img) return json({ image: img, size, model: SEEDREAM_MODEL }, 200, CORS);

      const taskId = data.id || data.task_id;
      if (!taskId) {
        return json({ error: "方舟返回格式无法识别: " + JSON.stringify(data).slice(0, 300) }, 500, CORS);
      }
      // 异步任务：后端轮询最多 50 秒（函数上限 60 秒），未完成则交回前端继续轮询
      const deadline = Date.now() + 50000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        const q = await seedreamQuery(taskId);
        if (q.status === "failed") {
          return json({ error: "生成失败: " + ((q.error && q.error.message) || "未知错误") }, 500, CORS);
        }
        const qImg = extractImage(q);
        if (qImg) return json({ image: qImg, size, model: SEEDREAM_MODEL }, 200, CORS);
      }
      return json({ pending: true, taskId, size }, 200, CORS);
    }

    return json({ error: "Not found" }, 404, CORS);
  } catch (e) {
    return json({ error: e.message }, 500, CORS);
  }
};
