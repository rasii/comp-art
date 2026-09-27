// ---------------- Munsell conversion ----------------
// Colour readout for the compare view: exact Munsell value (ASTM D1535),
// nearest Munsell renotation chip for hue/chroma, and a plain-words
// comparison of two colours.
//
// Chip data: Munsell renotation "real" set (Newhall, Nickerson & Judd 1943),
// as distributed by the RIT Munsell Color Science Lab (real.dat), measured
// under Illuminant C. Packed as "HUE+VALUE:chroma,x*1e4,y*1e4,chroma,..."
// groups joined by "|". Y for each value is in MUNSELL_Y.
window.Munsell = (function(){
  "use strict";

  var MUNSELL_Y = [0, 1.210, 3.126, 6.555, 12.000, 19.770, 30.050, 43.060, 59.100, 78.660];
  var DATA = window.MUNSELL_DATA;

  // Illuminant C reference white (the renotation data's illuminant).
  var WC = [98.074, 100, 118.232];

  // sRGB (D65) linear → XYZ (D65), then Bradford-adapted D65 → C.
  var RGB2XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041]
  ];
  var BRAD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
  var BRAD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
  function mul(m, v){
    return [m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2], m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2], m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];
  }
  var ADAPT = (function(){
    var s = mul(BRAD, [95.047, 100, 108.883]), d = mul(BRAD, WC);
    var k = [d[0]/s[0], d[1]/s[1], d[2]/s[2]];
    var out = [[0,0,0],[0,0,0],[0,0,0]];
    for(var i=0;i<3;i++) for(var j=0;j<3;j++){
      var sum = 0;
      for(var n=0;n<3;n++) sum += BRAD_INV[i][n] * k[n] * BRAD[n][j];
      out[i][j] = sum;
    }
    return out;
  })();

  function f(t){ return t > 216/24389 ? Math.cbrt(t) : (24389/27*t + 16)/116; }
  function xyzToLab(X, Y, Z){
    var fx = f(X/WC[0]), fy = f(Y/WC[1]), fz = f(Z/WC[2]);
    var L = 116*fy - 16, a = 500*(fx-fy), b = 200*(fy-fz);
    var h = Math.atan2(b, a) * 180/Math.PI; if(h < 0) h += 360;
    return { L:L, a:a, b:b, C:Math.hypot(a, b), h:h };
  }

  // ASTM D1535 value function; inverted by bisection.
  function yFromValue(V){
    return V*(1.1914 + V*(-0.22533 + V*(0.23352 + V*(-0.020484 + V*0.00081939))));
  }
  function valueFromY(Y){
    var lo = 0, hi = 10;
    for(var i=0;i<40;i++){ var mid = (lo+hi)/2; if(yFromValue(mid) < Y) lo = mid; else hi = mid; }
    return (lo+hi)/2;
  }

  // Renotation Y is relative to smoked MgO; ×0.975 converts it to the
  // perfect-diffuser scale used by sRGB (and by the D1535 value function).
  var MGO = 0.975;

  // Parse the chips (plus neutral greys N1–N9) into Lab for nearest search.
  var CHIPS = (function(){
    var list = [];
    DATA.split("|").forEach(function(g){
      var parts = g.split(":"), m = parts[0].match(/^([\d.]+[A-Z]+)(\d)$/);
      var hue = m[1], V = Number(m[2]), Y = MUNSELL_Y[V]*MGO, nums = parts[1].split(",").map(Number);
      for(var i=0;i<nums.length;i+=3){
        var x = nums[i+1]/1e4, y = nums[i+2]/1e4;
        var lab = xyzToLab(x*Y/y, Y, (1-x-y)*Y/y);
        list.push({ name: hue + " " + V + "/" + nums[i], L:lab.L, a:lab.a, b:lab.b });
      }
    });
    for(var v=1; v<=9; v++){
      var Yn = MUNSELL_Y[v]*MGO;
      list.push({ name: "N " + v + "/", L: xyzToLab(WC[0]*Yn/100, Yn, WC[2]*Yn/100).L, a:0, b:0 });
    }
    return list;
  })();

  // rgbLin: linear-light sRGB components 0..1.
  function fromLinearRGB(r, g, b){
    var xyz = mul(ADAPT, mul(RGB2XYZ, [r*100, g*100, b*100]));
    var lab = xyzToLab(xyz[0], xyz[1], xyz[2]);
    var best = null, bestD = Infinity;
    for(var i=0;i<CHIPS.length;i++){
      var c = CHIPS[i], d = (c.L-lab.L)*(c.L-lab.L) + (c.a-lab.a)*(c.a-lab.a) + (c.b-lab.b)*(c.b-lab.b);
      if(d < bestD){ bestD = d; best = c; }
    }
    var value = valueFromY(xyz[1]);
    // notation: nearest chip's hue and chroma with the measured value, e.g. "7.5YR 5.8/8"
    var notation = best.name.replace(/ \d\//, " " + value.toFixed(1) + "/");
    return { value: value, chip: best.name, notation: notation, L:lab.L, C:lab.C, h:lab.h };
  }

  // ---- plain-words comparison: how `p` (painting) differs from `r` (reference) ----
  var HUE_WORDS = [ {w:"redder",a:25}, {w:"yellower",a:90}, {w:"greener",a:160}, {w:"bluer",a:250}, {w:"purpler",a:320} ];
  // Names the direction of a hue shift of dh degrees from fromHue: the
  // farthest hue landmark the shift (roughly) reaches, or for a small
  // shift, the nearest landmark it is heading toward.
  function hueWord(fromHue, dh){
    var reach = Math.abs(dh) + 30;
    var nearest = null, nearestD = Infinity, farthest = null, farthestD = -1;
    HUE_WORDS.forEach(function(hw){
      var d = dh > 0 ? (hw.a - fromHue + 360) % 360 : (fromHue - hw.a + 360) % 360;
      if(d <= 2) return;
      if(d < nearestD){ nearestD = d; nearest = hw.w; }
      if(d <= reach && d > farthestD){ farthestD = d; farthest = hw.w; }
    });
    return farthest || nearest;
  }
  function amount(x){
    var halves = Math.round(Math.abs(x)*2), whole = Math.floor(halves/2), half = halves % 2;
    var s = (whole ? String(whole) : "") + (half ? "½" : "");
    return s + (halves <= 2 ? " value" : " values");
  }
  // Painter's temperature: warmest around orange (Lab hue ~60°), coolest
  // opposite it around blue. A cosine gives a smooth warmth score −1..1.
  function warmth(h){ return Math.cos((h - 60) * Math.PI/180); }

  function describe(r, p){
    var parts = [];
    var dv = p.value - r.value;
    if(Math.abs(dv) >= 0.25) parts.push(amount(dv) + (dv > 0 ? " lighter" : " darker"));
    var dC = p.C - r.C;
    if(Math.abs(dC) >= 4) parts.push((Math.abs(dC) < 8 ? "slightly " : "") + (dC > 0 ? "more saturated" : "less saturated"));
    if(Math.min(p.C, r.C) >= 8){
      var dh = ((p.h - r.h + 540) % 360) - 180;
      if(Math.abs(dh) >= 5){
        var w = hueWord(r.h, dh);
        var dT = warmth(p.h) - warmth(r.h);
        var temp = Math.abs(dT) >= 0.12 ? (dT > 0 ? "warmer" : "cooler") : null;
        var slight = Math.abs(dh) < 12 ? "slightly " : "";
        if(temp && w) parts.push(slight + temp + " (" + w + ")");
        else if(temp || w) parts.push(slight + (temp || w));
      }
    }
    if(!parts.length) return "Close match.";
    var last = parts.pop();
    return "Painting is " + (parts.length ? parts.join(", ") + " and " + last : last) + ".";
  }

  return { fromLinearRGB: fromLinearRGB, describe: describe };
})();
