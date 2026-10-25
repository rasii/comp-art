// Projects: one painting each, with its own reference, painting photo,
// alignment, settings and Progress history. Palettes and your own paints
// are shared by all projects (palettes.js).
//
// Stored on the device: the list under Store key "projects"
// ({active, list: [{id, name, created, updated, photos}], legacy?}) and
// each project's data under keys prefixed "p/<id>/" (ref, photo, aligned,
// meta, progress, prog-…, progt-…, thumb). scoped(id) gives a store that
// adds the prefix, so the rest of the app reads and writes a project
// exactly as it used to read and write the single painting.
//
// The first run after projects arrived copies the single painting into a
// first project. The old keys stay until the copy has opened correctly
// (cleanupLegacy), so nothing can be lost on the way.
//
// For sync (sync.js): each project's name carries the time it was set
// (nameT), deleted projects are remembered ({id: time} under `deleted`) so
// another device can't bring them back, and every write through a scoped
// store is reported to onWrite.
window.Projects = (function(){
  "use strict";

  var store = null, reg = { active: null, list: [], deleted: {} }, writeHook = null;
  var LEGACY = ["ref", "photo", "aligned", "meta", "progress"];

  function uid(){ return "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function prefix(id){ return "p/" + id + "/"; }
  function save(){ return store.set("projects", JSON.parse(JSON.stringify(reg))); }
  function isLegacyKey(k){ return typeof k === "string" && (LEGACY.indexOf(k) >= 0 || /^progt?-/.test(k)); }
  function defaultName(){
    return "Painting · " + new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function init(s){
    store = s;
    return store.get("projects").then(function(r){
      if(r && Array.isArray(r.list) && r.list.length){
        reg = r;
        if(!reg.deleted || typeof reg.deleted !== "object") reg.deleted = {};
        if(!get(reg.active)) reg.active = reg.list[0].id;
        return;
      }
      // first run with projects: the single painting (if there is one) becomes the first project
      return store.get("ref").then(function(ref){
        var id = uid(), now = Date.now();
        reg = { active: id, list: [{ id: id, name: ref ? "My painting" : defaultName(), nameT: now, created: now, updated: now, photos: 0 }], deleted: {}, legacy: !!ref };
        if(!ref) return save();
        return store.keys().then(function(keys){
          var legacy = keys.filter(isLegacyKey);
          return Promise.all(legacy.map(function(k){
            return store.get(k).then(function(v){ return store.set(prefix(id) + k, v); });
          }));
        }).then(function(){ return store.get("progress"); }).then(function(p){
          var items = Array.isArray(p) ? p : (p && p.items) || [];
          reg.list[0].photos = items.length;
          return save();
        });
      });
    }).catch(function(){
      var id = uid(), now = Date.now();
      reg = { active: id, list: [{ id: id, name: defaultName(), nameT: now, created: now, updated: now, photos: 0 }], deleted: {} };
    });
  }
  // once the copied project has opened, the single painting's old keys go
  function cleanupLegacy(){
    if(!reg.legacy) return Promise.resolve();
    return store.keys().then(function(keys){
      return Promise.all(keys.filter(isLegacyKey).map(function(k){ return store.remove(k); }));
    }).then(function(){ delete reg.legacy; return save(); }).catch(function(){});
  }

  function list(){ return reg.list.slice().sort(function(a, b){ return b.updated - a.updated; }); }
  function get(id){ return reg.list.filter(function(p){ return p.id === id; })[0] || null; }
  function active(){ return get(reg.active); }
  function activeId(){ return reg.active; }
  function setActive(id){ if(get(id)){ reg.active = id; save().catch(function(){}); } }
  function create(name){
    var id = uid(), now = Date.now();
    reg.list.push({ id: id, name: name || defaultName(), nameT: now, created: now, updated: now, photos: 0 });
    save().catch(function(){});
    notify(id, null);
    return id;
  }
  function rename(id, name){
    var p = get(id); if(!p) return;
    p.name = String(name || "").trim() || p.name;
    p.nameT = Date.now();
    save().catch(function(){});
    notify(id, null);
  }
  // marks a project as just used, optionally with its number of photos
  function touch(id, photos){
    var p = get(id); if(!p) return;
    p.updated = Date.now();
    if(typeof photos === "number") p.photos = photos;
    save().catch(function(){});
  }
  // deletes a project and everything stored for it
  function remove(id){
    reg.deleted[id] = Date.now();
    notify(id, null);
    return removeHere(id);
  }
  // (deleted here, or on another device)
  function removeHere(id){
    reg.list = reg.list.filter(function(p){ return p.id !== id; });
    if(reg.active === id) reg.active = reg.list.length ? list()[0].id : null;
    return store.keys().then(function(keys){
      var pre = prefix(id);
      return Promise.all(keys.filter(function(k){ return typeof k === "string" && k.indexOf(pre) === 0; }).map(function(k){ return store.remove(k); }));
    }).then(save);
  }
  // a store for one project's data
  function scoped(id){
    var pre = prefix(id);
    return {
      get: function(k){ return store.get(pre + k); },
      set: function(k, v){ notify(id, k, v, false); return store.set(pre + k, v); },
      remove: function(k){ notify(id, k, null, true); return store.remove(pre + k); }
    };
  }
  function notify(id, k, v, removed){ if(writeHook){ try{ writeHook(id, k, v, removed); }catch(e){} } }
  function onWrite(fn){ writeHook = fn; }

  // ---- for sync ----
  function syncState(){ return JSON.parse(JSON.stringify({ list: reg.list, deleted: reg.deleted })); }
  // Takes in the merged list from sync: adds projects made on other
  // devices, takes their names when newer, deletes what was deleted
  // elsewhere. Returns {added, removed, renamed} (ids).
  function absorb(merged){
    var out = { added: [], removed: [], renamed: [] };
    Object.keys(merged.deleted || {}).forEach(function(id){
      if(!reg.deleted[id] || reg.deleted[id] < merged.deleted[id]) reg.deleted[id] = merged.deleted[id];
      if(get(id)) out.removed.push(id);
    });
    Object.keys(merged.projects || {}).forEach(function(id){
      var c = merged.projects[id], p = get(id);
      if(reg.deleted[id]) return;
      if(!p){
        reg.list.push({ id: id, name: c.name || defaultName(), nameT: c.nameT || 0, created: c.created || Date.now(), updated: c.updated || Date.now(), photos: c.photos || 0 });
        out.added.push(id);
        return;
      }
      if((c.nameT || 0) > (p.nameT || 0) && c.name){ p.name = c.name; p.nameT = c.nameT; out.renamed.push(id); }
      if((c.updated || 0) > (p.updated || 0)) p.updated = c.updated;
    });
    var jobs = out.removed.map(removeHere);
    return Promise.all(jobs).then(save).then(function(){ return out; });
  }
  function setPhotos(id, n){ var p = get(id); if(p && p.photos !== n){ p.photos = n; save().catch(function(){}); } }

  return { init: init, cleanupLegacy: cleanupLegacy, list: list, get: get, active: active, activeId: activeId,
           setActive: setActive, create: create, rename: rename, touch: touch, remove: remove, scoped: scoped, defaultName: defaultName,
           onWrite: onWrite, syncState: syncState, absorb: absorb, setPhotos: setPhotos };
})();
