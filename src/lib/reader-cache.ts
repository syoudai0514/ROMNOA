import { readerDocumentSchema, type ReaderDocument } from "./reader-model";

const MAX_AGE = 86_400_000;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("romnoa-reader", 1);
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    const timer = setTimeout(
      () => fail(new Error("reader_storage_timeout")),
      4000,
    );
    request.onupgradeneeded = () => {
      request.result.createObjectStore("articles", { keyPath: "articleId" });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) request.result.close();
      else {
        settled = true;
        resolve(request.result);
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("reader_storage_blocked"));
  });
}
export async function cachedReader(id: string): Promise<ReaderDocument | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    const value = await new Promise<unknown>((resolve, reject) => {
      const r = db!.transaction("articles").objectStore("articles").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const parsed = readerDocumentSchema.safeParse(value);
    if (
      !parsed.success ||
      Date.now() - Date.parse(parsed.data.fetchedAt) > MAX_AGE ||
      Date.now() - Date.parse(parsed.data.fetchedAt) < -60_000 ||
      parsed.data.articleId !== id
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
export async function cacheReader(document: ReaderDocument): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction("articles", "readwrite");
      const store = tx.objectStore("articles");
      store.put(document);
      const r = store.getAll();
      r.onsuccess = () => {
        const rows = (r.result as ReaderDocument[]).sort(
          (a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt),
        );
        rows.forEach((row, index) => {
          if (index >= 100 || Date.now() - Date.parse(row.fetchedAt) > MAX_AGE)
            store.delete(row.articleId);
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
