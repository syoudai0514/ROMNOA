import { describe, expect, it } from "vitest";
import {
  fetchSocialPost,
  handleSocial,
  parseInstagramEmbed,
  parseXPost,
  SocialService,
} from "../server/social";

const xUrl = "https://x.com/user/status/1234567890123";
const tweet = {
  __typename: "Tweet",
  id_str: "1234567890123",
  text: "撮影オフショット https://t.co/AbC123",
  created_at: "2026-10-29T03:00:00.000Z",
  user: { name: "公式", screen_name: "official" },
  mediaDetails: [
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/AAA.jpg" },
    {
      type: "video",
      media_url_https:
        "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/B.jpg",
      video_info: {
        variants: [
          {
            content_type: "application/x-mpegURL",
            url: "https://video.twimg.com/a.m3u8",
          },
          {
            content_type: "video/mp4",
            bitrate: 256000,
            url: "https://video.twimg.com/ext_tw_video/1/pu/vid/320x180/low.mp4?tag=12",
          },
          {
            content_type: "video/mp4",
            bitrate: 2176000,
            url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4?tag=12",
          },
        ],
      },
    },
    { type: "photo", media_url_https: "https://evil.example/x.jpg" },
  ],
};

describe("in-app SNS posts without login", () => {
  it("reads X photos and the best MP4 from the public embed data", () => {
    const post = parseXPost(JSON.stringify(tweet), xUrl);
    expect(post.text).toBe("撮影オフショット");
    expect(post.handle).toBe("official");
    expect(post.media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/AAA.jpg" },
      {
        type: "video",
        url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4?tag=12",
        poster: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/B.jpg",
      },
    ]);
    expect(() =>
      parseXPost(JSON.stringify({ ...tweet, id_str: "9" }), xUrl),
    ).toThrow("post_mismatch");
    expect(() =>
      parseXPost(JSON.stringify({ __typename: "TweetTombstone" }), xUrl),
    ).toThrow();
  });
  it("reads every Instagram carousel item, falling back to the rendered image", () => {
    const igUrl = "https://www.instagram.com/p/AbCdE12/";
    const context = JSON.stringify({
      gql_data: {
        shortcode_media: {
          edge_sidecar_to_children: {
            edges: [
              {
                node: {
                  display_url:
                    "https://scontent-nrt1-1.cdninstagram.com/v/1.jpg?stp=x&_nc_sig=a",
                },
              },
              {
                node: {
                  is_video: true,
                  display_url:
                    "https://scontent-nrt1-1.cdninstagram.com/v/2.jpg?a=1",
                  video_url:
                    "https://scontent-nrt1-1.cdninstagram.com/v/2.mp4?a=1",
                },
              },
              { node: { display_url: "https://ads.example/3.jpg" } },
            ],
          },
        },
      },
    });
    const html = `<span class="UsernameText">artist</span><div class="Caption"><a class="CaptionUsername">artist</a>新しい写真</div><script>s.handle({"contextJSON":${JSON.stringify(context)}})</script>`;
    const post = parseInstagramEmbed(html, igUrl);
    expect(post.media.map((m) => m.type)).toEqual(["photo", "video"]);
    expect(post.text).toBe("新しい写真");
    const plain = parseInstagramEmbed(
      `<img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/v/s.jpg" srcset="https://scontent.cdninstagram.com/v/s.jpg 320w, https://scontent.cdninstagram.com/v/l.jpg 1080w">`,
      igUrl,
    );
    expect(plain.media).toEqual([
      { type: "photo", url: "https://scontent.cdninstagram.com/v/l.jpg" },
    ]);
    expect(() => parseInstagramEmbed("<p>login</p>", igUrl)).toThrow();
  });
  it("only fetches fixed X and Instagram endpoints derived from a canonical post", async () => {
    const seen: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify(tweet), {
        headers: { "content-type": "application/json" },
      });
    };
    await fetchSocialPost(xUrl, fetcher);
    expect(new URL(seen[0]).origin).toBe("https://cdn.syndication.twimg.com");
    expect(new URL(seen[0]).searchParams.get("id")).toBe("1234567890123");
    await expect(
      fetchSocialPost("https://twitter.com/user/status/1234567890123", fetcher),
    ).rejects.toThrow("invalid_post");
  });
  it("rejects arbitrary URLs, supports an explicit disabled mode and caches results", async () => {
    let calls = 0;
    const memory = new Map<string, any>();
    const service = new SocialService(
      {
        get: async (k: string) => memory.get(k),
        set: async (k: string, e: any) => void memory.set(k, e),
      },
      async () => {
        calls++;
        return parseXPost(JSON.stringify(tweet), xUrl);
      },
    );
    for (const bad of [
      "http://127.0.0.1/",
      "https://evil.example/p/1/",
      `${xUrl}?x=1`,
    ])
      expect(
        (
          await handleSocial(
            new Request(`http://l/api/social?url=${encodeURIComponent(bad)}`),
            service,
          )
        ).status,
      ).toBe(400);
    const ok = new Request(
      `http://l/api/social?url=${encodeURIComponent(xUrl)}`,
    );
    expect((await handleSocial(ok, service, false)).status).toBe(403);
    expect((await handleSocial(ok, service)).status).toBe(200);
    await handleSocial(ok, service);
    expect(calls).toBe(1);
  });
});
