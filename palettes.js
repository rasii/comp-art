// Palettes: named selections of paints to mix from, and your own paints.
//
// - The built-in paints (mix.js) and the Default palette made of them are
//   part of the app, so they're there for every new user and come back if
//   the saved data is ever lost. Default can't be changed or deleted, only
//   copied.
// - Your own paints are described by their pigment codes (pigments.js),
//   optionally with the tube's colour, or by colour alone. They and your
//   palettes are kept on this device (Store keys "paints" and "palettes");
//   export / import moves them between devices or keeps a backup.
window.Palettes = (function(){
  "use strict";

  var DEFAULT = { id: "default", name: "Default (W&N)", builtin: true, paints: Mix.palette.map(function(p){ return p.id; }) };
  var userPaints = [];      // records: {id, name, pigments, variants, colour, strength}
  var resolved = {};        // id → prepared paint (records resolved for mixing)
  var userPalettes = [];    // {id, name, paints: [ids]}
  var activeId = "default";

  function uid(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  // ---------------- paints ----------------
  // Builds a mixable paint from a record. Returns {ok, paint, chips, msg}:
  // chips describe each pigment code found (for the editor), msg explains
  // how the paint was worked out or what's missing.
  function resolve(rec){
    var codes = Pigments.parse(rec.pigments), chips = [], parts = [];
    codes.forEach(function(c){
      var variants = Pigments.variantsOf(c.base);
      var variant = variants ? ((rec.variants && rec.variants[c.base]) || Pigments.guessVariant(c.base, rec.name)) : null;
      var pig = Pigments.lookup(c.base, variant);
      chips.push({ code: c.code, base: c.base, known: !!pig, name: pig ? pig.name : null, variants: variants, variant: variant });
      if(pig) parts.push(pig);
    });
    var unknown = chips.filter(function(c){ return !c.known; }).map(function(c){ return c.code; });
    var colour = rec.colour, msg = [], mix = null, strength = null;
    if(parts.length){
      var lats = parts.map(function(p){ return Mix.latentOfMix(p.mix); }), w;
      if(parts.length > 1 && colour){
        w = Mix.fit(lats, colour.map(function(v){ return Mix.srgbToLin(v/255); }));
        msg.push("Pigment proportions matched to the tube colour.");
      } else {
        w = parts.map(function(){ return 1/parts.length; });
        if(parts.length > 1) msg.push("Equal parts of each pigment assumed; setting the tube colour makes it more accurate.");
        else if(colour) msg.push("With a single pigment the tube colour isn't needed: the pigment's own colour is used.");
      }
      mix = []; strength = 0;
      parts.forEach(function(p, i){
        p.mix.forEach(function(m){ mix.push([m[0], m[1]*w[i]]); });
        strength += w[i]*p.strength;
      });
      if(unknown.length) msg.unshift(unknown.join(", ") + (unknown.length > 1 ? " aren't" : " isn't") + " in the pigment list and " + (unknown.length > 1 ? "are" : "is") + " left out.");
    } else if(colour){
      mix = [[colour, 1]];
      var y = 0.2126*Mix.srgbToLin(colour[0]/255) + 0.7152*Mix.srgbToLin(colour[1]/255) + 0.0722*Mix.srgbToLin(colour[2]/255);
      var auto = y > 0.3 ? 1.5 : y > 0.06 ? 3 : 6;
      strength = rec.strength > 0 ? rec.strength : auto;
      msg.push(unknown.length ? unknown.join(", ") + " not recognised, so the paint is described by its colour." : "Described by its colour.");
      if(y <= 0.06) msg.push("Dark paints described by colour alone mix unreliably; their pigment codes are better.");
    } else {
      msg.push(unknown.length ? "Code not recognised. Check the label, or set the tube's colour instead."
                              : "Enter the pigment codes from the tube label (e.g. PB29), or set its colour.");
      return { ok: false, paint: null, chips: chips, msg: msg.join(" ") };
    }
    var paint = Mix.prepare({ id: rec.id, name: rec.name || "Unnamed paint", pigments: codes.map(function(c){ return c.code; }).join(", "),
                              mix: mix, strength: strength, approx: true, user: true });
    return { ok: true, paint: paint, chips: chips, msg: msg.join(" ") };
  }
  function reresolve(){
    resolved = {};
    userPaints.forEach(function(rec){ var r = resolve(rec); if(r.ok) resolved[rec.id] = r.paint; });
  }
  function paintById(id){
    for(var i=0;i<Mix.palette.length;i++) if(Mix.palette[i].id === id) return Mix.palette[i];
    return resolved[id] || null;
  }
  // every paint that can be mixed: the built-in ones, then yours by name
  function allPaints(){
    var mine = userPaints.map(function(r){ return resolved[r.id]; }).filter(Boolean)
      .sort(function(a, b){ return a.name.localeCompare(b.name); });
    return Mix.palette.concat(mine);
  }
  function paintRecord(id){ var r = userPaints.filter(function(p){ return p.id === id; })[0]; return r ? clone(r) : null; }
  // saves a record (new when it has no id); returns its id
  function savePaint(rec){
    rec = clone(rec);
    if(!rec.id) rec.id = uid("u");
    var i = userPaints.map(function(p){ return p.id; }).indexOf(rec.id);
    if(i >= 0) userPaints[i] = rec; else userPaints.push(rec);
    reresolve();
    return rec.id;
  }
  // deletes one of your paints, and takes it out of every palette
  function deletePaint(id){
    userPaints = userPaints.filter(function(p){ return p.id !== id; });
    userPalettes.forEach(function(pal){ pal.paints = pal.paints.filter(function(x){ return x !== id; }); });
    reresolve();
  }

  // ---------------- palettes ----------------
  function list(){ return [DEFAULT].concat(userPalettes); }
  function get(id){ return list().filter(function(p){ return p.id === id; })[0] || null; }
  function active(){ return get(activeId) || DEFAULT; }
  function setActive(id){ if(get(id)) activeId = id; }
  // the active palette's paints, ready to mix
  function activePaints(){ return active().paints.map(paintById).filter(Boolean); }
  function uniqueName(name){
    var names = list().map(function(p){ return p.name; }), n = name, i = 2;
    while(names.indexOf(n) >= 0) n = name + " " + (i++);
    return n;
  }
  // a new palette, copied from `from` (a palette) or empty
  function create(from){
    var pal = { id: uid("p"), name: uniqueName(from ? (from.builtin ? "My palette" : from.name + " copy") : "My palette"),
                paints: from ? from.paints.slice() : [] };
    userPalettes.push(pal);
    return clone(pal);
  }
  function savePalette(pal){
    if(pal.builtin) return;
    var i = userPalettes.map(function(p){ return p.id; }).indexOf(pal.id);
    var rec = { id: pal.id, name: String(pal.name || "").trim() || "My palette", paints: pal.paints.slice() };
    if(i >= 0) userPalettes[i] = rec; else userPalettes.push(rec);
  }
  function deletePalette(id){
    userPalettes = userPalettes.filter(function(p){ return p.id !== id; });
    if(activeId === id) activeId = "default";
  }

  // ---------------- saving, export / import ----------------
  function records(){ return { paints: clone(userPaints), palettes: { active: activeId, list: clone(userPalettes) } }; }
  function validPaint(r){ return r && typeof r.id === "string" && typeof r.name === "string"; }
  function validPalette(p){ return p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.paints); }
  function load(store){
    return Promise.all([store.get("paints"), store.get("palettes")]).then(function(res){
      userPaints = Array.isArray(res[0]) ? res[0].filter(validPaint) : [];
      var pals = res[1] || {};
      userPalettes = Array.isArray(pals.list) ? pals.list.filter(validPalette) : [];
      activeId = typeof pals.active === "string" && get(pals.active) ? pals.active : "default";
      reresolve();
    }).catch(function(){ userPaints = []; userPalettes = []; activeId = "default"; reresolve(); });
  }
  function save(store){
    var r = records();
    return Promise.all([store.set("paints", r.paints), store.set("palettes", r.palettes)]);
  }
  function exportData(){
    return { format: "comp-art-palettes", version: 1, paints: clone(userPaints), palettes: clone(userPalettes) };
  }
  // Adds what's in an export to what's here (nothing is replaced): paints
  // already here are kept, a clashing palette name gets a number.
  // Returns {paints, palettes} counts, or null if it isn't an export.
  function importData(data){
    if(!data || data.format !== "comp-art-palettes" || !Array.isArray(data.paints) || !Array.isArray(data.palettes)) return null;
    var idMap = {}, added = { paints: 0, palettes: 0 };
    data.paints.filter(validPaint).forEach(function(r){
      var here = userPaints.filter(function(p){ return p.id === r.id; })[0];
      if(here && JSON.stringify(here) === JSON.stringify(r)){ idMap[r.id] = r.id; return; }
      var rec = clone(r);
      if(here) rec.id = uid("u");
      idMap[r.id] = rec.id;
      userPaints.push(rec); added.paints++;
    });
    data.palettes.filter(validPalette).forEach(function(p){
      userPalettes.push({ id: uid("p"), name: uniqueName(p.name),
                          paints: p.paints.map(function(id){ return idMap[id] || id; }).filter(function(id){ return !!paintById(id) || !!idMap[id]; }) });
      added.palettes++;
    });
    reresolve();
    return added;
  }

  reresolve();
  return {
    resolve: resolve, allPaints: allPaints, paintById: paintById, paintRecord: paintRecord,
    savePaint: savePaint, deletePaint: deletePaint,
    list: list, get: get, active: active, activeId: function(){ return activeId; }, setActive: setActive,
    activePaints: activePaints, create: create, savePalette: savePalette, deletePalette: deletePalette,
    load: load, save: save, exportData: exportData, importData: importData
  };
})();
