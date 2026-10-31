import { describe, expect, it } from "vitest";
import { buildSavedTopics, matchesSavedTitle } from "../src/lib/saved-topics";
describe("saved title classification shared by news and roundup", () => {
  it("allows the same article to belong to a person and several topics", () => {
    const topics = buildSavedTopics([{ id: "one", title: "【画像】岡田紗佳さん、美脚の写真集を公開" }, { id: "two", title: "岡田紗佳、美脚が話題に" }]);
    expect(topics.find((t) => t.label === "岡田紗佳")?.group).toBe("人物・グループ");
    expect([...topics.find((t) => t.label === "岡田紗佳")!.articleIds]).toEqual(["one", "two"]);
    expect([...topics.find((t) => t.label === "写真集")!.articleIds]).toEqual(["one"]);
    expect(topics.find((t) => t.label === "公開")).toBeUndefined();
    expect(topics.find((t) => t.label === "写真・画像")?.group).toBe("記事の種類");
  });
  it("discovers recurring words without a fixed entity dictionary and updates with removals", () => {
    const items = [{ id: "a", title: "量子通信の新しい実験" }, { id: "b", title: "量子通信が実用化へ" }];
    expect(buildSavedTopics(items).some((t) => t.label === "量子通信")).toBe(true);
    expect(buildSavedTopics(items.slice(0, 1)).some((t) => t.label === "量子通信")).toBe(false);
    expect(buildSavedTopics([])).toEqual([]);
  });
  it("recognizes groups, members and quoted works with release context", () => {
    const topics = buildSavedTopics([{ id: "a", title: "乃木坂46川﨑桜、写真集を公開" }, { id: "b", title: "『青い世界』を発売" }]);
    expect(topics.find((t) => t.label === "乃木坂46")?.group).toBe("人物・グループ");
    expect(topics.find((t) => t.label === "川﨑桜")?.group).toBe("人物・グループ");
    expect(topics.find((t) => t.label === "青い世界")?.group).toBe("作品・イベント");
  });
  it("matches custom names and AND keywords with normalized case and width", () => {
    expect(matchesSavedTitle("ＡＩの写真集", "ai 写真集")).toBe(true);
    expect(matchesSavedTitle("岡田紗佳の写真集", "岡田 別人")).toBe(false);
  });
});
