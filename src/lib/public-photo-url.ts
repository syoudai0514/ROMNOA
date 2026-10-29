// Syntax validation shared with the client. DNS/socket validation lives on the server.
export function publicPhotoUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.href.length > 2048 ||
      !u.hostname.includes(".") ||
      !/^[a-z0-9.-]+$/i.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$|\.$|^[\d.]+$/i.test(
        u.hostname,
      )
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
