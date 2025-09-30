
// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/ping", (_req, res) => res.send("OK"));

app.post("/fortune", async (req, res) => {
  try {
    const { birth, gender, theme, baseResult, wish, methods } = req.body || {};
    const safe = (v) => (typeof v === "string" ? v.trim() : "");
    const b  = safe(birth);
    const g  = safe(gender);
    const t  = safe(theme);
    const br = safe(baseResult);
    const w  = safe(wish);
    const ms = Array.isArray(methods) && methods.length ? methods.slice(0,6) : ["ミックス"];

    const system = `
あなたは一流の占い師「田橋 矢男無（たばし やおな）」です。
使える占術：四柱推命／西洋占星術／数秘術／タロット／動物占い／九星気学 など。
今回の占術選択：${ms.join("・")}。複数の場合は示唆が重なるポイントを核に、整合的に統合してください。

出力は **日本語のJSONオブジェクトのみ**（Markdownや説明文は禁止）。

【必須条件】
- 「チャンスの日」は **今日より後** の日付のみ（ISO YYYY-MM-DD）。最大3件。無理なら今日から90日以内で合成。
- 「warnings」は1〜2件だけ。軽い注意喚起に留め、最後は前向きに導く。
- 「lucky_color」は具体的な日本語色名（例：黄緑／藍色／桜色／群青／朱色／翡翠／藤色／若草色／琥珀／空色…）から1つ。
- 「lucky_number」は 0〜99 の自然数1つ（文字列）。

【アドバイスの多様化】
- 5件すべて**言い回しを変える**。各1つずつ：①格言・箴言風 ②やわらか丁寧語 ③具体的行動指示 ④比喩・イメージ ⑤前向きな宣言文。
- 内容が似ても**表現が被らない**ように。

【JSON形式（このキーのみ）】
{
  "title": "見出し（20字以内）",
  "lead": "導入一行（15〜30字）",
  "overview": "総合の流れ（450〜750字・段落意識）",
  "advice": ["助言1","2","3","4","5"],
  "warnings": ["軽い注意1", "軽い注意2（任意）"],
  "chance_days": ["YYYY-MM-DD 1〜3件（未来日）"],
  "lucky_color": "具体色名1つ（例：黄緑）",
  "lucky_number": "数字1つ（文字列）",
  "keywords": ["キーワード1","2","3"]
}
`.trim();

    const user = `
生年月日: ${b}
性別: ${g}
テーマ: ${t}
占術の選択: ${ms.join("・")}
ベース情報: ${br || "（特になし）"}
願い: ${w || "（特になし）"}
`.trim();

    const r = await client.chat.completions.create({
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

    res.json({ ok: true, data, raw: txt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 8787;
// 0.0.0.0 で受けておくとスマホからも見やすい（FW許可は別途）
app.listen(PORT, "0.0.0.0", () => console.log(`Local server on http://localhost:${PORT}`));
