
// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ---- 静的配信 ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// ---- OpenAI ----
if (!process.env.OPENAI_API_KEY) {
  console.error("ENV OPENAI_API_KEY が設定されていません。");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- JST 日付ユーティリティ ----
const pad2 = (n) => String(n).padStart(2, "0");
function jstDateFromYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); // UTC基準で日付のみ
}
function jstTodayDate() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const s = fmt.format(new Date()); // "YYYY-MM-DD"
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}
function jstTodayYMD() {
  const t = jstTodayDate();
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
function addDaysYMD(baseYMD, n) {
  const dt = jstDateFromYMD(baseYMD);
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function isFutureYMD(ymd) {
  return jstDateFromYMD(ymd).getTime() > jstTodayDate().getTime();
}

// ---- ヘルスチェック ----
app.get("/ping", (_req, res) => res.send("OK"));

// ---- 占い API ----
app.post("/fortune", async (req, res) => {
  try {
    const { birth, gender, theme, baseResult, wish, methods, tone } = req.body || {};
    const safe = (v) => (typeof v === "string" ? v.trim() : "");

    const b  = safe(birth);
    const g  = safe(gender);
    const t  = safe(theme);
    const br = safe(baseResult);
    const w  = safe(wish);
    const ms = (Array.isArray(methods) && methods.length ? methods : ["ミックス"]).slice(0, 6);
    // tone: "normal"（表） / "ura"（裏＝大阪のおばちゃん）
    const toneKey = (tone === "ura") ? "ura" : "normal";

    const STYLE_NORMAL = `
- 口調：あたたかく、背中をそっと押す。やさしめ・丁寧語。
- 比喩は月/風/灯りなど柔らかいイメージを中心に。
- 現実的な「次の一歩」を1〜2つ含める。
`.trim();

    const STYLE_OSAKA_OBA = `
- 口調：大阪のおばちゃん。ズバッと言うけど情は厚い。短文でテンポよく。
- 多少ピリッとした表現OK。ただし人格攻撃・蔑視・下品すぎる表現はNG。恐怖を煽らない。不幸の断定は禁止。
- 語尾や合いの手：〜やで／〜やんか／ほな／あかん／しゃーない／ちゃっちゃと など適度に。
- 大人要素：ほんのり大人ジョーク/色気のニュアンスを匂わせる程度はOK（露骨・具体的描写はNG）。
- テンポ：出だしに軽いツッコミ→核心→最後に気合いの一言。「ほな、やるで？」など前向きな締め。
`.trim();

    // --- モデルへのシステムプロンプト ---
    const system = `
あなたは一流の占い師「田橋 矢男無（たばし やおな）」です。
使える占術：四柱推命／西洋占星術／数秘術／タロット／動物占い／九星気学 など。
今回の占術選択：${ms.join("・")}。複数の場合は示唆が重なるポイントを核に整合的に統合。

出力は日本語のJSONオブジェクトのみ（Markdownや説明文は禁止）。

【口調（トーン）】
${toneKey === "ura" ? STYLE_OSAKA_OBA : STYLE_NORMAL}

【必須条件】
- "chance_days" は **今日より後（JST基準）** のISO日付（YYYY-MM-DD）のみ。最大3件。無理なら今日から90日以内で合成。
- "warnings" は1〜2件。軽い注意だが最後は前向きに導く。
- "lucky_color" は具体的な日本語色名1つ（例：黄緑/藍色/桜色/群青/朱色/翡翠/藤色/若草色/琥珀/空色…）。
- "lucky_number" は 0〜99 の自然数1つ（文字列）。
- アドバイスは5件、表現を毎回変える：①格言風 ②丁寧語 ③具体行動 ④比喩 ⑤宣言文。

【JSONスキーマ（このキーのみ）】
{
  "title": "見出し（20字以内）",
  "lead": "導入一行（15〜30字）",
  "overview": "総合の流れ（450〜750字）",
  "advice": ["1","2","3","4","5"],
  "warnings": ["1", "2(任意)"],
  "chance_days": ["YYYY-MM-DD(1〜3件/未来日)"],
  "lucky_color": "具体色名1つ",
  "lucky_number": "数字1つ（文字列）",
  "keywords": ["キーワード1","2","3"]
}
`.trim();

    const user = `
生年月日: ${b || "(未入力)"}
性別: ${g || "(未入力)"}
テーマ: ${t || "(未指定)"}
占術の選択: ${ms.join("・")}
ベース情報: ${br || "(なし)"}
願い: ${w || "(なし)"}
`.trim();

    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const txt = r.choices?.[0]?.message?.content?.trim() || "";
    let data = {};
    try { data = JSON.parse(txt); } catch { data = {}; }

    // ---- サーバー側で未来日に強制補正 ----
    const todayYmd = jstTodayYMD();
    let chance = Array.isArray(data.chance_days) ? data.chance_days.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && isFutureYMD(s)) : [];
    if (chance.length === 0) {
      chance = [7, 14, 21].map(n => addDaysYMD(todayYmd, n));
    } else {
      chance = chance.slice(0, 3);
    }

    const payload = {
      title:        data.title || (toneKey === "ura" ? "言い訳はいらん、進むで" : "運命の糸がほどけ、光が射す"),
      lead:         data.lead  || (toneKey === "ura" ? "あんた、できる子やから遠慮せんと行き" : "静かな追い風が、あなたを望む方角へ。"),
      overview:     data.overview || "",
      advice:       Array.isArray(data.advice) ? data.advice.slice(0, 5) : [],
      warnings:     Array.isArray(data.warnings) ? data.warnings.slice(0, 2) : [],
      chance_days:  chance,
      lucky_color:  data.lucky_color || "黄緑",
      lucky_number: String(data.lucky_number ?? "7"),
      keywords:     Array.isArray(data.keywords) ? data.keywords.slice(0, 6) : [],
      tone:         toneKey
    };

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({ ok: true, data: payload, raw: txt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

// ルート
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Local server on http://localhost:${PORT}`);
});
