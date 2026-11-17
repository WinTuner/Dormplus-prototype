// Storage adapter — one JSON file per key plus the slip photos. Everything that touches storage goes
// through this file, so tests swap it for an in-memory map and the backend can change underneath.
//
// Two backends: Cloudflare R2 when R2_BUCKET is set (S3 API, 10M read ops/month free), Vercel Blob
// otherwise. Keeping Blob as the fallback is what makes the migration one env var at a time.
const blobStore = require("@vercel/blob");
// Built lazily by createStore() so importing this module never needs R2 credentials.
const r2Store = process.env.R2_BUCKET ? require("./_store-r2").createStore() : null;
// One line per cold start: the only way to tell from runtime logs which backend a deployment is on.
if (r2Store) console.log("storage: r2");

// Blob pathnames dislike ":" and "="; keys are ASCII so a flat replace is enough. R2 uses the same
// path, so a copy of the bucket keeps every key readable.
const pathOf = (key) => `kv/${String(key).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;

// Reads of slow-changing keys are cached for 10s in this instance: a warm function often answers the
// same key twice (home screen, then its overdue list). Money keys (`bill:`, `slip-ref:`, `qr-code:`)
// are never cached, and every write drops the entry, so a cache hit can only be a read that was
// already true when it was stored.
const CACHE_TTL_MS = 10_000;
const CACHEABLE = /^(dorm|room:|bill-state:|bills:|rooms:)/;
const cache = new Map();

// A cache miss costs one backend read; a hit must not hand out a shared object that a caller then
// mutates, so the entry is stored as the JSON text it came from.
const fresh = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.text;
};

const get = async (key) => {
  const remember = CACHEABLE.test(key);
  const text = remember ? fresh(key) : null;
  if (text != null) return JSON.parse(text);
  const body = r2Store ? await r2Store.getText(pathOf(key)) : await blobText(pathOf(key));
  if (body == null) return null;
  if (remember) cache.set(key, { at: Date.now(), text: body });
  return JSON.parse(body);
};

const blobText = async (path) => {
  const res = await blobStore.get(path, { access: "private", useCache: false });
  if (!res) return null;
  return new Response(res.stream).text();
};

const set = async (key, value) => {
  cache.delete(key);
  const body = JSON.stringify(value);
  if (r2Store) return r2Store.putText(pathOf(key), body);
  await blobStore.put(pathOf(key), body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
};

// Keys that start with `prefix`, e.g. keysWith("owner:U") -> ["owner:Uabc…", …].
// The part after the prefix must be plain letters/digits (LINE userIds are), because pathOf() is
// one-way for other characters.
const keysWith = async (prefix) => {
  const pathPrefix = pathOf(prefix).replace(/\.json$/, "");
  const paths = r2Store ? await r2Store.listPaths(pathPrefix) : await blobPaths(pathPrefix);
  return paths.map((p) => prefix + p.slice(pathPrefix.length).replace(/\.json$/, ""));
};

const blobPaths = async (pathPrefix) => {
  const paths = [];
  let cursor;
  do {
    const page = await blobStore.list({ prefix: pathPrefix, cursor, limit: 1000 });
    for (const blob of page.blobs) paths.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
};

// Slip photos: private files next to the JSON keys.
const putFile = (path, bytes, contentType) =>
  r2Store ? r2Store.putFile(path, bytes, contentType)
    : blobStore.put(path, bytes, { access: "private", contentType, allowOverwrite: true });
const delFile = (path) => (r2Store ? r2Store.delFile(path) : blobStore.del(path));
const getFile = (path) =>
  r2Store ? r2Store.getFile(path) : blobStore.get(path, { access: "private", useCache: false });

module.exports = { get, set, keysWith, putFile, delFile, getFile };
