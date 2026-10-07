// Paint recipes: which of your paints, in what proportions, come closest to
// a target colour.
//
// Mixing is predicted with Mixbox (Secret Weapons, CC BY-NC 4.0; see
// mixbox.js), a pigment model based on Kubelka–Munk theory: paints mix like
// paint (blue + yellow = green) and strong tinters such as phthalo dominate.
// Each paint is described by its colour at full strength, or as a blend of
// Mixbox's measured pigments when that matches the tube's pigments better.
//
// The search tries every combination of up to four paints, optimises the
// proportions to minimise the colour difference (CIEDE2000), and prefers
// simpler mixes when they're nearly as close.
window.Mix = (function(){
  "use strict";

  // Mixbox's measured pigments (full-strength sRGB)
  var MB = {
    cadmiumYellow: [254, 236, 0], cadmiumOrange: [255, 105, 0], cadmiumRed: [255, 39, 2],
    quinacridoneMagenta: [128, 2, 46], phthaloBlue: [13, 27, 68], phthaloGreen: [0, 60, 50],
    burntSienna: [123, 72, 0]
  };

  // The palette: Winsor & Newton Artists' Oil Colour.
  // approx: the tube's pigment isn't in the model, so it's approximated
  // from similar pigments until it's calibrated from a swatch card.
  // strength: tinting strength relative to white. Mixbox's proportions are
  // perceptual (designed for digital painting: 10% phthalo in white still
  // looks pale), so they're converted to real tube amounts by dividing by
  // each paint's strength. These are typical values for the pigments,
  // to be replaced by calibration.
  var PALETTE = [
    { id: "white",   name: "Titanium White",      code: "644", pigments: "PW6, PW4", strength: 1,   mix: [[[255, 255, 255], 1]] },
    { id: "yellow",  name: "Cadmium Yellow Pale", code: "118", pigments: "PY35",     strength: 2.5, mix: [[MB.cadmiumYellow, 1]] },
    { id: "scarlet", name: "Cadmium Scarlet",     code: "106", pigments: "PR108",    strength: 4,   mix: [[MB.cadmiumRed, 0.65], [MB.cadmiumOrange, 0.35]] },
    { id: "alizarin",name: "Alizarin Crimson",    code: "004", pigments: "PR83",     strength: 4,   mix: [[MB.quinacridoneMagenta, 0.8], [MB.cadmiumRed, 0.12], [MB.burntSienna, 0.08]], approx: true },
    { id: "maroon",  name: "Transparent Maroon",  code: "657", pigments: "PBr25",    strength: 3,   mix: [[MB.burntSienna, 0.6], [MB.quinacridoneMagenta, 0.4]], approx: true },
    { id: "blue",    name: "Manganese Blue Hue",  code: "379", pigments: "PB15, PG7",strength: 12,  mix: [[MB.phthaloBlue, 0.6], [MB.phthaloGreen, 0.4]] },
    { id: "black",   name: "Ivory Black",         code: "331", pigments: "PBk9",     strength: 6,   mix: [[[24, 23, 22], 1]] }
  ];

  var N = 7;   // Mixbox latent size
  function latentOf(paint){
    if(paint.latent) return paint.latent;
    var z = new Array(N).fill(0);
    paint.mix.forEach(function(part){
      var l = mixbox.rgbToLatent(part[0][0], part[0][1], part[0][2]);
      for(var i=0;i<N;i++) z[i] += part[1]*l[i];
    });
    paint.latent = z;
    paint.css = "rgb(" + mixbox.latentToRgb(z).slice(0, 3).join(",") + ")";
    return z;
  }
  PALETTE.forEach(latentOf);

  // ---------------- colour difference ----------------
  function srgbToLin(c){ return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function f(t){ return t > 216/24389 ? Math.cbrt(t) : (24389/27*t + 16)/116; }
  function linToLab(r, g, b){
    var X = (0.4124564*r + 0.3575761*g + 0.1804375*b)/0.95047;
    var Y =  0.2126729*r + 0.7151522*g + 0.0721750*b;
    var Z = (0.0193339*r + 0.1191920*g + 0.9503041*b)/1.08883;
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
  }
  var RAD = Math.PI/180;
  function de2000(p, q){
    var L1 = p[0], a1 = p[1], b1 = p[2], L2 = q[0], a2 = q[1], b2 = q[2];
    var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb7 = Math.pow((C1 + C2)/2, 7);
    var G = 0.5*(1 - Math.sqrt(Cb7/(Cb7 + 6103515625)));
    var a1p = (1+G)*a1, a2p = (1+G)*a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    var h1p = (Math.atan2(b1, a1p)/RAD + 360) % 360, h2p = (Math.atan2(b2, a2p)/RAD + 360) % 360;
    var dLp = L2 - L1, dCp = C2p - C1p, dhp = 0;
    if(C1p*C2p !== 0){ dhp = h2p - h1p; if(dhp > 180) dhp -= 360; else if(dhp < -180) dhp += 360; }
    var dHp = 2*Math.sqrt(C1p*C2p)*Math.sin(dhp*RAD/2);
    var Lbp = (L1 + L2)/2, Cbp = (C1p + C2p)/2, hbp;
    if(C1p*C2p === 0) hbp = h1p + h2p;
    else { hbp = (h1p + h2p)/2; if(Math.abs(h1p - h2p) > 180) hbp += (h1p + h2p < 360) ? 180 : -180; }
    var T = 1 - 0.17*Math.cos((hbp - 30)*RAD) + 0.24*Math.cos(2*hbp*RAD) + 0.32*Math.cos((3*hbp + 6)*RAD) - 0.20*Math.cos((4*hbp - 63)*RAD);
    var dTh = 30*Math.exp(-Math.pow((hbp - 275)/25, 2)), Cbp7 = Math.pow(Cbp, 7);
    var Rc = 2*Math.sqrt(Cbp7/(Cbp7 + 6103515625));
    var Sl = 1 + 0.015*(Lbp - 50)*(Lbp - 50)/Math.sqrt(20 + (Lbp - 50)*(Lbp - 50)), Sc = 1 + 0.045*Cbp, Sh = 1 + 0.015*Cbp*T;
    var Rt = -Math.sin(2*dTh*RAD)*Rc;
    return Math.sqrt(Math.pow(dLp/Sl, 2) + Math.pow(dCp/Sc, 2) + Math.pow(dHp/Sh, 2) + Rt*(dCp/Sc)*(dHp/Sh));
  }

  // predicted colour of a mix (weights sum to 1) as Lab and sRGB 0..1
  var zMix = new Array(N);
  function mixColour(lats, w){
    for(var i=0;i<N;i++){ var s = 0; for(var j=0;j<lats.length;j++) s += w[j]*lats[j][i]; zMix[i] = s; }
    return mixbox.latentToFloatRgb(zMix);
  }
  function mixLab(lats, w){ var c = mixColour(lats, w); return linToLab(srgbToLin(c[0]), srgbToLin(c[1]), srgbToLin(c[2])); }

  // ---------------- proportions for one set of paints ----------------
  // Coarse grid over the proportions, then refine by moving small amounts
  // between pairs of paints while it keeps getting closer.
  function optimise(lats, target){
    var k = lats.length, best = null;
    function consider(w){ var d = de2000(target, mixLab(lats, w)); if(!best || d < best.d) best = { d: d, w: w.slice() }; }
    var step = k === 1 ? 1 : k === 2 ? 0.02 : k === 3 ? 0.05 : 0.1, units = Math.round(1/step);
    (function grid(i, left, w){
      if(i === k - 1){ w[i] = left*step; consider(w); return; }
      for(var u=0; u<=left; u++){ w[i] = u*step; grid(i+1, left - u, w); }
    })(0, units, new Array(k));
    if(k > 1){
      var w = best.w.slice(), d = best.d;
      for(var delta = step/2; delta > 0.0004; delta /= 2){
        var improved = true;
        while(improved){
          improved = false;
          for(var a=0;a<k;a++) for(var b=0;b<k;b++){
            if(a === b || w[a] < delta) continue;
            w[a] -= delta; w[b] += delta;
            var dd = de2000(target, mixLab(lats, w));
            if(dd < d - 1e-6){ d = dd; improved = true; } else { w[a] += delta; w[b] -= delta; }
          }
        }
      }
      best = { d: d, w: w };
    }
    return best;
  }

  // ---------------- recipes ----------------
  // targetLin: linear-light sRGB [r, g, b]. Returns the recommended recipe:
  // the fewest paints that get very close (ΔE under 2, hard to tell apart
  // at the easel), otherwise the best trade-off of closeness and simplicity.
  // Also returns the closest recipe overall if it's noticeably closer.
  var SIMPLER = 0.75;   // how much closeness (ΔE) one fewer paint is worth
  var VERY_CLOSE = 2;
  function recipe(targetLin){
    var target = linToLab(targetLin[0], targetLin[1], targetLin[2]);
    var results = [];
    (function subsets(start, chosen){
      if(chosen.length){
        var lats = chosen.map(function(i){ return PALETTE[i].latent; });
        var r = optimise(lats, target);
        // drop paints that ended up with (almost) nothing
        var parts = [];
        chosen.forEach(function(idx, j){ if(r.w[j] >= 0.004) parts.push({ paint: PALETTE[idx], w: r.w[j] }); });
        if(parts.length === chosen.length){
          var sum = parts.reduce(function(s, p){ return s + p.w; }, 0);
          parts.forEach(function(p){ p.w /= sum; });
          results.push({ parts: parts, de: r.d, score: r.d + SIMPLER*(parts.length - 1) });
        }
      }
      if(chosen.length === 4) return;
      for(var i=start;i<PALETTE.length;i++) subsets(i + 1, chosen.concat(i));
    })(0, []);
    var veryClose = results.filter(function(r){ return r.de < VERY_CLOSE; });
    var best;
    if(veryClose.length){
      var fewest = Math.min.apply(null, veryClose.map(function(r){ return r.parts.length; }));
      veryClose.filter(function(r){ return r.parts.length === fewest; }).forEach(function(r){ if(!best || r.de < best.de) best = r; });
    } else {
      results.forEach(function(r){ if(!best || r.score < best.score) best = r; });
    }
    var closest = null;
    results.forEach(function(r){ if(!closest || r.de < closest.de) closest = r; });
    if(closest === best || closest.de > best.de - 1) closest = null;
    return { target: target, best: finish(best), closer: closest && finish(closest) };
  }
  function finish(r){
    if(r.finished) return r;
    var lats = r.parts.map(function(p){ return p.paint.latent; }), w = r.parts.map(function(p){ return p.w; });
    var c = mixColour(lats, w);
    r.css = "rgb(" + c.map(function(v){ return Math.round(v*255); }).join(",") + ")";
    r.lin = c.map(srgbToLin);   // predicted colour, linear light (for the Munsell readout)
    r.approx = r.parts.some(function(p){ return p.paint.approx; });
    // real tube amounts: the model's proportion divided by tinting strength
    var sum = 0;
    r.parts.forEach(function(p){ p.vol = p.w/p.paint.strength; sum += p.vol; });
    r.parts.forEach(function(p){ p.vol /= sum; });
    r.parts.sort(function(a, b){ return b.vol - a.vol; });
    // parts in small whole numbers, relative to the smallest amount that's
    // at least 8% of the mix; less than that is "a little" or "a touch"
    var real = r.parts.filter(function(p){ return p.vol >= 0.08; });
    var base = real.length ? real[real.length - 1].vol : 1;
    r.parts.forEach(function(p){
      var n = Math.max(1, Math.round(p.vol/base));
      p.label = p.vol < 0.04 ? "a touch" : p.vol < 0.08 ? "a little" : n + (n === 1 ? " part" : " parts");
    });
    r.closeness = r.de < 2 ? "Very close" : r.de < 5 ? "Close" : r.de < 10 ? "Approximate" : "Nearest possible with your paints";
    r.finished = true;
    return r;
  }

  return { palette: PALETTE, recipe: recipe };
})();
