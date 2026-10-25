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
window.Projects = (function(){
  "use strict";

  var store = null, reg = { active: null, list: [] };
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
        if(!get(reg.active)) reg.active = reg.list[0].id;
        return;
      }
      // first run with projects: the single painting (if there is one) becomes the first project
      return store.get("ref").then(function(ref){
        var id = uid(), now = Date.now();
        reg = { active: id, list: [{ id: id, name: ref ? "My painting" : defaultName(), created: now, updated: now, photos: 0 }], legacy: !!ref };
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
      reg = { active: id, list: [{ id: id, name: defaultName(), created: now, updated: now, photos: 0 }] };
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
    reg.list.push({ id: id, name: name || defaultName(), created: now, updated: now, photos: 0 });
    save().catch(function(){});
    return id;
  }
  function rename(id, name){
    var p = get(id); if(!p) return;
    p.name = String(name || "").trim() || p.name;
    save().catch(function(){});
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
      set: function(k, v){ return store.set(pre + k, v); },
      remove: function(k){ return store.remove(pre + k); }
    };
  }

  return { init: init, cleanupLegacy: cleanupLegacy, list: list, get: get, active: active, activeId: activeId,
           setActive: setActive, create: create, rename: rename, touch: touch, remove: remove, scoped: scoped, defaultName: defaultName };
})();
