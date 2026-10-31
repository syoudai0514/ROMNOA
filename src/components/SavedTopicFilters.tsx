import { useState } from "react";
import { savedTopicGroups, type SavedTopic } from "../lib/saved-topics";
export function SavedTopicFilters({ topics, selected, onSelect, query, onQuery }: { topics: SavedTopic[]; selected: SavedTopic | null; onSelect: (id: string | null) => void; query: string; onQuery: (query: string) => void }) {
  const [group, setGroup] = useState<SavedTopic["group"]>("人物・グループ");
  const available = savedTopicGroups.filter((name) => topics.some((topic) => topic.group === name));
  const active = available.includes(group) ? group : available[0];
  return <section className="saved-topics" aria-label="保存記事の自動分類">
    <h3>保存記事の自動分類</h3>
    <p>タイトルをもとに分類します。1つの記事が複数の分類に入ることもあります。</p>
    <label className="saved-topic-search">名前・キーワードで絞り込み<input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="例：山田太郎、写真集" /></label>
    <button className="text-button" onClick={() => { onSelect(null); onQuery(""); }} disabled={!selected && !query}>絞り込みを解除</button>
    {!!available.length && <div className="saved-topic-kinds" role="group" aria-label="分類の種類">{available.map((name) => <button key={name} aria-pressed={active === name} onClick={() => setGroup(name)}>{name}</button>)}</div>}
    {available.filter((name) => name === active).map((group) => {
      const items = topics.filter((topic) => topic.group === group);
      if (!items.length) return null;
      return <div key={group} className="saved-topic-group" role="group" aria-label={group}>
        <h4>{group}</h4>
        <div className="saved-topic-chips">{items.slice(0, 8).map((topic) => <button key={topic.id} aria-pressed={selected?.id === topic.id} onClick={() => onSelect(selected?.id === topic.id ? null : topic.id)}>{topic.label}<span>{topic.articleIds.size}</span></button>)}</div>
        {items.length > 8 && <details><summary>ほかの分類を見る（{items.length - 8}）</summary><div className="saved-topic-chips">{items.slice(8).map((topic) => <button key={topic.id} aria-pressed={selected?.id === topic.id} onClick={() => onSelect(selected?.id === topic.id ? null : topic.id)}>{topic.label}<span>{topic.articleIds.size}</span></button>)}</div></details>}
      </div>;
    })}
    {!topics.length && <p>名前やキーワードを入力して絞り込めます。保存した記事が増えると、共通する言葉も分類に表示します。</p>}
    {selected && <p role="status">「{selected.label}」で絞り込み中</p>}
  </section>;
}
