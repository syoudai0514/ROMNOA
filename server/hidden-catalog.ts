import type { HiddenGroups } from "../src/lib/hidden-model.js";

// Counts are verified title-only, all-word first-page matches after shared exclusions, not totals.
export const hiddenCatalog: HiddenGroups = [
  {
    title: "脚のライン・細身のスタイル",
    words: [
      {
        label: "美脚",
        query: "美脚",
        verifiedCount: 7,
        verifiedAt: "2026-10-28T07:28:40.955Z",
      },
      {
        label: "スレンダー",
        query: "スレンダー",
        verifiedCount: 3,
        verifiedAt: "2026-10-28T07:28:44.574Z",
      },
    ],
  },
  {
    title: "ソックスと大人のコーデ",
    words: [
      {
        label: "ルーズソックス",
        query: "ルーズソックス",
        verifiedCount: 4,
        verifiedAt: "2026-10-28T07:28:42.776Z",
      },
    ],
  },
];
