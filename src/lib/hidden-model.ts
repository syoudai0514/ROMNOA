import { z } from "zod";
export const hiddenGroupsSchema = z
  .array(
    z.object({
      title: z.string().max(60),
      words: z
        .array(
          z.object({
            label: z.string().max(60),
            query: z.string().min(1).max(80),
            verifiedCount: z.number().int().min(2),
            verifiedAt: z.iso.datetime(),
          }),
        )
        .max(12),
    }),
  )
  .max(8);
export type HiddenGroups = z.infer<typeof hiddenGroupsSchema>;
// Conservative title exclusions for the adult fashion/photo hints. This is not
// an age or image classifier, and it never claims to verify a depicted person.
export function hiddenTitleAllowed(title: string) {
  return !/未成年|小学生|中学生|高校生|女子高生|女子中|女子小|児童|幼女|少女|JK|JC|JS|(?:^|[^0-9])(?:[0-9]|1[0-7])\s*歳|盗撮|流出|無修正|ハメ撮り|セックス|性交|レイプ/i.test(
    title,
  );
}
