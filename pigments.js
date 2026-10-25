// Pigment table: what the mixing model needs to know about the pigments
// artists' paints are made from, by Colour Index code (the "PB29", "PY35"
// printed on every tube). Used to add your own paints by their pigments.
//
// Each pigment has a name, its colour at full strength for the mixing
// model, and its tinting strength relative to titanium white (how much it
// colours a mix: phthalos are very strong, earths and cobalts weak).
// The model: one of Mixbox's 13 measured pigments where it matches,
// otherwise the pigment's masstone colour (sRGB 0..255), or a blend of
// those. Strengths and colours are typical values: a good starting point,
// not a measurement of any one brand's tube.
//
// Some codes cover several different paints (PBr7 is raw and burnt sienna
// and umber): those have variants, guessed from the paint's name and
// selectable when it's added.
window.Pigments = (function(){
  "use strict";

  // Mixbox's measured pigments (see mixbox.js)
  var MB = {
    cadmiumYellow: [254, 236, 0], hansaYellow: [252, 211, 0], cadmiumOrange: [255, 105, 0],
    cadmiumRed: [255, 39, 2], quinacridoneMagenta: [128, 2, 46], cobaltViolet: [78, 0, 66],
    ultramarineBlue: [25, 0, 89], cobaltBlue: [0, 33, 133], phthaloBlue: [13, 27, 68],
    phthaloGreen: [0, 60, 50], permanentGreen: [7, 109, 22], sapGreen: [107, 148, 4],
    burntSienna: [123, 72, 0]
  };
  function one(rgb){ return [[rgb, 1]]; }

  // code: [name, mix, strength]; or for codes covering several paints,
  // { variants: [[name, mix, strength, name keywords], ...] } (first is the default)
  var T = {
    // whites
    PW6:  ["Titanium white", one([255, 255, 255]), 1],
    PW4:  ["Zinc white", one([248, 249, 250]), 0.5],
    PW1:  ["Lead (flake) white", one([250, 247, 238]), 0.6],
    PW5:  ["Lithopone white", one([250, 250, 248]), 0.6],
    // blacks
    PBk9:  ["Ivory (bone) black", one([24, 23, 22]), 6],
    PBk11: ["Mars black", one([22, 22, 22]), 7],
    PBk6:  ["Lamp black", one([18, 18, 19]), 8],
    PBk7:  ["Carbon black", one([16, 16, 17]), 8],
    PBk31: ["Perylene black", one([20, 26, 22]), 7],
    PBk19: ["Graphite grey", one([70, 70, 72]), 2],
    // yellows
    PY35:  ["Cadmium yellow", one(MB.cadmiumYellow), 2.5],
    PY37:  ["Cadmium yellow", one(MB.cadmiumYellow), 2.5],
    PY3:   ["Hansa yellow light", one(MB.hansaYellow), 1.8],
    PY74:  ["Hansa yellow", one(MB.hansaYellow), 2],
    PY97:  ["Hansa yellow", one(MB.hansaYellow), 2],
    PY73:  ["Hansa yellow", one(MB.hansaYellow), 2],
    PY1:   ["Hansa yellow", one(MB.hansaYellow), 1.8],
    PY154: ["Benzimidazolone yellow", one(MB.hansaYellow), 2],
    PY175: ["Benzimidazolone lemon", one([250, 228, 40]), 2],
    PY151: ["Benzimidazolone yellow", one([245, 200, 0]), 2],
    PY65:  ["Hansa yellow deep", one([235, 170, 10]), 2],
    PY83:  ["Diarylide yellow (transparent deep)", one([215, 140, 0]), 3],
    PY110: ["Isoindolinone yellow", one([240, 140, 0]), 3],
    PY128: ["Azo condensation yellow", one([245, 215, 40]), 2],
    PY129: ["Green gold", one([150, 140, 20]), 2.5],
    PY138: ["Quinophthalone yellow", one([250, 215, 10]), 2],
    PY139: ["Isoindoline yellow", one([240, 160, 0]), 2.5],
    PY150: ["Nickel azo yellow", one([200, 140, 20]), 2.5],
    PY153: ["Nickel dioxine yellow", one([220, 150, 30]), 2.5],
    PY184: ["Bismuth vanadate yellow", one([250, 215, 0]), 2.5],
    PY40:  ["Aureolin (cobalt yellow)", one([230, 190, 20]), 1.5],
    PY53:  ["Nickel titanate yellow", one([240, 230, 140]), 1],
    PY216: ["Tin titanium yellow", one([240, 200, 60]), 1.5],
    PY42:  { variants: [
      ["Yellow ochre (mars yellow)", one([195, 140, 50]), 1.8, "ochre mars"],
      ["Transparent yellow oxide", one([175, 110, 30]), 1.8, "transparent oxide"] ] },
    PY43:  ["Yellow ochre (natural)", one([200, 148, 60]), 1.5],
    PBr24: ["Chrome titanate (Naples yellow)", one([220, 170, 90]), 1.2],
    // oranges
    PO20:  ["Cadmium orange", one(MB.cadmiumOrange), 3.5],
    PO73:  ["Pyrrole orange", one([250, 90, 10]), 3.5],
    PO71:  ["Pyrrole orange (transparent)", one([225, 70, 20]), 3.5],
    PO36:  ["Benzimidazolone orange", one([240, 90, 20]), 3],
    PO43:  ["Perinone orange", one([235, 80, 15]), 3.5],
    PO62:  ["Benzimidazolone orange", one([245, 120, 0]), 3],
    PO48:  ["Quinacridone burnt orange", one([150, 50, 20]), 3],
    PO49:  ["Quinacridone gold", one([180, 110, 10]), 3],
    // reds
    PR108: ["Cadmium red", one(MB.cadmiumRed), 4],
    PR254: ["Pyrrole red", one([225, 30, 20]), 4],
    PR255: ["Pyrrole scarlet", one([235, 60, 30]), 4],
    PR264: ["Pyrrole rubine", one([190, 20, 40]), 4],
    PR209: ["Quinacridone red", one([200, 20, 50]), 4],
    PR206: ["Quinacridone burnt scarlet", one([130, 30, 30]), 3],
    PR122: ["Quinacridone magenta", one(MB.quinacridoneMagenta), 4],
    PR202: ["Quinacridone magenta", one(MB.quinacridoneMagenta), 4],
    PV19:  ["Quinacridone rose / violet", [[MB.quinacridoneMagenta, 0.75], [MB.cadmiumRed, 0.25]], 4],
    PR83:  ["Alizarin crimson", [[MB.quinacridoneMagenta, 0.8], [MB.cadmiumRed, 0.12], [MB.burntSienna, 0.08]], 4],
    PR177: ["Anthraquinone red", one([150, 20, 40]), 4],
    PR179: ["Perylene maroon", one([100, 20, 25]), 4],
    PR149: ["Perylene red", one([205, 30, 30]), 4],
    PR168: ["Brominated anthanthrone (scarlet)", one([215, 60, 20]), 3.5],
    PR170: ["Naphthol red", one([210, 30, 35]), 3.5],
    PR112: ["Naphthol red", one([215, 30, 30]), 3.5],
    PR188: ["Naphthol scarlet", one([225, 50, 30]), 3.5],
    PR101: { variants: [
      ["Red oxide (mars red)", one([150, 60, 45]), 3, "oxide mars"],
      ["Light red / Venetian red", one([165, 70, 50]), 2.5, "light venetian english"],
      ["Indian red", one([125, 50, 45]), 3, "indian caput"],
      ["Transparent red oxide", one([150, 55, 25]), 2.5, "transparent"] ] },
    PR102: ["Light red (natural)", one([170, 70, 45]), 2.5],
    // violets
    PV23:  ["Dioxazine violet", one([45, 15, 70]), 8],
    PV14:  ["Cobalt violet", one(MB.cobaltViolet), 1.5],
    PV15:  ["Ultramarine violet", one([70, 40, 110]), 1.5],
    PV16:  ["Manganese violet", one([100, 40, 110]), 1.5],
    PV29:  ["Perylene violet", one([60, 25, 35]), 4],
    PV37:  ["Dioxazine purple", one([60, 20, 70]), 6],
    // blues
    PB29:  ["Ultramarine blue", one(MB.ultramarineBlue), 3],
    PB28:  ["Cobalt blue", one(MB.cobaltBlue), 1.5],
    PB72:  ["Cobalt blue deep", one(MB.cobaltBlue), 1.5],
    PB15:  ["Phthalo blue", one(MB.phthaloBlue), 12],
    PB16:  ["Phthalo turquoise", one([0, 90, 140]), 6],
    PB17:  ["Phthalo blue", one(MB.phthaloBlue), 10],
    PB27:  ["Prussian blue", one([15, 25, 50]), 8],
    PB35:  ["Cerulean blue", one([40, 120, 170]), 1.5],
    PB36:  ["Cerulean blue (chromium)", one([30, 120, 160]), 1.5],
    PB33:  ["Manganese blue", one([40, 140, 170]), 1.5],
    PB60:  ["Indanthrone blue", one([25, 25, 80]), 6],
    PB74:  ["Cobalt zinc blue", one([30, 70, 150]), 1.5],
    // greens
    PG7:   ["Phthalo green", one(MB.phthaloGreen), 10],
    PG36:  ["Phthalo green (yellow shade)", one([0, 100, 70]), 9],
    PG18:  ["Viridian", one([0, 110, 90]), 2],
    PG17:  ["Chromium oxide green", one([90, 120, 70]), 2],
    PG19:  ["Cobalt green", one([80, 150, 110]), 1],
    PG26:  ["Cobalt green deep", one([30, 90, 70]), 1.2],
    PG50:  ["Cobalt titanate green", one([70, 150, 120]), 1],
    PG23:  ["Green earth (terre verte)", one([110, 120, 80]), 0.8],
    PG8:   ["Hooker's green (nitroso)", one([60, 80, 30]), 3],
    PG10:  ["Green gold (azo)", one([120, 130, 30]), 2.5],
    // browns
    PBr7:  { variants: [
      ["Burnt sienna", one(MB.burntSienna), 2.5, "burnt sienna"],
      ["Raw sienna", one([175, 110, 45]), 1.5, "raw sienna"],
      ["Burnt umber", one([80, 50, 35]), 3, "burnt umber"],
      ["Raw umber", one([95, 80, 60]), 2.5, "raw umber"] ] },
    PBr6:  ["Mars brown", one([110, 60, 40]), 3],
    PBr25: ["Transparent maroon / brown", [[MB.burntSienna, 0.6], [MB.quinacridoneMagenta, 0.4]], 3],
    PBr33: ["Zinc iron chromite brown", one([90, 60, 45]), 3],
    PBr23: ["Disazo brown", one([110, 50, 30]), 3],
    PBr41: ["Disazo brown", one([110, 55, 30]), 3]
  };

  // Codes in free text: "PB29", "PB 29", "P.B.29", "PB15:3", "PBr7",
  // "PBk 9", separated by anything. Returns [{code, base}] in order, no
  // repeats (base drops the ":n" suffix).
  function parse(text){
    var out = [], seen = {};
    var s = String(text || "").replace(/\./g, "");
    var re = /\bP\s*(BK|BR|W|Y|O|R|V|B|G)\s*(\d{1,3})(?:\s*:\s*(\d+))?/gi, m;
    while((m = re.exec(s))){
      var prefix = m[1].toUpperCase();
      prefix = prefix === "BK" ? "Bk" : prefix === "BR" ? "Br" : prefix;
      var base = "P" + prefix + Number(m[2]);
      var code = base + (m[3] ? ":" + Number(m[3]) : "");
      if(seen[base]) continue;
      seen[base] = 1;
      out.push({ code: code, base: base });
    }
    return out;
  }

  function entry(base){ return T[base] || null; }
  function known(base){ return !!T[base]; }
  // the variant names for a code with several, or null
  function variantsOf(base){
    var e = T[base];
    return e && e.variants ? e.variants.map(function(v){ return v[0]; }) : null;
  }
  // the variant a paint's name points to (e.g. "Raw umber" → raw umber)
  function guessVariant(base, paintName){
    var e = T[base];
    if(!e || !e.variants) return null;
    var name = String(paintName || "").toLowerCase(), best = e.variants[0][0], bestHits = 0;
    e.variants.forEach(function(v){
      var words = v[3].split(" "), hits = 0;
      words.forEach(function(w){ if(name.indexOf(w) >= 0) hits++; });
      if(hits === words.length && hits > bestHits){ bestHits = hits; best = v[0]; }
    });
    if(!bestHits){
      e.variants.forEach(function(v){
        if(bestHits) return;
        if(v[3].split(" ").some(function(w){ return name.indexOf(w) >= 0; })){ best = v[0]; bestHits = 1; }
      });
    }
    return best;
  }
  // {name, mix, strength} for a code (and variant name, if it has several)
  function lookup(base, variant){
    var e = T[base];
    if(!e) return null;
    if(!e.variants) return { name: e[0], mix: e[1], strength: e[2] };
    var v = e.variants[0];
    e.variants.forEach(function(x){ if(x[0] === variant) v = x; });
    return { name: v[0], mix: v[1], strength: v[2] };
  }
  function count(){ return Object.keys(T).length; }

  return { parse: parse, known: known, entry: entry, variantsOf: variantsOf, guessVariant: guessVariant, lookup: lookup, count: count };
})();
