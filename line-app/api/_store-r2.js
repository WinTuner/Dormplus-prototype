// Cloudflare R2 through the S3 API — only the six calls `_store.js` needs.
//
// Signed with aws4fetch (a few kB) instead of @aws-sdk/client-s3 (several MB): every Vercel function
// pays bundle size at cold start, and we sign exactly four verbs.
//
// Keys keep the `kv/<key>.json` path the Blob store used, so a copied bucket needs no rewriting.
const { AwsClient } = require("aws4fetch");

const XML_KEY = /<Key>([^<]*)<\/Key>/g;

function createStore(env = process.env, fetchImpl = undefined) {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY ต้องครบ");
  }
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  const objectUrl = (path) => `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;

  // Sign here and call fetch ourselves, so tests can pass a fake one (aws4fetch has no fetch option).
  const send = async (url, init) => (fetchImpl || fetch)(await aws.sign(url, init));

  return {
    async getText(path) {
      const res = await send(objectUrl(path));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${path} -> ${res.status}`);
      return res.text();
    },

    // The ETag is what makes a read-modify-write safe: a second writer's PUT then fails instead of
    // overwriting the first one's merge (R2 honours If-Match / If-None-Match on PUT).
    async getVersioned(path) {
      const res = await send(objectUrl(path));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${path} -> ${res.status}`);
      return { text: await res.text(), etag: res.headers.get("etag") };
    },

    // null when the precondition failed: someone else wrote the key first.
    async putVersioned(path, body, { ifMatch, ifNoneMatch } = {}) {
      const headers = { "Content-Type": "application/json" };
      if (ifMatch) headers["If-Match"] = ifMatch;
      if (ifNoneMatch) headers["If-None-Match"] = "*";
      const res = await send(objectUrl(path), { method: "PUT", body, headers });
      if (res.status === 412 || res.status === 409) return null;
      if (!res.ok) throw new Error(`R2 PUT ${path} -> ${res.status}`);
      return { etag: res.headers.get("etag") };
    },

    async putText(path, body) {
      const res = await send(objectUrl(path), {
        method: "PUT",
        body,
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`R2 PUT ${path} -> ${res.status}`);
    },

    async putFile(path, bytes, contentType) {
      const res = await send(objectUrl(path), {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": contentType || "application/octet-stream" },
      });
      if (!res.ok) throw new Error(`R2 PUT ${path} -> ${res.status}`);
    },

    async delFile(path) {
      const res = await send(objectUrl(path), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${path} -> ${res.status}`);
    },

    // The shape `slip-image.js` expects from Vercel Blob: { stream, blob: { contentType } }.
    async getFile(path) {
      const res = await send(objectUrl(path));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${path} -> ${res.status}`);
      return { stream: res.body, blob: { contentType: res.headers.get("content-type") } };
    },

    // Every path under `prefix`, following S3's continuation token.
    async listPaths(prefix) {
      const paths = [];
      let token = null;
      do {
        const query = `?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`;
        const res = await send(`${base}${query}`);
        if (!res.ok) throw new Error(`R2 LIST ${prefix} -> ${res.status}`);
        const xml = await res.text();
        for (const m of xml.matchAll(XML_KEY)) paths.push(m[1].replace(/&amp;/g, "&"));
        const next = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? next[1] : null;
      } while (token);
      return paths;
    },
  };
}

module.exports = { createStore };
