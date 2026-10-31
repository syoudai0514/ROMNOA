export type SavedTitle = { id: string; title: string };
export type SavedTopic = { id: string; label: string; group: "人物・グループ" | "作品・イベント" | "キーワード" | "記事の種類"; articleIds: Set<string> };
export const savedTopicGroups = ["人物・グループ", "作品・イベント", "キーワード", "記事の種類"] as const;
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const stop = new Set("の は が を に で と も な へ や から まで より について という する した して され された いる ある なる です ます さん 氏 選手 写真 画像 動画 速報 悲報 朗報 話題 公開 披露 登場 最新 注目 人気 美人 反響 理由 判明 本当 これ それ どこ いつ こと もの ため 今回 新しい ニュース テスト まとめ 記事 配信社 Yahoo web Pickup".split(" ").map(normalize));
const themes = ["美脚", "写真集", "グラビア", "ファッション", "美容", "スキンケア", "メイク", "ダイエット", "筋トレ", "料理", "旅行", "結婚", "育児", "仕事", "政治", "選挙", "経済", "投資", "年金", "医療", "ゲーム", "アニメ", "映画", "音楽", "ライブ", "コスプレ", "水着", "スポーツ", "野球", "サッカー", "麻雀", "AI", "iPhone", "Instagram", "YouTube"];
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "word" }) : null;
export function buildSavedTopics(articles: readonly SavedTitle[]): SavedTopic[] {
  const topics = new Map<string, SavedTopic>();
  const add = (article: SavedTitle, raw: string, group: SavedTopic["group"]) => {
    const label = raw.trim().replace(/\s+/g, " ");
    if (label.length < 2 || label.length > 30 || stop.has(normalize(label)) || /^\d+$/.test(label)) return;
    const id = `${group}:${normalize(label)}`;
    const topic = topics.get(id) || { id, label, group, articleIds: new Set<string>() };
    topic.articleIds.add(article.id); topics.set(id, topic);
  };
  for (const article of articles) {
    const title = article.title.normalize("NFKC").replace(/【(?:画像|写真|動画|悲報|朗報|速報|Pickup\d*)】/gi, " ").trim();
    const lower = normalize(title);
    for (const [label, pattern] of [["写真・画像", /写真|画像|フォト/], ["動画・映像", /動画|映像/], ["インタビュー", /インタビュー/], ["解説", /解説/], ["レビュー", /レビュー|使ってみた/]] as const)
      if (pattern.test(article.title)) add(article, label, "記事の種類");
    for (const word of themes) if (lower.includes(normalize(word))) add(article, word, "キーワード");
    for (const match of title.matchAll(/(?:乃木坂|櫻坂|日向坂)46|[A-Z]{2,8}\d{2,3}|Snow Man|SixTONES/gi)) add(article, match[0], "人物・グループ");
    const member = title.match(/(?:乃木坂|櫻坂|日向坂)46(?:の)?([\p{Script=Han}]{2,6})(?=[、,「『(]|さん|が|の)/u)?.[1];
    if (member) add(article, member, "人物・グループ");
    const roleName = title.match(/(?:モデル|タレント|女優|俳優|声優|プロ雀士|アナウンサー|コスプレイヤー)(?:の|・)?([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,8})(?=[、,「『(]|さん|氏|が|の)/u)?.[1];
    if (roleName) add(article, roleName, "人物・グループ");
    const name = title.match(/^([\p{Script=Han}]{2,6})(?=[、,「『(]|さん|氏|選手)/u)?.[1];
    if (name && !/写真|画像|公開|速報|判明|女子|女性|男子|男性|美脚|衝撃|人気/.test(name)) add(article, name, "人物・グループ");
    for (const match of title.matchAll(/([\p{Script=Han}]{2,6})(?:さん|氏|選手|容疑者|被告|監督|社長)/gu)) add(article, match[1], "人物・グループ");
    for (const match of title.matchAll(/[「『]([^「」『』]{2,24})[」』](?=.{0,5}(?:出演|主演|発売|放送|公演|開催|連載|上映|配信|出版))/gu)) add(article, match[1], "作品・イベント");
    for (const match of title.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[ \-][A-Za-z0-9]+){0,3}(?:Award|Festival)|[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{2,18}(?:選手権|大会|フェス|展覧会)/gu)) add(article, match[0], "作品・イベント");
    let run = "";
    const flush = () => { if (run.length <= 18) add(article, run, "キーワード"); run = ""; };
    const parts = segmenter ? [...segmenter.segment(title)].map((p) => p.segment) : title.split(/[^\p{Script=Han}\p{Script=Katakana}A-Za-z0-9ー]+/u);
    for (const token of parts) {
      if (/^[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9ー]+$/u.test(token) && !stop.has(normalize(token))) {
        run += token;
      } else flush();
    }
    flush();
  }
  const all = [...topics.values()];
  return all.filter((topic) => {
    if (topic.group !== "キーワード") return true;
    if (all.some((other) => other.group !== "キーワード" && normalize(other.label) === normalize(topic.label))) return false;
    return themes.some((word) => normalize(word) === normalize(topic.label)) || topic.articleIds.size >= 2;
  }).sort((a, b) => b.articleIds.size - a.articleIds.size || a.label.localeCompare(b.label, "ja"));
}
export function matchesSavedTitle(title: string, query: string) {
  const text = normalize(title);
  return normalize(query).split(/\s+/).every((word) => text.includes(word));
}
