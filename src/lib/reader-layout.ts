// Presentation only: old v3 reader caches benefit without fetching bodies again.
// Retain every nonblank line, indentation, response number and URL.
export function compactReaderText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n(?:[ \t\u3000]*\n)+/g, "\n")
    .trim();
}
