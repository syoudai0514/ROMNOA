import { describe, expect, it } from "vitest";
import {
  getYahooComments,
  handleYahooComments,
  parseYahooComments,
} from "../server/yahoo-comments";
const id = "a".repeat(40);
const article = `https://news.yahoo.co.jp/articles/${id}`;
const user = (n: number, extra: Record<string, unknown> = {}) => ({
  commentId: `c${n}`,
  commentArticleId: id,
  name: `us******${n}`,
  text: `コメント${n}\r\n\n\n\n二行目`,
  postDate: "1時間前",
  empathyCount: 10 * n,
  insightCount: n,
  negativeCount: 1,
  isVisible: true,
  isBlocked: false,
  userHiddenStatus: "idle",
  reply: { totalResults: n },
  ...extra,
});
const html = (state: unknown) =>
  `<html><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script><div class="ad">広告</div></html>`;
const state = (overrides: Record<string, unknown> = {}) => ({
  commentArticle: {
    commentArticleId: id,
    newsLink: article,
    parentAndReplyCommentTotalCount: 40,
  },
  commentFull: {
    commentGetStatus: "success",
    parentOnlyCommentTotalCount: 23,
    commentatorComment: [
      {
        commentId: "e1",
        commentArticleId: id,
        name: "専門家A",
        text: "解説です",
        postDate: "2時間前",
        thumbsUpCount: 50,
        commentator: { title: "大学教授" },
      },
    ],
    userCommentList: [
      user(1),
      user(2, { isVisible: false }),
      user(3, { isBlocked: true }),
      user(4, { commentArticleId: "b".repeat(40) }),
      user(5),
    ],
    ...overrides,
  },
  accessRanking: { list: [{ headline: "ランキング" }] },
});
describe("Yahoo comments", () => {
  it("reads only this article's visible comments, with experts first on page 1", () => {
    const r = parseYahooComments(html(state()), article, 1, "recommended");
    expect(r).toMatchObject({ total: 23, totalWithReplies: 40, pages: 3, page: 1 });
    expect(r.comments.map((c) => c.id)).toEqual(["e1", "c1", "c5"]);
    expect(r.comments[0]).toMatchObject({ kind: "expert", title: "大学教授", empathy: 50 });
    expect(r.comments[1]).toMatchObject({
      text: "コメント1\n\n二行目",
      empathy: 10,
      insight: 1,
      negative: 1,
      replies: 1,
    });
    expect(
      parseYahooComments(html(state()), article, 2, "newer").comments.map((c) => c.id),
    ).toEqual(["c1", "c5"]);
  });
  it("rejects another article's page or a failed comment state", () => {
    const other = `https://news.yahoo.co.jp/articles/${"b".repeat(40)}`;
    expect(() => parseYahooComments(html(state()), other, 1, "newer")).toThrow(
      "article_mismatch",
    );
    expect(() =>
      parseYahooComments(html(state({ commentGetStatus: "error" })), article, 1, "newer"),
    ).toThrow("comments_unavailable");
    expect(() => parseYahooComments("<html></html>", article, 1, "newer")).toThrow();
  });
  it("validates parameters and caches briefly", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return parseYahooComments(html(state()), article, 1, "recommended");
    };
    let now = 0;
    await getYahooComments(article, 1, "recommended", load, () => now);
    await getYahooComments(article, 1, "recommended", load, () => now);
    expect(calls).toBe(1);
    now = 200_000;
    await getYahooComments(article, 1, "recommended", load, () => now);
    expect(calls).toBe(2);
    const req = (q: string) =>
      new Request(`http://localhost/api/yahoo-comments?${q}`);
    const ok = await handleYahooComments(
      req(`article=${encodeURIComponent(article)}&page=1&order=newer`),
      async (a, p, o) => ({ ...(await load()), article: a, page: p, order: o }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ order: "newer" });
    for (const q of [
      "article=https://example.com/",
      `article=${encodeURIComponent(article)}&page=0`,
      `article=${encodeURIComponent(article)}&page=51`,
      `article=${encodeURIComponent(article)}&order=old`,
      `article=${encodeURIComponent(article)}&x=1`,
    ])
      expect((await handleYahooComments(req(q), load)).status).toBe(400);
    const failed = await handleYahooComments(
      req(`article=${encodeURIComponent(article)}`),
      async () => {
        throw Error("x");
      },
    );
    expect(failed.status).toBe(502);
  });
});
