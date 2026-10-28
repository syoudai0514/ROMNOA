import { describe, it, expect } from "vitest";
import {
  readerVideoUrl,
  readerVideos,
  instagramImageUrl,
  socialPostUrl,
  readerSocialPosts,
} from "../src/lib/reader-media";
import { readerImageUrl, readerDocumentSchema } from "../src/lib/reader-model";
import { extractArticle } from "../server/reader";
import { article, readerFixture } from "./fixtures";

const mp4 =
  "https://video.twimg.com/amplify_video/2032037106206588929/vid/avc1/720x1002/CZFfVK_dQmbjSAyr.mp4";
describe("native media and social post handling", () => {
  it("recognizes the reported X MP4, old video paths, and animated tweet/Imgur files", () => {
    expect(readerVideoUrl(mp4, "alfalfa")).toBe(mp4);
    expect(
      readerVideoUrl(
        "https://video.twimg.com/ext_tw_video/123456789/pu/vid/640x360/Example.mp4?tag=12",
        "hamusoku",
      ),
    ).not.toBeNull();
    expect(
      readerVideoUrl(
        "https://video.twimg.com/tweet_video/Example.mp4",
        "alfalfa",
      ),
    ).not.toBeNull();
    expect(readerVideoUrl("https://imgur.com/Example.gifv", "alfalfa")).toBe(
      "https://i.imgur.com/Example.mp4",
    );
  });
  it.each([
    "http://video.twimg.com/tweet_video/Example.mp4",
    "https://video.twimg.com.evil.test/tweet_video/Example.mp4",
    "https://video.twimg.com/tweet_video/Example.m3u8",
    "https://video.twimg.com/tweet_video/Example.mp4?url=https://evil.test",
    "https://video.twimg.com/tweet_video/Example.mp4?tag=1&tag=2",
    "https://user@video.twimg.com/tweet_video/Example.mp4",
    "https://imgur.com/gallery/Example.mp4",
  ])("refuses unsupported video target %s", (url) =>
    expect(readerVideoUrl(url, "alfalfa")).toBeNull(),
  );
  it("finds videos in existing cached links and deduplicates animated representations", () => {
    const d = {
      ...readerFixture(article()),
      links: [
        { url: mp4, title: mp4 },
        { url: "https://i.imgur.com/Example.mp4", title: "動画" },
        { url: "https://imgur.com/Example.gifv", title: "GIF" },
      ],
    };
    expect(readerVideos(d)).toEqual([
      { url: mp4, animated: false },
      { url: "https://i.imgur.com/Example.mp4", animated: true },
    ]);
    expect(readerDocumentSchema.safeParse(d).success).toBe(true);
  });
  it("extracts native video/source tags and plain video URLs without including ads or executing embeds", () => {
    const d = extractArticle(
      `<div class="article-body-inner"><video autoplay><source src="${mp4}" type="video/mp4"></video><p>https://video.twimg.com/tweet_video/Example.mp4</p><div class="advertisement"><video src="https://i.imgur.com/Advert1.mp4"></video></div></div>`,
      article(),
    );
    expect(readerVideos(d)).toEqual([
      { url: mp4, animated: false },
      {
        url: "https://video.twimg.com/tweet_video/Example.mp4",
        animated: true,
      },
    ]);
    expect(d.links.some((link) => link.url.includes("Advert1"))).toBe(false);
    const onlyVideo = extractArticle(
      `<div class="article-body-inner"><video src="${mp4}"></video></div>`,
      article(),
    );
    expect(readerVideos(onlyVideo)).toHaveLength(1);
  });
  it("accepts GIFs and published Instagram CDN images while preserving public media signatures", () => {
    expect(
      readerImageUrl("https://i.imgur.com/Example.gif", "alfalfa"),
    ).not.toBeNull();
    expect(
      readerImageUrl("https://pbs.twimg.com/media/Example.gif", "alfalfa"),
    ).not.toBeNull();
    const image =
      "https://scontent-nrt1-1.cdninstagram.com/v/t51.2885-15/123456_n.jpg?stp=dst-jpg&oh=public_signature&oe=1234";
    expect(instagramImageUrl(image)).toBe(image);
    expect(readerImageUrl(image, "alfalfa")).toBe(image);
    const extracted = extractArticle(
      `<div class="article-body-inner"><a href="https://www.instagram.com/p/AbCdEfg/"><img src="${image}" alt="写真"></a><a href="https://x.com/example/status/123456789"><img src="https://pbs.twimg.com/media/Example.gif"></a></div>`,
      article(),
    );
    expect(extracted.blocks.filter((b) => b.type === "image")).toHaveLength(2);

    for (const url of [
      "https://cdninstagram.com.evil.test/photo.jpg",
      "https://scontent.example.cdninstagram.com/photo.svg",
      "https://scontent.example.cdninstagram.com/v/t51.2885-19/avatar.jpg",
      "https://scontent.example.cdninstagram.com/photo.jpg?redirect=evil",
    ])
      expect(instagramImageUrl(url)).toBeNull();
  });
  it("recognizes public post links and represents post-only embeds without loading their scripts", () => {
    expect(
      socialPostUrl(
        "https://twitter.com/example/status/123456789?ref=tracking",
      ),
    ).toEqual({ provider: "X", url: "https://x.com/example/status/123456789" });
    expect(
      socialPostUrl("https://www.instagram.com/p/AbCdEfg/?igsh=tracking"),
    ).toEqual({
      provider: "Instagram",
      url: "https://www.instagram.com/p/AbCdEfg/",
    });
    expect(
      socialPostUrl("https://www.instagram.com/accounts/login/"),
    ).toBeNull();
    const d = extractArticle(
      '<div class="article-body-inner"><blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/AbCdEfg/"></blockquote><script src="https://www.instagram.com/embed.js"></script></div>',
      article(),
    );
    expect(readerSocialPosts(d)).toHaveLength(1);
    expect(JSON.stringify(d)).not.toContain("embed.js");
  });
});
