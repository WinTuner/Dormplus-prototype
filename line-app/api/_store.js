// Vercel Blob store — one JSON file per key in a private store (OIDC auth), plus the slip photos.
// Everything that touches Blob goes through this file, so tests can swap it for an in-memory map.
const { put, get: blobGet, del, list } = require("@vercel/blob");

// Blob pathnames dislike ":" and "="; keys are ASCII so a flat replace is enough.
const pathOf = (key) => `kv/${String(key).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;

const get = async (key) => {
  const res = await blobGet(pathOf(key), { access: "private", useCache: false });
  if (!res) return null;
  return JSON.parse(await new Response(res.stream).text());
};

const set = async (key, value) => {
  await put(pathOf(key), JSON.stringify(value), {
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
  const keys = [];
  let cursor;
  do {
    const page = await list({ prefix: pathPrefix, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      keys.push(prefix + blob.pathname.slice(pathPrefix.length).replace(/\.json$/, ""));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return keys;
};

// Slip photos: private files next to the JSON keys.
const putFile = (path, bytes, contentType) => put(path, bytes, { access: "private", contentType, allowOverwrite: true });
const delFile = (path) => del(path);
const getFile = (path) => blobGet(path, { access: "private", useCache: false });

module.exports = { get, set, keysWith, putFile, delFile, getFile };
