// Big-shape analysis of a photo: groups it into a chosen number of large
// areas of similar value (and, in colour mode, colour), the way a painter
// blocks in a subject before any detail.
//
//   1. Lab colour, smoothed with a Kuwahara filter (removes fur/grass
//      texture but keeps edges)
//   2. k-means into fine colour/value groups, split into connected areas
//   3. areas merged step by step, most similar first (Ward cost, weighted
//      toward value; specks and blurry areas merge sooner). The full merge
//      order is recorded once, so any number of shapes is a quick replay.
//   4. per result: boundary clean-up, optional "background as one shape"
//      (everything out of focus), average colours, and outlines simplified
//      to straight segments
//
// Plain functions on RGBA buffers: runs in shapes-worker.js or the page.
(function(root){
  "use strict";

  // ---------------- colour ----------------
  var LIN = new Float32Array(256);
  for(var i=0;i<256;i++){ var c = i/255; LIN[i] = c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function f(t){ return t > 216/24389 ? Math.cbrt(t) : (24389/27*t + 16)/116; }

  function toLab(rgba, w, h){
    var n = w*h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    var lr = new Float32Array(n), lg = new Float32Array(n), lb = new Float32Array(n);
    for(var p=0;p<n;p++){
      var r = LIN[rgba[p*4]], g = LIN[rgba[p*4+1]], b = LIN[rgba[p*4+2]];
      lr[p] = r; lg[p] = g; lb[p] = b;
      var X = (0.4124564*r + 0.3575761*g + 0.1804375*b)/0.95047;
      var Y = 0.2126729*r + 0.7151522*g + 0.0721750*b;
      var Z = (0.0193339*r + 0.1191920*g + 0.9503041*b)/1.08883;
      var fx = f(X), fy = f(Y), fz = f(Z);
      L[p] = 116*fy - 16; A[p] = 500*(fx - fy); B[p] = 200*(fy - fz);
    }
    return { w: w, h: h, L: L, A: A, B: B, lr: lr, lg: lg, lb: lb };
  }

  // ---------------- smoothing: Kuwahara ----------------
  // Each pixel takes the mean of whichever of its four surrounding quadrants
  // varies least in lightness: texture is flattened, edges stay sharp.
  function kuwahara(im, r){
    var w = im.w, h = im.h, W1 = w + 1;
    var iL = new Float64Array(W1*(h+1)), iL2 = new Float64Array(W1*(h+1)), iA = new Float64Array(W1*(h+1)), iB = new Float64Array(W1*(h+1));
    for(var y=0;y<h;y++){
      var sL=0, sL2=0, sA=0, sB=0;
      for(var x=0;x<w;x++){
        var p = y*w + x;
        sL += im.L[p]; sL2 += im.L[p]*im.L[p]; sA += im.A[p]; sB += im.B[p];
        var q = (y+1)*W1 + x + 1, u = y*W1 + x + 1;
        iL[q] = iL[u] + sL; iL2[q] = iL2[u] + sL2; iA[q] = iA[u] + sA; iB[q] = iB[u] + sB;
      }
    }
    function box(a, x0, y0, x1, y1){ return a[(y1+1)*W1 + x1 + 1] - a[y0*W1 + x1 + 1] - a[(y1+1)*W1 + x0] + a[y0*W1 + x0]; }
    var oL = new Float32Array(w*h), oA = new Float32Array(w*h), oB = new Float32Array(w*h);
    var QX = [-1, 0, -1, 0], QY = [-1, -1, 0, 0];
    for(y=0;y<h;y++) for(x=0;x<w;x++){
      var best = Infinity, bL = 0, bA = 0, bB = 0;
      for(var k=0;k<4;k++){
        var x0 = Math.max(0, x + QX[k]*r), x1 = Math.min(w-1, x + (QX[k]+1)*r);
        var y0 = Math.max(0, y + QY[k]*r), y1 = Math.min(h-1, y + (QY[k]+1)*r);
        var nn = (x1-x0+1)*(y1-y0+1), m = box(iL, x0, y0, x1, y1)/nn, v = box(iL2, x0, y0, x1, y1)/nn - m*m;
        if(v < best){ best = v; bL = m; bA = box(iA, x0, y0, x1, y1)/nn; bB = box(iB, x0, y0, x1, y1)/nn; }
      }
      p = y*w + x; oL[p] = bL; oA[p] = bA; oB[p] = bB;
    }
    return { L: oL, A: oA, B: oB };
  }

  // ---------------- sharpness (how in-focus each area is) ----------------
  function sharpness(im, r){
    var w = im.w, h = im.h, L = im.L, g = new Float32Array(w*h), W1 = w + 1;
    for(var y=1;y<h-1;y++) for(var x=1;x<w-1;x++){ var p = y*w + x; g[p] = Math.hypot(L[p+1] - L[p-1], L[p+w] - L[p-w]); }
    var I = new Float64Array(W1*(h+1));
    for(y=0;y<h;y++){ var s = 0; for(x=0;x<w;x++){ s += g[y*w + x]; I[(y+1)*W1 + x + 1] = I[y*W1 + x + 1] + s; } }
    var out = new Float32Array(w*h), max = 0;
    for(y=0;y<h;y++) for(x=0;x<w;x++){
      var x0 = Math.max(0, x-r), x1 = Math.min(w-1, x+r), y0 = Math.max(0, y-r), y1 = Math.min(h-1, y+r);
      var v = (I[(y1+1)*W1 + x1 + 1] - I[y0*W1 + x1 + 1] - I[(y1+1)*W1 + x0] + I[y0*W1 + x0])/((x1-x0+1)*(y1-y0+1));
      out[y*w + x] = v; if(v > max) max = v;
    }
    if(max > 0) for(var i=0;i<w*h;i++) out[i] /= max;
    return out;
  }

  // ---------------- k-means (cw = weight of colour vs value) ----------------
  function kmeans(sm, n, k, cw){
    var order = new Uint32Array(n); for(var i=0;i<n;i++) order[i] = i;
    var Ls = sm.L;
    order.sort(function(a, b){ return Ls[a] - Ls[b]; });
    var C = [];
    for(var j=0;j<k;j++){ var q = order[Math.floor((j+0.5)/k*n)]; C.push([sm.L[q], sm.A[q]*cw, sm.B[q]*cw]); }
    var lbl = new Uint8Array(n);
    for(var it=0; it<12; it++){
      var S = []; for(j=0;j<k;j++) S.push([0,0,0,0]);
      for(i=0;i<n;i++){
        var l = sm.L[i], a = sm.A[i]*cw, b = sm.B[i]*cw, bd = Infinity, bj = 0;
        for(j=0;j<k;j++){ var c = C[j], d = (l-c[0])*(l-c[0]) + (a-c[1])*(a-c[1]) + (b-c[2])*(b-c[2]); if(d < bd){ bd = d; bj = j; } }
        lbl[i] = bj; var s = S[bj]; s[0] += l; s[1] += a; s[2] += b; s[3]++;
      }
      for(j=0;j<k;j++) if(S[j][3]) C[j] = [S[j][0]/S[j][3], S[j][1]/S[j][3], S[j][2]/S[j][3]];
    }
    return lbl;
  }

  // ---------------- a small binary heap ----------------
  function Heap(){ this.a = []; }
  Heap.prototype.push = function(e){
    var a = this.a; a.push(e); var i = a.length - 1;
    while(i > 0){ var pi = (i-1) >> 1; if(a[pi].c <= e.c) break; a[i] = a[pi]; i = pi; }
    a[i] = e;
  };
  Heap.prototype.pop = function(){
    var a = this.a, top = a[0], last = a.pop();
    if(a.length){
      var i = 0, n = a.length;
      while(true){
        var l = 2*i + 1, r = l + 1, m = -1, mc = last.c;
        if(l < n && a[l].c < mc){ m = l; mc = a[l].c; }
        if(r < n && a[r].c < mc){ m = r; }
        if(m < 0) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  };

  // ---------------- the merge order ----------------
  // Connected areas of the k-means groups, then repeatedly the cheapest
  // adjacent pair is merged and recorded, down to two areas.
  function buildHierarchy(im, sm, sharp, values){
    var w = im.w, h = im.h, n = w*h;
    var cw = values ? 0 : 0.6;                   // colour counts, but value counts more
    var lbl = kmeans(sm, n, 16, cw);
    var comp = new Int32Array(n).fill(-1), R = [], stack = new Int32Array(n);
    for(var s=0;s<n;s++){
      if(comp[s] >= 0) continue;
      var id = R.length, sp = 0; stack[sp++] = s; comp[s] = id;
      var r = { size: 0, sL: 0, sA: 0, sB: 0, sS: 0, adj: new Map(), alive: true, ver: 0 };
      while(sp){
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        r.size++; r.sL += sm.L[p]; r.sA += sm.A[p]; r.sB += sm.B[p]; r.sS += sharp[p];
        if(x > 0 && comp[p-1] < 0 && lbl[p-1] === lbl[s]){ comp[p-1] = id; stack[sp++] = p-1; }
        if(x < w-1 && comp[p+1] < 0 && lbl[p+1] === lbl[s]){ comp[p+1] = id; stack[sp++] = p+1; }
        if(y > 0 && comp[p-w] < 0 && lbl[p-w] === lbl[s]){ comp[p-w] = id; stack[sp++] = p-w; }
        if(y < h-1 && comp[p+w] < 0 && lbl[p+w] === lbl[s]){ comp[p+w] = id; stack[sp++] = p+w; }
      }
      R.push(r);
    }
    for(p=0;p<n;p++){
      x = p % w;
      if(x < w-1){ var a = comp[p], b = comp[p+1]; if(a !== b){ R[a].adj.set(b, 1); R[b].adj.set(a, 1); } }
      if(p + w < n){ a = comp[p]; b = comp[p+w]; if(a !== b){ R[a].adj.set(b, 1); R[b].adj.set(a, 1); } }
    }
    var tiny = 0.0015*n;
    function cost(i, j){
      var A = R[i], Bq = R[j];
      var dL = A.sL/A.size - Bq.sL/Bq.size, dA = (A.sA/A.size - Bq.sA/Bq.size)*cw, dB = (A.sB/A.size - Bq.sB/Bq.size)*cw;
      var c = (dL*dL + dA*dA + dB*dB)*A.size*Bq.size/(A.size + Bq.size);
      var sh = Math.max(A.sS/A.size, Bq.sS/Bq.size);
      c *= Math.pow(Math.min(1, sh/0.35), 2);      // blurry areas merge sooner
      if(A.size < tiny || Bq.size < tiny) c *= 0.05; // specks first
      return c;
    }
    var heap = new Heap();
    for(i=0;i<R.length;i++) R[i].adj.forEach(function(_, j){ if(j > i) heap.push({ c: cost(i, j), a: i, b: j, va: 0, vb: 0 }); });
    var merges = [], alive = R.length;
    while(alive > 2 && heap.a.length){
      var e = heap.pop(), A = R[e.a], Bq = R[e.b];
      if(!A.alive || !Bq.alive || A.ver !== e.va || Bq.ver !== e.vb) continue;
      // merge b into a
      A.size += Bq.size; A.sL += Bq.sL; A.sA += Bq.sA; A.sB += Bq.sB; A.sS += Bq.sS;
      Bq.alive = false; A.ver++;
      Bq.adj.forEach(function(_, q){ if(q !== e.a){ A.adj.set(q, 1); R[q].adj.delete(e.b); R[q].adj.set(e.a, 1); } });
      A.adj.delete(e.b);
      merges.push(e.a, e.b); alive--;
      A.adj.forEach(function(_, q){ if(R[q].alive) heap.push({ c: cost(e.a, q), a: e.a, b: q, va: A.ver, vb: R[q].ver }); });
    }
    return { comp: comp, initial: R.length, merges: merges };
  }

  // ---------------- per-result helpers ----------------
  // Majority filter on the region map (window 2r+1): each pixel joins the
  // shape most of its neighbours belong to, which tidies ragged boundaries
  // (fur, grass) into clean ones.
  function majority(w, h, lab, r){
    var out = new Int32Array(w*h), ids = new Int32Array((2*r+1)*(2*r+1)), cnts = new Int32Array(ids.length);
    for(var y=0;y<h;y++) for(var x=0;x<w;x++){
      var n = 0;
      for(var dy=-r;dy<=r;dy++){ var yy = y+dy; if(yy < 0 || yy >= h) continue;
        for(var dx=-r;dx<=r;dx++){ var xx = x+dx; if(xx < 0 || xx >= w) continue;
          var v = lab[yy*w + xx], j = 0;
          while(j < n && ids[j] !== v) j++;
          if(j === n){ ids[n] = v; cnts[n] = 0; n++; }
          cnts[j]++;
        } }
      var c0 = lab[y*w + x], best = c0, bc = 0;
      for(var i=0;i<n;i++) if(cnts[i] > bc || (cnts[i] === bc && ids[i] === c0)){ bc = cnts[i]; best = ids[i]; }
      out[y*w + x] = best;
    }
    return out;
  }

  // Outline of one connected piece of a region (Moore neighbour tracing),
  // starting from its top-left pixel.
  var DX = [1,1,0,-1,-1,-1,0,1], DY = [0,1,1,1,0,-1,-1,-1];
  function trace(lab, w, h, id, sx, sy){
    var x = sx, y = sy, dir = 0, pts = [x, y];
    for(var guard=0; guard<400000; guard++){
      var moved = false, d0 = (dir + 6) % 8;
      for(var i=0;i<8;i++){
        var nd = (d0 + i) % 8, nx = x + DX[nd], ny = y + DY[nd];
        if(nx >= 0 && ny >= 0 && nx < w && ny < h && lab[ny*w + nx] === id){ x = nx; y = ny; dir = nd; moved = true; break; }
      }
      if(!moved || (x === sx && y === sy)) break;
      pts.push(x, y);
    }
    return pts;
  }
  // Douglas–Peucker: straight segments within eps pixels of the outline.
  function simplify(pts, eps){
    var n = pts.length/2;
    if(n < 4) return pts;
    var keep = new Uint8Array(n); keep[0] = keep[n-1] = 1;
    var st = [0, n-1];
    while(st.length){
      var b = st.pop(), a = st.pop(), ax = pts[a*2], ay = pts[a*2+1], bx = pts[b*2], by = pts[b*2+1];
      var L = Math.hypot(bx-ax, by-ay) || 1, md = 0, mi = -1;
      for(var i=a+1;i<b;i++){
        var d = Math.abs((bx-ax)*(ay-pts[i*2+1]) - (ax-pts[i*2])*(by-ay))/L;
        if(d > md){ md = d; mi = i; }
      }
      if(md > eps){ keep[mi] = 1; st.push(a, mi, mi, b); }
    }
    var out = [];
    for(i=0;i<n;i++) if(keep[i]) out.push(pts[i*2], pts[i*2+1]);
    return out;
  }

  // ---------------- the analyser ----------------
  // smoothing: strength of the texture-flattening step (default 2.5, tuned
  // against an artist's own shape breakdown of an elk photo: strong enough
  // that fur patches join into the head's big planes)
  function Analyzer(rgba, w, h, smoothing){
    this.im = toLab(rgba, w, h);
    this.sm = kuwahara(this.im, Math.max(2, Math.round(Math.max(w, h)/160*(smoothing || 2.5))));
    this.sharp = sharpness(this.im, Math.max(3, Math.round(Math.max(w, h)/100)));
    this.hier = {};
  }
  // values: group by value only. count: number of shapes. bgOne: merge
  // everything out of focus into one background shape. opts (optional):
  // smooth = majority passes, straight = outline simplification factor.
  Analyzer.prototype.compute = function(values, count, bgOne, opts){
    opts = opts || {};
    var im = this.im, w = im.w, h = im.h, n = w*h, key = values ? "v" : "c";
    var H = this.hier[key] || (this.hier[key] = buildHierarchy(im, this.sm, this.sharp, values));
    // replay merges down to `count` areas
    var parent = new Int32Array(H.initial);
    for(var i=0;i<H.initial;i++) parent[i] = i;
    function find(i){ while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    var steps = Math.max(0, Math.min(H.merges.length/2, H.initial - count));
    for(i=0;i<steps;i++) parent[H.merges[i*2+1]] = H.merges[i*2];
    var lab = new Int32Array(n);
    for(var p=0;p<n;p++) lab[p] = find(H.comp[p]);
    var mr = Math.max(1, Math.round(Math.max(w, h)/320)), passes = opts.smooth || 3;
    for(var pass=0; pass<passes; pass++) lab = majority(w, h, lab, mr);

    // Background as one shape: the largest out-of-focus area, joined by the
    // other out-of-focus areas that are close to it in value. (A blurry
    // backdrop of dark foliage and a slightly lighter trunk becomes one
    // shape; a smooth bright sky and a darker sea stay separate.)
    if(bgOne){
      var sum = new Map(), sumL = new Map(), cnt = new Map();
      for(p=0;p<n;p++){
        var r = lab[p];
        sum.set(r, (sum.get(r) || 0) + this.sharp[p]); sumL.set(r, (sumL.get(r) || 0) + im.L[p]); cnt.set(r, (cnt.get(r) || 0) + 1);
      }
      var blurry = [];
      cnt.forEach(function(c, r){ if(sum.get(r)/c < 0.18 && c > 0.01*n) blurry.push({ r: r, size: c, L: sumL.get(r)/c }); });
      if(blurry.length > 1){
        blurry.sort(function(a, b){ return b.size - a.size; });
        var anchor = blurry[0], isBg = new Set();
        blurry.forEach(function(b){ if(Math.abs(b.L - anchor.L) <= 28) isBg.add(b.r); });
        if(isBg.size > 1) for(p=0;p<n;p++) if(isBg.has(lab[p])) lab[p] = anchor.r;
      }
    }

    // compact ids and average colours (from the original photo, linear RGB)
    var ids = new Map(), out = new Uint16Array(n), stats = [];
    for(p=0;p<n;p++){
      var k = ids.get(lab[p]);
      if(k === undefined){ k = stats.length; ids.set(lab[p], k); stats.push([0, 0, 0, 0]); }
      out[p] = k; var s = stats[k]; s[0] += im.lr[p]; s[1] += im.lg[p]; s[2] += im.lb[p]; s[3]++;
    }
    var colors = new Float32Array(stats.length*3), sizes = new Uint32Array(stats.length);
    stats.forEach(function(s, k){ colors[k*3] = s[0]/s[3]; colors[k*3+1] = s[1]/s[3]; colors[k*3+2] = s[2]/s[3]; sizes[k] = s[3]; });

    // outlines: every connected piece of every shape, straightened
    var eps = Math.max(1.5, Math.max(w, h)/260*(opts.straight || 2)), seen = new Uint8Array(n), polys = [], st = new Int32Array(n);
    for(p=0;p<n;p++){
      if(seen[p]) continue;
      var id = out[p], sp = 0, size = 0; st[sp++] = p; seen[p] = 1;
      while(sp){
        var q = st[--sp], x = q % w, y = (q / w) | 0; size++;
        if(x > 0 && !seen[q-1] && out[q-1] === id){ seen[q-1] = 1; st[sp++] = q-1; }
        if(x < w-1 && !seen[q+1] && out[q+1] === id){ seen[q+1] = 1; st[sp++] = q+1; }
        if(y > 0 && !seen[q-w] && out[q-w] === id){ seen[q-w] = 1; st[sp++] = q-w; }
        if(y < h-1 && !seen[q+w] && out[q+w] === id){ seen[q+w] = 1; st[sp++] = q+w; }
      }
      if(size < 12) continue;
      var pts = simplify(trace(out, w, h, id, p % w, (p / w) | 0), eps);
      if(pts.length >= 6) polys.push({ id: id, pts: new Float32Array(pts) });
    }
    return { w: w, h: h, labels: out, colors: colors, sizes: sizes, count: stats.length, polys: polys };
  };

  // ---------------- colour intensity (OKLab chroma scaling) ----------------
  // Scales a colour's chroma while keeping its lightness and hue; if the
  // result leaves the screen's range it goes as far as it can instead.
  function linToOklab(r, g, b){
    var l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    var m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    var s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
  }
  function oklabToLin(L, a, b){
    var l = L + 0.3963377774*a + 0.2158037573*b, m = L - 0.1055613458*a - 0.0638541728*b, s = L - 0.0894841775*a - 1.2914855480*b;
    l = l*l*l; m = m*m*m; s = s*s*s;
    return [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076949654*s];
  }
  function inGamut(c){ return c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001; }
  function clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }
  // r, g, b linear light 0..1 → boosted linear rgb
  function boostChroma(r, g, b, factor, iterations){
    if(factor === 1) return [r, g, b];
    var lab = linToOklab(r, g, b), out = oklabToLin(lab[0], lab[1]*factor, lab[2]*factor);
    if(inGamut(out)) return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
    var lo = 1, hi = factor, n = iterations || 20;
    for(var i=0;i<n;i++){
      var mid = (lo + hi)/2, c = oklabToLin(lab[0], lab[1]*mid, lab[2]*mid);
      if(inGamut(c)) lo = mid; else hi = mid;
    }
    out = oklabToLin(lab[0], lab[1]*lo, lab[2]*lo);
    return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
  }
  // A whole photo (RGBA sRGB bytes) with its colour intensity scaled.
  var TO_SRGB = new Uint8ClampedArray(4096);
  for(i=0;i<4096;i++){ var lv = i/4095; TO_SRGB[i] = Math.round((lv <= 0.0031308 ? 12.92*lv : 1.055*Math.pow(lv, 1/2.4) - 0.055)*255); }
  function enhance(rgba, w, h, factor){
    var out = new Uint8ClampedArray(rgba.length);
    for(var p=0, n=w*h; p<n; p++){
      var q = p*4, c = boostChroma(LIN[rgba[q]], LIN[rgba[q+1]], LIN[rgba[q+2]], factor, 10);
      out[q] = TO_SRGB[Math.round(c[0]*4095)]; out[q+1] = TO_SRGB[Math.round(c[1]*4095)]; out[q+2] = TO_SRGB[Math.round(c[2]*4095)];
      out[q+3] = 255;
    }
    return out;
  }

  root.Shapes = { Analyzer: Analyzer, boostChroma: boostChroma, enhance: enhance };
})(typeof self !== "undefined" ? self : this);
