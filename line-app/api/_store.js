// Vercel Blob store — one JSON file per key in a private store (OIDC auth).
const { put, get: blobGet } = require("@vercel/blob");

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

module.exports = { get, set };
