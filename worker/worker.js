// Comp-Art sync server: a Cloudflare Worker with one R2 bucket.
//
// Setup (see worker/README.md): bind an R2 bucket as BUCKET and set two
// secrets, INVITE_CODE (lets someone create a sync account) and ADMIN_KEY
// (opens the admin screen). Nothing else is needed.
//
// In the bucket:
//   accounts/<acct>.json   {id, name, created, seen, disabled, codeHash}
//   codes/<sha256(code)>   the account id a sync code opens
//   u/<acct>/...           that account's files, written by the app
//                          (index.json, palettes.json, p/<project>/...)
//
// Each person has their own sync code; it only ever opens their own files.
// The app does the merging; this server just stores files, checks codes and
// enforces the limits below.

const PROJECT_LIMIT = 10;                 // projects one account can sync
const MAX_FILE = 40 * 1024 * 1024;        // a single upload
const ORIGINS = ["https://rasii.github.io"];
const SEEN_EVERY = 10 * 60 * 1000;        // how often "last synced" is updated

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req.headers.get("Origin") || "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try { res = await route(req, env); }
    catch (e) { res = json({ error: e.code || "server", detail: e.code ? undefined : String(e && e.message || e) }, e.status || 500); }
    res = new Response(res.body, res);              // headers may be immutable
    for (const k in cors) res.headers.set(k, cors[k]);
    return res;
  }
};

function corsHeaders(origin) {
  const ok = ORIGINS.indexOf(origin) >= 0 || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, X-If-Absent",
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  } : { "Vary": "Origin" };
}

function json(v, status, headers) {
  return new Response(JSON.stringify(v), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
}
function fail(status, code) { const e = new Error(code); e.status = status; e.code = code; return e; }

async function route(req, env) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/", m = req.method;
  if (!env.BUCKET) throw fail(500, "no-bucket");

  if (path === "/" && m === "GET") return json({ app: "comp-art-sync", ok: true });
  if (path === "/signup" && m === "POST") return signup(req, env);
  if (path.indexOf("/admin/") === 0 || path === "/admin") return admin(req, env, path.slice(6), url);

  const acct = await auth(req, env);
  if (path === "/me" && m === "GET") return me(env, acct);
  if (path === "/rotate" && m === "POST") return rotate(env, acct);
  if (path === "/list" && m === "GET") {
    const prefix = cleanKey(url.searchParams.get("prefix") || "", true);
    return json(await listAll(env, "u/" + acct.id + "/", prefix));
  }
  if (path.indexOf("/f/") === 0) {
    const key = cleanKey(decodeURIComponent(path.slice(3)));
    if (m === "GET") return getFile(env, "u/" + acct.id + "/" + key);
    if (m === "PUT") return putFile(req, env, acct, key);
    if (m === "DELETE") { await env.BUCKET.delete("u/" + acct.id + "/" + key); return json({ ok: true }); }
  }
  throw fail(404, "not-found");
}

// ---------------- codes and accounts ----------------
const ALPHA = "ABCDEFGHJKMNPQRSTVWXYZ23456789";     // no 0/O, 1/I/L, U
function randomCode(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  let s = ""; for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}
function pretty(code) { return code.match(/.{1,4}/g).join("-"); }
function normal(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, "0")).join("");
}
async function same(a, b) { return (await sha("x" + a)) === (await sha("x" + b)); }   // no early exit on the secret
async function readJson(env, key) { const o = await env.BUCKET.get(key); return o ? o.json() : null; }
function writeJson(env, key, v) { return env.BUCKET.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } }); }

async function newCode(env, acct) {
  const code = randomCode(20), h = await sha(code);
  await env.BUCKET.put("codes/" + h, acct.id);
  if (acct.codeHash) await env.BUCKET.delete("codes/" + acct.codeHash);
  acct.codeHash = h;
  await writeJson(env, "accounts/" + acct.id + ".json", acct);
  return pretty(code);
}

async function signup(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!env.INVITE_CODE) throw fail(403, "closed");
  if (!(await same(normal(body.invite), normal(env.INVITE_CODE)))) throw fail(403, "invite");
  const name = String(body.name || "").trim().slice(0, 60) || "Painter";
  const now = Date.now();
  const acct = { id: "a" + randomCode(12).toLowerCase(), name, created: now, seen: now, disabled: false, codeHash: null };
  const code = await newCode(env, acct);
  return json({ code, name });
}

async function auth(req, env) {
  const h = req.headers.get("Authorization") || "";
  const code = normal(h.replace(/^Bearer\s+/i, ""));
  if (!code || code.length < 16) throw fail(401, "code");
  const id = await env.BUCKET.get("codes/" + (await sha(code)));
  if (!id) throw fail(401, "code");
  const acct = await readJson(env, "accounts/" + (await id.text()) + ".json");
  if (!acct) throw fail(401, "code");
  if (acct.disabled) throw fail(403, "disabled");
  return acct;
}

async function projectIds(env, acctId) {
  const ids = [];
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix: "u/" + acctId + "/p/", delimiter: "/", cursor });
    (r.delimitedPrefixes || []).forEach(p => ids.push(p.split("/")[3]));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return ids;
}

async function me(env, acct) {
  const now = Date.now();
  if (!acct.seen || now - acct.seen > SEEN_EVERY) { acct.seen = now; await writeJson(env, "accounts/" + acct.id + ".json", acct); }
  return json({ name: acct.name, projects: (await projectIds(env, acct.id)).length, limit: PROJECT_LIMIT });
}

async function rotate(env, acct) { return json({ code: await newCode(env, acct) }); }

// ---------------- files ----------------
function cleanKey(k, allowEmpty) {
  k = String(k || "");
  if (!k && allowEmpty) return "";
  if (k.length > 200 || !/^[A-Za-z0-9._\-\/]+$/.test(k) || k.indexOf("..") >= 0 || k[0] === "/") throw fail(400, "bad-key");
  return k;
}

async function listAll(env, base, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix: base + prefix, cursor });
    r.objects.forEach(o => out.push({ key: o.key.slice(base.length), size: o.size, uploaded: +new Date(o.uploaded) }));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function getFile(env, key) {
  const o = await env.BUCKET.get(key);
  if (!o) throw fail(404, "not-found");
  return new Response(o.body, { headers: {
    "Content-Type": (o.httpMetadata && o.httpMetadata.contentType) || "application/octet-stream",
    "ETag": o.httpEtag, "Cache-Control": "no-store"
  } });
}

async function putFile(req, env, acct, key) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_FILE) throw fail(413, "too-big");
  // a file for a project that isn't on the server yet counts as a new project
  const pm = /^p\/([A-Za-z0-9_-]+)\//.exec(key);
  if (pm) {
    const there = await env.BUCKET.list({ prefix: "u/" + acct.id + "/p/" + pm[1] + "/", limit: 1 });
    if (!there.objects.length && (await projectIds(env, acct.id)).length >= PROJECT_LIMIT) throw fail(403, "limit");
  }
  const full = "u/" + acct.id + "/" + key;
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_FILE) throw fail(413, "too-big");
  const opts = { httpMetadata: { contentType: req.headers.get("Content-Type") || "application/octet-stream" } };
  // documents the app merges are written only over the version it read
  const ifMatch = req.headers.get("If-Match");
  if (ifMatch) opts.onlyIf = { etagMatches: ifMatch.replace(/^W\//, "").replace(/"/g, "") };
  if (req.headers.get("X-If-Absent") && (await env.BUCKET.head(full))) throw fail(412, "conflict");
  const o = await env.BUCKET.put(full, body, opts);
  if (!o) throw fail(412, "conflict");
  return json({ ok: true }, 200, { "ETag": o.httpEtag });
}

// ---------------- admin ----------------
async function admin(req, env, sub, url) {
  const h = req.headers.get("Authorization") || "";
  const key = h.replace(/^Admin\s+/i, "");
  if (!env.ADMIN_KEY || !key || !(await same(key, env.ADMIN_KEY))) throw fail(401, "admin");
  const m = req.method;

  if (sub === "/accounts" && m === "GET") {
    const accts = [];
    let cursor;
    do {
      const r = await env.BUCKET.list({ prefix: "accounts/", cursor });
      for (const o of r.objects) { const a = await readJson(env, o.key); if (a) accts.push(a); }
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    // storage per account, and in all
    const use = {}; let total = 0;
    cursor = undefined;
    do {
      const r = await env.BUCKET.list({ prefix: "u/", cursor });
      r.objects.forEach(o => {
        const id = o.key.split("/")[1];
        const u = use[id] || (use[id] = { bytes: 0, projects: {} });
        u.bytes += o.size; total += o.size;
        const p = o.key.split("/");
        if (p[2] === "p" && p[3]) u.projects[p[3]] = 1;
      });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return json({
      total, limit: PROJECT_LIMIT,
      accounts: accts.map(a => ({ id: a.id, name: a.name, created: a.created, seen: a.seen, disabled: !!a.disabled,
        bytes: use[a.id] ? use[a.id].bytes : 0, projects: use[a.id] ? Object.keys(use[a.id].projects).length : 0 }))
    });
  }
  const am = /^\/accounts\/(a[a-z0-9]+)$/.exec(sub);
  if (am) {
    const acct = await readJson(env, "accounts/" + am[1] + ".json");
    if (!acct) throw fail(404, "not-found");
    if (m === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.disabled === "boolean") acct.disabled = body.disabled;
      if (typeof body.name === "string" && body.name.trim()) acct.name = body.name.trim().slice(0, 60);
      await writeJson(env, "accounts/" + acct.id + ".json", acct);
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const files = await listAll(env, "u/" + acct.id + "/", "");
      for (let i = 0; i < files.length; i += 500) await env.BUCKET.delete(files.slice(i, i + 500).map(f => "u/" + acct.id + "/" + f.key));
      if (acct.codeHash) await env.BUCKET.delete("codes/" + acct.codeHash);
      await env.BUCKET.delete("accounts/" + acct.id + ".json");
      return json({ ok: true, files: files.length });
    }
  }
  const fm = /^\/f\/(a[a-z0-9]+)\/(.+)$/.exec(sub);
  if (fm && m === "GET") return getFile(env, "u/" + fm[1] + "/" + cleanKey(decodeURIComponent(fm[2])));
  throw fail(404, "not-found");
}
