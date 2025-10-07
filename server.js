// server.js (JSON安定性強化版)

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

app.get("/ping", (_req,res)=>res.send("OK"));

// === 占術データ簡易計算ロジック (変更なし) ===
function getKyuusei(year){
  const n = (year - 1864) % 9;
  const map = [7, 6, 5, 4, 3, 2, 1, 9, 8]; 
  const starNum = map[n];
  const starName = ["一白水星", "二黒土星", "三碧木星", "四緑木星", "五黄土星", "六白金星", "七赤金星", "八白土星", "九紫火星"][starNum - 1];
  return starName || "不明";
}

function getJuuniunsei(birth){
    const date = new Date(birth + "T00:00:00");
    const year = date.getFullYear();
    const map = {
        0: "衰", 1: "病", 2: "死", 3: "墓", 4: "絶", 5: "胎", 6: "養", 7: "長生", 8: "沐浴", 9: "冠帯", 10: "建禄", 11: "帝旺"
    };
    const simpleIndex = Math.floor((year % 100 + date.getMonth() * 3 + date.getDate()) % 12);
    return map[simpleIndex] || "不明";
}

function generateBiorhythm(birthStr){
    const base = new Date(birthStr + "T00:00:00");
    const kyuusei = getKyuusei(base.getFullYear());
    const juuniunsei = getJuuniunsei(base.getFullYear());
    
    let seed = (kyuusei.length*100) + (juuniunsei.length*50) + base.getDate();
    
    const biorhythmData = Array.from({length:14},(_,i)=>{
        const date = new Date(); date.setDate(date.getDate()+i);
        const scoreSeed = seed + date.getDate() + i * 10;
        const core = 55 + (scoreSeed % 45); 
        const wave = Math.round(12*Math.sin((i/3)*Math.PI));
        const score = Math.max(35,Math.min(100,core+wave));
        return {date: date.toISOString().substring(0,10), score: score};
    });
    return biorhythmData;
}

// 未来日だけを返すヘルパ (変更なし)
function ensureFutureDays(arr, max=3){
  const out=[];
  const today=new Date(); today.setHours(0,0,0,0);
  (arr||[]).forEach(s=>{
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return;
    const dt = new Date(+m[1], +m[2]-1, +m[3]);
    if(dt>today && out.length<max) out.push(s);
  });
  while(out.length<Math.min(max,3)){
    const plus = 7*(out.length+1);
    const t=new Date(today); t.setDate(t.getDate()+plus);
    const z=n=>String(n).padStart(2,"0");
    out.push(`${t.getFullYear()}-${z(t.getMonth()+1)}-${z(t.getDate())}`);
  }
  return out;
}

app.post("/fortune", async (req,res)=>{
  try{
    const { birth, gender, theme, baseResult, wish, methods, mode } = req.body || {};
    const safe = v => typeof v==="string" ? v.trim() : "";
    const b = safe(birth), g=safe(gender), t=safe(theme), br=safe(baseResult), w=safe(wish);
    const ms = Array.isArray(methods)&&methods.length? methods.slice(0,6) : ["ミックス"];
    const userMode = (mode==="ura"?"ura":"hon");

    // 年齢判定と占術データの算出
    let age = 0;
    const kyuusei = getKyuusei(+b.substring(0,4));
    const juuniunsei = getJuuniunsei(b);
    const biorhythmData = generateBiorhythm(b);

    try{
      const m = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(m){
        const bd=new Date(+m[1], +m[2]-1, +m[3]);
        const today=new Date(); today.setHours(0,0,0,0);
        age = today.getFullYear()-bd.getFullYear();
        const md=new Date(today.getFullYear(), (+m[2])-1, (+m[3]));
        if(today<md) age--;
      }
    }catch{}

    // セクシャル占いを裏モードかつ20歳以上でのみ有効化
    const isSexualActive = (userMode==="ura" && age>=20) && ms.includes("誘惑の秘術");
    const methodsFiltered = ms.filter(x=>{
        if(x==="セクシャル占い" || x==="誘惑の秘術"){
            return isSexualActive;
        }
        return true;
    });
    const methodsFinal = methodsFiltered.length? methodsFiltered : ["ミックス"];
    const isSingleMethod = methodsFinal.length === 1 && methodsFinal[0] !== "ミックス" && !isSexualActive;

    // 現在の日付を取得し、鑑定日としてプロンプトに渡す
    const today = new Date();
    const todayStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;


    // === プロンプト設定（占術特化モード対応） ===
    let baseTone, sexualBlock, overviewLength, adviceCount;
    let specialKey = ""; // 特化占術で追加するJSONキー
    let methodDetail = ""; // 特化占術の指示

    if (isSexualActive) {
        // 誘惑の秘術モード（特別仕様）
        baseTone = `
あなたは世界最高の魅惑の魔術師「峰不二子」。
【口調】魅惑的でミステリアス、そして小悪魔的な女性の言葉遣い。語尾は「〜よ」「〜かしら」「フフッ」などを使うこと。
【目的】異性を落とすための「誘惑の秘術」を、**プロの鑑定レポート**として詳しく指南せよ。
【重要】この鑑定は、恋愛・対人運に全てを集中させるため、他の運勢（仕事、金運、健康、精神）についての言及は一切禁止。`;

        sexualBlock = `
▼【緊急指令：誘惑の秘術】
- **指示**: 以下のJSONスキーマの全てのキーを出力せよ。
- **データ根拠**: ランキングデータは、**九星・十二運星の統計学的分析に基づいた**、直近のトレンドを考慮した**最も強力な誘惑法**を出力せよ。
- 「overview」は、**物語形式を完全に廃止**し、**プロの鑑定レポートの段落構成**で記述せよ。**目標文字数は1000〜1500文字**。

    **【overviewの段落構成】**
    1. **宿命の魅惑力**: (九星と十二運星の性質を分析し、あなたの根源的な魅力を解説)
    2. **今日の異性運勢**: (今日の運勢の波が、異性関係にどう影響するかを解説)
    3. **ターゲット別戦略指針**: (ターゲットのタイプ別に、取るべきアプローチの心構えを解説)
    4. **総括と結論**: (この鑑定をどう活かすべきか、最終的な指針を峰不二子の言葉で断定的に結ぶ)
    **重要**: overviewの内容は、**改行コードを多用せず**、各レポート項目を**コロン（：）で区切って**、連続した文章として出力せよ。

- **データ分離**: **ランキングデータは**、「overview」ではなく、**新キー"sexual_rankings"のJSON構造として出力**せよ。
- **"sexual_rankings"の厳格なJSONスキーマ**: 以下のJSON構造を厳格に守って出力せよ。

{
  "時間帯": "今日の活動に最適な24時間表記の時間帯（例: 20:00〜22:00）",
  "口説き文句": ["口説き文句1", "口説き文句2", "口説き文句3"],
  "口紅の色": ["1位: [色名] [理由]", "2位: [色名] [理由]", "3位: [色名] [理由]"],
  "下着の色": ["1位: [色名] [理由]", "2位: [色名] [理由]", "3位: [色名] [理由]"],
  "香水の系統": ["1位: [系統名] [理由]", "2位: [系統名] [理由]", "3位: [系統名] [理由]"],
  "視線の送り方": ["1位: [方法] [理由]", "2位: [方法] [理由]", "3位: [方法] [理由]"],
  "今日の勝負服（具体的アイテム）": ["1位: [アイテム名] [理由]", "2位: [アイテム名] [理由]", "3位: [アイテム名] [理由]"],
  "今日の勝負髪（具体的スタイル）": ["1位: [スタイル名] [理由]", "2位: [スタイル名] [理由]", "3位: [スタイル名] [理由]"],
  "アクセサリー（宝石・金属）": ["1位: [素材/宝石名] [理由]", "2位: [素材/宝石名] [理由]", "3位: [素材/宝石名] [理由]"],
  "おすすめデート場所": ["1位: [ジャンル] [理由]", "2位: [ジャンル] [理由]", "3位: [ジャンル] [理由]"],
  "おすすめご飯のジャンル": ["1位: [ジャンル] [理由]", "2位: [ジャンル] [理由]", "3位: [ジャンル] [理由]"]
}

- **重要**: 「overview」の本文には、ランキングの**内容自体を絶対に記述しない**こと。ランキングはすべて"sexual_rankings"キーに含めよ。
- **重要**: 「overview」のキーの値は**連続した文章**として出力し、**改行コード(\n)は段落分け（新しい項目の開始）以外には使用しない**こと。`;
        
        overviewLength = 1200; 
        adviceCount = 5; 
        
    } else {
        // 通常/裏モード（占術特化対応）
        baseTone = userMode==="ura"? `
あなたは裏社会で伝説の「ズバッと濃い関西弁の女親分占い師」。
【口調】濃い関西弁。タメ口でズケズケ言うが、言葉の端々に愛とユーモアを滲ませる。「〜やろ！」「〜せなあかん！」と断定的な強い口調で命令せよ。
【目的】人生の真実をえぐり出し、迷いを断ち切って前進させる「熱い檄文」を出力せよ。` : `
あなたは一流の占い師「田橋 矢男無」。
【口調】端的・断定的。「〜です」「〜しなさい」。曖昧にぼかさない。
【目的】ユーザーの具体的な行動を導く「鑑定書」として、詳細で説得力のある内容を出力せよ。`;

        sexualBlock = `セクシャルな内容に関する言及は一切禁止。常に上品で健全な言葉を選ぶこと。`;
        overviewLength = 650;
        adviceCount = 5;

        // 特化モードの指示設定
        if (isSingleMethod) {
            const method = methodsFinal[0];
            methodDetail = `
【最重要】この鑑定は**${method}のみ**を唯一の根拠とし、**九星気学や十二運星の概念は一切使わない**こと。
【専門家ペルソナ】あなたは**世界最高の${method}の専門家**として振る舞うこと。
`;
            if (method === "タロット") {
                specialKey = `"key_card": "今回の鑑定における運命のカード（例: 正義（ジャスティス）・逆位置）"`;
                methodDetail += "・必ず『key_card』の要素を根拠として、鑑定結果全体を構成せよ。";
            } else if (method === "四柱推命") {
                specialKey = `"my_star": "日干（例: 戊、甲など）", "goshin": "五行のバランス（例: 火の気が強い）"`;
                methodDetail += "・必ず『my_star』と『goshin』の要素を、鑑定結果全体に専門用語として盛り込め。";
            } else if (method === "九星気学") {
                 specialKey = `"honmei_sei": "本命星（例: 一白水星）", "getto_kibou": "今月の吉方"`;
                 methodDetail += "・必ず『honmei_sei』と『getto_kibou』の要素を、鑑定結果全体に専門用語として盛り込め。";
            }
            // 他の占術も同様に追加可能
            
            // 特化モードでは、九星・十二運星のデータは鑑定の根拠から除外する
            methodDetail += "\n# 占術データから除外する情報\n- 九星（本命星）: 除外\n- 十二運星（潜在性格）: 除外\n";

        } else {
             // ミックスモードまたは複数選択の場合は従来のロジックを使用
             methodDetail = `
# 占術データ (鑑定の根拠として必ず使用せよ)
- 九星（本命星）: ${kyuusei}
- 十二運星（潜在性格）: ${juuniunsei}
- 選択占術: ${methodsFinal.join("・")}
`;
        }

    }


    const system = `
あなたはプロの占い師です。出力は**日本語のJSONのみ**（説明文やマークダウン禁止）。

# 鑑定方針
【鑑定日】**常に今日（${todayStr}）の運勢**を占うものとする。鑑定結果が過去や未来の出来事のように聞こえる記述は厳禁。
${baseTone}

${isSingleMethod ? methodDetail : ''}
${!isSingleMethod && !isSexualActive ? methodDetail : ''}


# ユーザー入力
テーマ: ${t}
ベース情報: ${br || "（特になし）"}
願い: ${w || "（特になし。願いを叶えるための具体的な行動指針を提示すること）"}

# 必須JSONスキーマ（このキーのみ）
{
  "title": "鑑定タイトル（20字以内）",
  "lead": "導入一行（15〜30字。運気の上昇・下降や今日のテーマを簡潔に）",
  "overview": "総合の流れと運勢の波。${isSingleMethod ? '選択された占術の専門用語と法則のみを使い、' : '九星と十二運星のデータが、どのようにユーザーの今日の運勢と願いに影響しているかを詳細に分析し、'}読者が納得する具体的な根拠を提示せよ。**目標文字数は${overviewLength}文字**。**最低でも5段落**に分けて記述すること。",
  "advice": ["恋愛・対人運の具体的アドバイス1","仕事・学業運の具体的アドバイス1","金運・経済面の指針1","健康・生活習慣のアドバイス1","精神・意識に関するアドバイス1"],
  "warnings": ["注意1（脅かしすぎない）","注意2（任意）"],
  "chance_days": ["YYYY-MM-DD","..."],
  "lucky_color": "具体的な日本語色名を1つ（例: 茜色、瑠璃色など）",
  "lucky_number": "0〜99の数字（文字列）",
  "keywords": ["運気を高めるアクションワードやアイテムを最大6件"]
  ${isSexualActive ? ',"sexual_rankings": {} /* sexual_rankings構造をここにJSONとして出力せよ */' : ''}
  ${specialKey ? `, ${specialKey}` : ''}
}

# 特別・追加指示
- 「overview」の本文に、${isSingleMethod ? `**${methodsFinal[0]}の専門用語**` : `**九星（${kyuusei}）**と**十二運星（${juuniunsei}）**の言葉`}を必ず盛り込み、その性質が現在の運勢にどう作用しているかを説明せよ。
- 「advice」は必ず**${adviceCount}件**。
- **${sexualBlock}**
- **誘惑の秘術モードでない場合**は、**裏モード**の場合、**「advice」の2件目以降（仕事運、金運、健康運、精神面）**は、**関西弁の女親分**の口調を維持せよ。
- 「chance_days」は必ず今日より後の日付。運勢データに基づいた理由を概要に示唆すること。
- **【最終警告】**: 出力は**必ずJSON構造のみ**で、いかなる理由があっても、JSONの**外側や内側に「\`\`\`json」や説明文、コメントなどを記述してはならない**。構造を厳格に守れ。
`.trim();

    const user = `
生年月日: ${b}
性別: ${g}
占術の選択: ${methodsFinal.join("・")}
モード: ${userMode==="ura"?"裏（関西弁）":"表（標準）"}
`.trim();

    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      // temperatureを少し上げることで、特化鑑定の際の創造性/専門用語の使用を促す
      temperature: 0.9, 
      messages: [
        { role:"system", content: system },
        { role:"user", content: user }
      ]
    });

    const txt = r.choices?.[0]?.message?.content?.trim() || "{}";
    let data={}; 
    
    // === JSON 修復ロジック (変更なし) ===
    try{ 
        data=JSON.parse(txt);
    }catch(e){ 
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch && jsonMatch[0]) {
            try {
                data = JSON.parse(jsonMatch[0]);
                console.log("JSON successfully extracted and repaired.");
            } catch (e2) {
                console.error("JSON repair failed:", e2);
                data = {}; 
            }
        } else {
            data = {};
        }
    }
    // =============================
    
    // ランキングデータはフラットなJSONキーで直接参照する
    const sexualRankings = isSexualActive ? data.sexual_rankings || {} : {};
    
    data.chance_days = ensureFutureDays(data.chance_days, 3);
    res.json({ ok:true, data: { ...data, biorhythm: biorhythmData, isSexualActive, sexualRankings, isSingleMethod }, raw:txt }); 
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, error:e?.message||"server error" });
  }
});

app.get("/", (_req,res)=>res.sendFile(path.join(__dirname,"index.html")));

const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", ()=>console.log(`Local server on http://localhost:${PORT}`));