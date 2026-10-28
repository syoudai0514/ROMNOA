import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { hiddenCatalog } from "./hidden-catalog.js";

const DIGEST =
  "0829947c58da25ec2df5dc396f96ea2cd03b4a9d85ba173dffe15a6f0fa064d8";
export function verifyHiddenPin(pin: string) {
  return (
    /^\d{6}$/.test(pin) &&
    timingSafeEqual(
      scryptSync(pin, "romnoa-hidden-v1", 32),
      Buffer.from(DIGEST, "hex"),
    )
  );
}
export class PinAttempts {
  private values = new Map<string, { failures: number; until: number }>();
  constructor(private now = Date.now) {}
  blocked(key: string) {
    const row = this.values.get(key);
    return !!row && row.failures >= 5 && row.until > this.now();
  }
  result(key: string, good: boolean) {
    if (good) {
      this.values.delete(key);
      return;
    }
    const old = this.values.get(key),
      failures = old && old.until > this.now() ? old.failures + 1 : 1;
    this.values.delete(key);
    this.values.set(key, { failures, until: this.now() + 60000 });
    if (this.values.size > 1000)
      this.values.delete(this.values.keys().next().value!);
  }
}
const attempts = new PinAttempts();
export async function handleHiddenSearch(
  request: Request,
  verify = verifyHiddenPin,
  limiter = attempts,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!preview)
    return Response.json(
      { error: "個人用プレビュー専用です。" },
      { status: 403, headers },
    );
  if (request.method !== "POST")
    return Response.json(
      { error: "POSTのみ利用できます。" },
      { status: 405, headers: { ...headers, Allow: "POST" } },
    );
  if (
    new URL(request.url).search ||
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") || "",
    ) ||
    Number(request.headers.get("content-length")) > 512 ||
    !request.body
  )
    return Response.json(
      { error: "入力を確認してください。" },
      { status: 400, headers },
    );
  const key = createHash("sha256")
    .update(request.headers.get("x-forwarded-for") || "local")
    .digest("hex");
  if (limiter.blocked(key))
    return Response.json(
      { error: "少し時間をおいてお試しください。" },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  let pin: unknown;
  try {
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 512) throw new Error("too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      typeof body.pin !== "string" ||
      !/^\d{6}$/.test(body.pin)
    )
      throw new Error("invalid_pin");
    pin = body.pin;
  } catch {
    return Response.json(
      { error: "6桁のパスワードを入力してください。" },
      { status: 400, headers },
    );
  }
  const good = verify(pin as string);
  limiter.result(key, good);
  return good
    ? Response.json({ groups: hiddenCatalog }, { headers })
    : Response.json(
        { error: "パスワードが違います。" },
        { status: 401, headers },
      );
}
