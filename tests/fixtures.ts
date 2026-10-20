import type { Article, FeedResponse } from "../src/lib/model";
export function article(n = 0, overrides: Partial<Article> = {}): Article {
  const url = `https://hamusoku.com/archives/test-${n}.html`;
  return {
    id: url,
    url,
    sourceId: "hamusoku",
    title: `[テスト用] 毎日を快適にする暮らしの工夫 ${n}`,
    publishedAt: new Date(
      Date.UTC(2026, 9, 20, 3, 0) - n * 600_000,
    ).toISOString(),
    category: "暮らし",
    ...overrides,
  };
}
export const feed: FeedResponse = {
  articles: [
    article(0, {
      title: "[テスト用] 新しいゲームの発売日が決まりました",
      category: "ゲーム",
    }),
    article(1, {
      title: "[テスト用] 休日の料理が楽しくなる小さな工夫",
      category: "暮らし",
    }),
    article(2, {
      id: "https://alfalfalfa.com/articles/test.html",
      url: "https://alfalfalfa.com/articles/test.html",
      sourceId: "alfalfa",
      title: "[テスト用] スマートフォンの新機能を試してみた",
      category: "テクノロジー",
    }),
    ...Array.from({ length: 22 }, (_, i) =>
      article(i + 3, {
        title: `[テスト用] ${["図書館で借りた本を返すタイミング", "小さな庭の花が咲くまでの日記", "雨の日の運動を続ける方法", "新しい街を散歩して見つけたお店", "休日の朝にパンを焼いてみました", "電車の混雑を避けて通勤するには", "海辺のキャンプ場で過ごす夏休み", "友人と美術館へ行った感想", "宇宙の星を観察する夜の楽しみ", "古いカメラを修理して写真を撮る", "引っ越しの荷物を減らす収納術", "寒い季節の自転車通学の準備", "駅前の広場で音楽会がありました", "料理教室で覚えたスパイスの使い方", "犬の散歩で知り合ったご近所さん", "旅行先で忘れ物をしないために", "登山靴の手入れと長持ちのコツ", "子供と遊べる室内の施設を探す", "節約しながら健康を保つ食生活", "映画のパンフレットを集めています", "植物の水やりはいつがいいのか", "自然公園の散策で出会った鳥たち"][i]}`,
      }),
    ),
  ],
  sources: [
    { id: "hamusoku", status: "ok", fetchedAt: "2026-10-20T03:00:00.000Z" },
    { id: "alfalfa", status: "ok", fetchedAt: "2026-10-20T03:00:00.000Z" },
  ],
  generatedAt: "2026-10-20T03:00:00.000Z",
};
