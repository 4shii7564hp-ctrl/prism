// 依存パッケージ不要のローカルサーバ。
//  - 静的ファイル（index.html）を配信
//  - POST /api/chat を Anthropic API に中継し、x-api-key をサーバ側で付与
// 使い方:  node server.js   （同フォルダの .env から ANTHROPIC_API_KEY を読む）
const http = require("http");
const fs = require("fs");
const path = require("path");

// ── .env を雑にパース（KEY=VALUE の行だけ） ──────────────
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (_) { /* .env が無ければ環境変数をそのまま使う */ }
})();

const PORT = process.env.PORT || 5599;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
// プロバイダ選択: AI_PROVIDER で明示指定。無指定なら GEMINI_API_KEY があれば gemini（無料枠）を優先
const PROVIDER = process.env.AI_PROVIDER || (GEMINI_KEY ? "gemini" : "anthropic");
const MODEL = PROVIDER === "gemini"
  // flash-latest はこのキーだと1回20秒超と激遅。flash-lite-latest は約1秒で会話品質も十分。
  ? (process.env.GEMINI_MODEL || "gemini-flash-lite-latest")
  : (process.env.CLAUDE_MODEL || "claude-opus-4-8");

// Geminiの responseSchema は additionalProperties 非対応なので再帰的に除去
function stripAdditional(s) {
  if (Array.isArray(s)) return s.map(stripAdditional);
  if (s && typeof s === "object") {
    const o = {};
    for (const k in s) { if (k === "additionalProperties") continue; o[k] = stripAdditional(s[k]); }
    return o;
  }
  return s;
}

// Anthropic Messages形式のリクエスト → Gemini generateContent 呼び出し → Anthropic形式のレスポンスに変換
// （フロントは常にAnthropic形式で話す。プロバイダ差はここで吸収する）
async function relayGemini(body, res) {
  try {
    const req = JSON.parse(body);
    const sys = Array.isArray(req.system)
      ? req.system.map((b) => b.text || "").join("\n")
      : (req.system || "");
    const contents = (req.messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));
    const generationConfig = {
      maxOutputTokens: req.max_tokens || 2000,
      // Gemini 2.5系は既定で「思考」に出力トークンを大量消費し、会話が伸びるとJSONが途中で切れて
      // 失敗→オフライン転落の原因になる。チャット用途では思考不要なのでオフにして安定＆高速化。
      thinkingConfig: { thinkingBudget: 0 },
    };
    const schema = req.output_config && req.output_config.format && req.output_config.format.schema;
    if (schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = stripAdditional(schema);
    }
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents, generationConfig }),
      }
    );
    const data = await upstream.json();
    if (data.error) {
      res.writeHead(upstream.status || 502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: data.error.message || "Gemini API error" } }));
    }
    const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
    if (!text) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Geminiから空の応答が返りました" + (data.candidates?.[0]?.finishReason ? `（finishReason: ${data.candidates[0].finishReason}）` : "") } }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text }], model: MODEL }));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Gemini中継失敗: " + (e.message || e) } }));
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const server = http.createServer(async (req, res) => {
  // ── ヘルスチェック（フロントがAIモードを使えるか判定する） ──────────────
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      ai: PROVIDER === "gemini" ? !!GEMINI_KEY : !!API_KEY,
      provider: PROVIDER,
      model: MODEL,
    }));
  }

  // ── チャット中継 ──────────────
  if (req.method === "POST" && req.url === "/api/chat") {
    if (PROVIDER === "gemini" ? !GEMINI_KEY : !API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "サーバにAPIキーが設定されていません。4nin-soudan/.env に GEMINI_API_KEY（無料）か ANTHROPIC_API_KEY を書いてください。" } }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (PROVIDER === "gemini") return relayGemini(body, res);
      try {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body, // フロントから来たJSONをそのまま転送
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(text);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "中継失敗: " + (e.message || e) } }));
      }
    });
    return;
  }

  // ── 静的配信 ──────────────
  let file = decodeURIComponent(req.url.split("?")[0]);
  if (file === "/" || file === "") file = "/index.html";
  const full = path.join(__dirname, path.normalize(file));
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  4人の作戦会議  →  http://localhost:${PORT}`);
  const keyOk = PROVIDER === "gemini" ? !!GEMINI_KEY : !!API_KEY;
  console.log(`  AIプロバイダ: ${PROVIDER} / ${MODEL}`);
  console.log(`  APIキー: ${keyOk ? "読み込みOK ✅" : "未設定 ⚠  ( 4nin-soudan/.env に GEMINI_API_KEY か ANTHROPIC_API_KEY を書いてください )"}\n`);
});
