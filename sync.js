// Sync: keeps your projects and palettes the same on all your devices,
// through the Comp-Art sync server (worker/worker.js, on Cloudflare).
//
// Local-first: everything still lives on the device (IndexedDB) and works
// offline; sync runs in the background and merges, it never wipes. Each
// account's files on the server:
//   index.json       the projects: {projects: {id: {name, nameT, created,
//                    updated, photos}}, deleted: {id: time}, purged: {id: 1}}
//   palettes.json    {t, paints, palettes} (the whole record, newest wins)
//   p/<id>/doc.json  one project: {files: {ref|photo|aligned|thumb|meta|align:
//                    {t, k?, gone?}}, meta, align, items: [{id, t, key, k,
//                    tk?}], deleted: [stage ids]}. meta (the settings) and
//                    align (the alignment) are records kept in the document;
//                    the rest are images.
//   p/<id>/<name>-<t>  the images, each version under its own name (so two
//                    devices uploading at once can't mix them up)
// Progress stages merge as a union (by id; the newer of a stage on both
// wins); deleted stages and projects stay deleted; everything else: the
// newest wins. The documents are written only over the version that was
// read (If-Match), so a device that lost a race merges again.
//
// On this device: "sync" {url, code, name} (absent = sync off), "syncg"
// {palT}, and per project "p/<id>/syncv" ({name: {t, gone?, sig?}}), the
// version of each file, bumped by every write the app makes.
window.Sync = (function(){
  "use strict";

  // the sync server's address (the Worker's workers.dev address)
  var DEFAULT_URL = "https://comp-art-sync.rstigall-4f5.workers.dev/";
  var SINGLE = ["ref", "photo", "aligned", "thumb", "meta", "align"];
  var RECORD = { meta: 1, align: 1 };     // kept in doc.json, not as files

  var cfg = null, hooks = {}, gver = { palT: 0 };
  var vers = {}, versLoad = {};
  var running = null, again = false, timer = 0;
  // limited: projects over the project limit; full: the storage cap was hit
  var st = { state: "off", last: 0, files: 0, done: 0, error: null, limited: [], full: false, info: null };

  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function err(code){ var e = new Error(code); e.code = code; return e; }
  function status(patch){
    for(var k in patch) st[k] = patch[k];
    if(hooks.status){ try{ hooks.status(clone(st)); }catch(e){} }
  }

  // ---------------- versions on this device ----------------
  function loadVers(id){
    if(vers[id]) return Promise.resolve(vers[id]);
    if(!versLoad[id]) versLoad[id] = Store.get("p/" + id + "/syncv").then(function(v){
      vers[id] = (v && typeof v === "object") ? v : {}; return vers[id];
    }).catch(function(){ vers[id] = {}; return vers[id]; });
    return versLoad[id];
  }
  function saveVers(id){ return vers[id] ? Store.set("p/" + id + "/syncv", vers[id]).catch(function(){}) : Promise.resolve(); }
  // a stage's version: when its picture last changed (m, from v2.51), else its time
  function ver(it){ return it.m || it.t; }
  function nextT(prev){ return Math.max(Date.now(), (prev && prev.t || 0) + 1); }
  // every write the app makes to a project (through Projects.scoped)
  function onWrite(id, k, v, removed){
    if(k && SINGLE.indexOf(k) >= 0){
      loadVers(id).then(function(V){
        if(RECORD[k]){
          var sig = JSON.stringify(v);
          if(V[k] && V[k].sig === sig) return;             // the same record again
          V[k] = { t: nextT(V[k]), sig: sig };
        }
        else V[k] = removed ? { t: nextT(V[k]), gone: true } : { t: nextT(V[k]) };
        saveVers(id);
      });
    }
    schedule(4000);
  }
  function palettesChanged(){
    gver.palT = nextT({ t: gver.palT });
    Store.set("syncg", gver).catch(function(){});
    schedule(4000);
  }

  // ---------------- the server ----------------
  // o: {body, headers, as: "blob", conn: {url, auth}} (conn: another
  // server or key than this device's account, for signing up and admin)
  function call(method, path, o){
    o = o || {};
    var conn = o.conn || { url: cfg.url, auth: "Bearer " + cfg.code }, h = {};
    if(conn.auth) h.Authorization = conn.auth;
    for(var k in o.headers || {}) h[k] = o.headers[k];
    var as = o.as;
    return fetch(conn.url + path, { method: method, headers: h, body: o.body, cache: "no-store" })
      .catch(function(){ throw err("offline"); })
      .then(function(res){
        if(res.ok){
          var etag = res.headers.get("ETag");
          var p = as === "blob" ? res.blob() : res.json();
          return p.then(function(data){ return { data: data, etag: etag }; });
        }
        if(res.status === 404 && method === "GET") return null;
        return res.json().catch(function(){ return {}; }).then(function(j){ throw err(j.error || (res.status >= 500 ? "server" : "http" + res.status)); });
      });
  }
  function getJson(path){ return call("GET", "/f/" + path); }
  function getBlob(path){ return call("GET", "/f/" + path, { as: "blob" }).then(function(r){ return r && r.data; }); }
  function putBlob(path, blob){
    count(1);
    return call("PUT", "/f/" + path, { body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" } }).then(function(){ done(1); });
  }
  // a document, only over the version read (etag), or only if there's none yet
  function putDoc(path, v, etag){
    var h = { "Content-Type": "application/json" };
    if(etag) h["If-Match"] = etag; else h["X-If-Absent"] = "1";
    return call("PUT", "/f/" + path, { body: JSON.stringify(v), headers: h });
  }
  function del(path){ return call("DELETE", "/f/" + path).catch(function(){}); }
  function count(n){ status({ files: st.files + n }); }
  function done(n){ status({ done: st.done + n }); }

  // ---------------- one sync ----------------
  function schedule(ms){
    if(!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }
  function run(){
    clearTimeout(timer);
    if(!cfg) return Promise.resolve();
    if(running){ again = true; return running; }
    status({ state: "syncing", files: 0, done: 0, error: null });
    var tries = 0;
    function attempt(){
      return syncAll().catch(function(e){
        if(e.code === "conflict" && ++tries < 4) return attempt();   // another device wrote meanwhile
        throw e;
      });
    }
    running = attempt().then(function(){
      status({ state: "ok", last: Date.now(), error: null });
    }, function(e){
      status({ state: "error", error: (e && e.code) || "server" });
    }).then(function(){
      running = null;
      if(again){ again = false; schedule(1500); }
    });
    return running;
  }

  function syncAll(){
    var keySet = {}, idx = null, merged = null, limited = [], full = false, serverProjects = 0;
    return call("GET", "/me").then(function(r){
      status({ info: r && r.data });
      serverProjects = (r && r.data && r.data.projects) || 0;
      return Store.keys();
    }).then(function(keys){
      keys.forEach(function(k){ keySet[k] = 1; });
      return getJson("index.json");
    }).then(function(r){
      idx = r;
      var c = (r && r.data) || {}, loc = Projects.syncState();
      merged = { v: 1, projects: clone(c.projects) || {}, deleted: clone(c.deleted) || {}, purged: clone(c.purged) || {} };
      Object.keys(loc.deleted).forEach(function(id){ if(!merged.deleted[id] || merged.deleted[id] < loc.deleted[id]) merged.deleted[id] = loc.deleted[id]; });
      Object.keys(merged.deleted).forEach(function(id){ delete merged.projects[id]; });
      return Projects.absorb(merged);
    }).then(function(out){
      if((out.added.length || out.removed.length || out.renamed.length) && hooks.projects) hooks.projects(out);
      return syncPalettes();
    }).then(function(){
      // every project here: those on the server, and new ones with something in them
      var ids = Projects.syncState().list.map(function(p){ return p.id; }).filter(function(id){
        return merged.projects[id] || keySet["p/" + id + "/ref"] || keySet["p/" + id + "/progress"];
      });
      return ids.reduce(function(chain, id){
        return chain.then(function(){
          return syncProject(id, keySet, 0).then(function(res){
            var p = Projects.get(id);
            if(res.limit){ if(p) limited.push(p.name); return; }
            if(res.full){ full = true; return; }
            if(!p) return;
            merged.projects[id] = { name: p.name, nameT: p.nameT || 0, created: p.created, updated: Math.max(p.updated || 0, (merged.projects[id] || {}).updated || 0), photos: res.photos };
          });
        });
      }, Promise.resolve());
    }).then(function(){
      status({ limited: limited, full: full });
      // deleted projects: their files go from the server (once; and again
      // for all of them when the server holds more project folders than
      // expected, which an upload racing a deletion can leave behind)
      var recheck = serverProjects > Object.keys(merged.projects).length;
      var gone = Object.keys(merged.deleted).filter(function(id){ return recheck || !merged.purged[id]; });
      return gone.reduce(function(chain, id){
        return chain.then(function(){
          return call("GET", "/list?prefix=" + encodeURIComponent("p/" + id + "/")).then(function(r){
            var files = (r && r.data) || [];
            return Promise.all(files.map(function(f){ return del(f.key); }));
          }).then(function(){ merged.purged[id] = 1; });
        });
      }, Promise.resolve());
    }).then(function(){
      if(st.info){ var info = clone(st.info); info.projects = Object.keys(merged.projects).length; status({ info: info }); }
      if(idx && JSON.stringify(idx.data) === JSON.stringify(merged)) return;
      return putDoc("index.json", merged, idx && idx.etag);
    });
  }

  // ---- palettes: the whole record, newest wins ----
  function syncPalettes(){
    return Promise.all([getJson("palettes.json"), Store.get("paints"), Store.get("palettes")]).then(function(r){
      var c = r[0] && r[0].data, ct = (c && c.t) || 0;
      var mine = (r[1] && r[1].length) || (r[2] && r[2].list && r[2].list.length);
      var lt = gver.palT || (mine ? 1 : 0);
      // the first sync on a device with palettes of its own: both sets are kept
      if(!gver.joined && mine && c){
        var paints = (c.paints || []).slice(), pl = clone(c.palettes) || { list: [] };
        pl.list = pl.list || [];
        (r[1] || []).forEach(function(x){ if(!paints.some(function(y){ return y.id === x.id; })) paints.push(x); });
        ((r[2] && r[2].list) || []).forEach(function(x){ if(!pl.list.some(function(y){ return y.id === x.id; })) pl.list.push(x); });
        pl.active = (r[2] && r[2].active) || pl.active;
        var t = nextT({ t: Math.max(ct, lt) });
        return putDoc("palettes.json", { t: t, paints: paints, palettes: pl }, r[0].etag).then(function(){
          return Promise.all([Store.set("paints", paints), Store.set("palettes", pl)]);
        }).then(function(){
          gver.palT = t; gver.joined = true;
          return Store.set("syncg", gver);
        }).then(function(){ if(hooks.palettes) hooks.palettes(); });
      }
      if(!gver.joined){ gver.joined = true; Store.set("syncg", gver).catch(function(){}); }
      if(lt > ct){
        return putDoc("palettes.json", { t: lt, paints: r[1] || [], palettes: r[2] || { active: "default", list: [] } }, r[0] && r[0].etag);
      }
      if(ct > lt){
        var pals = clone(c.palettes) || { list: [] };
        if(r[2] && r[2].active) pals.active = r[2].active;   // which palette is in use stays this device's
        return Promise.all([Store.set("paints", c.paints || []), Store.set("palettes", pals)]).then(function(){
          gver.palT = ct;
          return Store.set("syncg", gver);
        }).then(function(){ if(hooks.palettes) hooks.palettes(); });
      }
    });
  }

  // ---- one project ----
  // The version stamps are taken before any content is read, so what's
  // uploaded is always at least as new as its stamp: a change made while
  // this runs gets a newer stamp and goes up next time.
  function syncProject(id, keySet, tries){
    var P = "p/" + id + "/", V, before = {};
    return loadVers(id).then(function(v){
      V = v;
      SINGLE.forEach(function(k){ before[k] = V[k]; });
      return Promise.all([getJson(P + "doc.json"), Store.get(P + "progress"), Store.get(P + "meta"), Store.get(P + "align")]);
    }).then(function(r){
      var cdoc = r[0] ? r[0].data : null, etag = r[0] ? r[0].etag : null, rec = r[1], local = { meta: r[2], align: r[3] };
      var doc = cdoc ? clone(cdoc) : { v: 1, files: {}, meta: null, items: [], deleted: [] };
      doc.files = doc.files || {}; doc.items = doc.items || []; doc.deleted = doc.deleted || [];
      var ups = [], downs = [], gc = [], changed = { reload: false, stages: false };

      // the reference, painting photo, aligned image, thumbnail and settings
      SINGLE.forEach(function(k){
        var lv = before[k] || (keySet[P + k] ? { t: 1 } : null), cv = doc.files[k] || null;
        var lt = lv ? lv.t : 0, ct = cv ? cv.t : 0;
        if(lt > ct){
          if(lv.gone){ if(cv && cv.k) gc.push(cv.k); doc.files[k] = { t: lt, gone: true }; if(RECORD[k]) doc[k] = null; return; }
          if(RECORD[k]){ if(local[k]){ doc[k] = clone(local[k]); doc.files[k] = { t: lt }; } return; }
          var name = k + "-" + lt;
          ups.push(function(){
            return Store.get(P + k).then(function(b){
              if(!b) return;                           // nothing to upload after all: the cloud's entry stays
              if(cv && cv.k && cv.k !== name) gc.push(cv.k);
              doc.files[k] = { t: lt, k: name };
              return putBlob(P + name, b);
            });
          });
        }
        else if(ct > lt){
          downs.push(function(){
            if(V[k] !== before[k]) return;           // changed here meanwhile: that wins next time
            if(cv.gone){
              V[k] = { t: ct, gone: true };
              changed.reload = true;
              return Store.remove(P + k);
            }
            if(RECORD[k]){
              if(!doc[k]) return;
              V[k] = { t: ct, sig: JSON.stringify(doc[k]) };
              changed.reload = true;
              return Store.set(P + k, doc[k]);
            }
            return getBlob(P + cv.k).then(function(b){
              done(1);
              if(!b || V[k] !== before[k]) return;
              V[k] = { t: ct };
              changed.reload = true;
              return Store.set(P + k, b);
            });
          });
          if(!cv.gone && !RECORD[k]) count(1);
        }
      });

      // progress stages
      var litems = Array.isArray(rec) ? rec : (rec && Array.isArray(rec.items) ? rec.items : []);
      var ldel = (rec && Array.isArray(rec.deleted)) ? rec.deleted : [];
      var D = doc.deleted.slice();
      ldel.forEach(function(x){ if(D.indexOf(x) < 0) D.push(x); });
      var L = {}, C = {};
      litems.forEach(function(it){ L[it.id] = it; });
      doc.items.forEach(function(it){ C[it.id] = it; });
      var got = [], out = [];
      Object.keys(L).concat(Object.keys(C).filter(function(x){ return !L[x]; })).forEach(function(sid){
        var l = L[sid], c = C[sid];
        if(D.indexOf(sid) >= 0){
          if(c){ if(c.k) gc.push(c.k); if(c.tk) gc.push(c.tk); }
          if(l) downs.push(function(){ return Promise.all([Store.remove(P + "prog-" + sid), Store.remove(P + "progt-" + sid)]); });
          return;
        }
        if(l && (!c || ver(l) > ver(c))){
          var k = "prog-" + sid + "-" + ver(l), tk = keySet[P + "progt-" + sid] ? "progt-" + sid + "-" + ver(l) : null;
          var item = { id: sid, t: l.t, key: l.key || null, k: k };
          if(l.m) item.m = l.m;
          if(tk) item.tk = tk;
          if(c){ if(c.k && c.k !== k) gc.push(c.k); if(c.tk && c.tk !== tk) gc.push(c.tk); }
          out.push(item);
          ups.push(function(){
            return Store.get(P + "prog-" + sid).then(function(b){
              if(!b){ out = out.filter(function(x){ return x !== item; }); return; }
              return putBlob(P + k, b).then(function(){
                if(!tk) return;
                return Store.get(P + "progt-" + sid).then(function(t){ if(t) return putBlob(P + tk, t); else delete item.tk; });
              });
            });
          });
        }
        else if(c && (!l || ver(c) > ver(l))){
          out.push(c);
          count(c.tk ? 2 : 1);
          downs.push(function(){
            return getBlob(P + c.k).then(function(b){
              done(1);
              if(!b) return;
              return (c.tk ? getBlob(P + c.tk) : Promise.resolve(null)).then(function(t){
                if(c.tk) done(1);
                return Promise.all([Store.set(P + "prog-" + sid, b), t ? Store.set(P + "progt-" + sid, t) : Store.remove(P + "progt-" + sid)]);
              }).then(function(){ var g = { id: sid, t: c.t, key: c.key || null }; if(c.m) g.m = c.m; got.push(g); });
            });
          });
        }
        else out.push(c || l);
      });

      // upload, then write the document over the version read, then download
      return ups.reduce(function(ch, f){ return ch.then(f); }, Promise.resolve()).then(function(){
        doc.items = out.filter(function(it){ return it && it.k; }).sort(function(a, b){ return a.t - b.t; });
        doc.deleted = D;
        if(cdoc && JSON.stringify(cdoc) === JSON.stringify(doc)) return;
        return putDoc(P + "doc.json", doc, etag);
      }).then(function(){
        gc.forEach(function(k){ del(P + k); });
        return downs.reduce(function(ch, f){ return ch.then(f); }, Promise.resolve());
      }).then(function(){
        // the downloaded stages join the list here
        if(id === Projects.activeId()) return Progress.merge(got, D).then(function(c){ if(c) changed.stages = true; });
        return Store.get(P + "progress").then(function(rec2){
          var items = Array.isArray(rec2) ? rec2 : (rec2 && rec2.items) || [], del2 = (rec2 && rec2.deleted) || [];
          D.forEach(function(x){ if(del2.indexOf(x) < 0) del2.push(x); });
          var by = {};
          items.concat(got).forEach(function(it){ if(!by[it.id] || ver(by[it.id]) < ver(it)) by[it.id] = it; });
          var next = Object.keys(by).map(function(x){ return by[x]; }).filter(function(it){ return del2.indexOf(it.id) < 0; })
            .sort(function(a, b){ return a.t - b.t; });
          Projects.setPhotos(id, next.length);
          if(!got.length && next.length === items.length && del2.length === ((rec2 && rec2.deleted) || []).length) return;
          changed.stages = true;
          return Store.set(P + "progress", { items: next, deleted: del2 });
        });
      }).then(function(){
        return saveVers(id);
      }).then(function(){
        if((changed.reload || changed.stages) && hooks.changed) hooks.changed(id, changed);
        return { photos: doc.items.length };
      });
    }).catch(function(e){
      if(e.code === "limit") return { limit: true };
      if(e.code === "storage") return { full: true };
      if(e.code === "conflict" && tries < 3) return syncProject(id, keySet, tries + 1);
      throw e;
    });
  }

  // ---------------- turning it on and off ----------------
  function saveCfg(){ return cfg ? Store.set("sync", cfg) : Store.remove("sync"); }
  // (https, except for a local test server: the sync code travels with every request)
  function serverUrl(u){
    u = String(u || DEFAULT_URL || "").trim().replace(/\/+$/, "");
    if(!u) return "";
    if(!/^https?:\/\//.test(u)) u = "https://" + u;
    if(/^http:\/\//.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) u = u.replace(/^http:/, "https:");
    return u;
  }
  // a new account (needs the invite code)
  function signup(url, invite, name){
    url = serverUrl(url);
    if(!url) return Promise.reject(err("no-server"));
    return call("POST", "/signup", { body: JSON.stringify({ invite: invite, name: name }), headers: { "Content-Type": "application/json" }, conn: { url: url } }).then(function(r){
      cfg = { url: url, code: r.data.code, name: r.data.name };
      return saveCfg();
    }).then(function(){ run(); return clone(cfg); });
  }
  // this device joins an account with its sync code
  function join(url, code){
    url = serverUrl(url);
    if(!url) return Promise.reject(err("no-server"));
    var prev = cfg;
    cfg = { url: url, code: String(code || "").trim().toUpperCase() };
    return call("GET", "/me").then(function(r){
      cfg.name = r && r.data && r.data.name;
      return saveCfg();
    }).then(function(){ run(); return clone(cfg); }, function(e){ cfg = prev; throw e; });
  }
  function leave(){
    clearTimeout(timer);
    cfg = null;
    gver.joined = false;                       // joining again keeps both palettes again
    Store.set("syncg", gver).catch(function(){});
    status({ state: "off", error: null, last: 0, limited: [], full: false, info: null });
    return saveCfg();
  }
  function rotate(){
    return call("POST", "/rotate").then(function(r){ cfg.code = r.data.code; return saveCfg(); }).then(function(){ return cfg.code; });
  }

  // ---------------- admin (the account owner's screen) ----------------
  // a: {url, key}
  function admin(a, method, path, body, as){
    return call(method, "/admin" + path, { body: body ? JSON.stringify(body) : null, headers: body ? { "Content-Type": "application/json" } : null,
                                           as: as, conn: { url: serverUrl(a.url), auth: "Admin " + a.key } })
      .then(function(r){ return r && r.data; });
  }

  // ---------------- start ----------------
  function init(h){
    hooks = h || {};
    Projects.onWrite(onWrite);
    return Promise.all([Store.get("sync"), Store.get("syncg")]).then(function(r){
      if(r[0] && r[0].url && r[0].code) cfg = r[0];
      if(r[1] && typeof r[1].palT === "number") gver = r[1];
    }).catch(function(){}).then(function(){
      status({ state: cfg ? "idle" : "off" });
      document.addEventListener("visibilitychange", function(){ if(!document.hidden && Date.now() - st.last > 20000) schedule(800); });
      window.addEventListener("online", function(){ schedule(800); });
      // while the app is open, now and then: picks up what another device did
      setInterval(function(){ if(cfg && !document.hidden && !running && Date.now() - st.last > 85000) run(); }, 30000);
    });
  }

  return {
    init: init, run: run, signup: signup, join: join, leave: leave, rotate: rotate,
    palettesChanged: palettesChanged, admin: admin,
    on: function(){ return !!cfg; }, account: function(){ return clone(cfg); },
    status: function(){ return clone(st); }, defaultUrl: function(){ return DEFAULT_URL; }
  };
})();
