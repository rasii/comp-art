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
// Block-in (Analyzer.blocks) is the other breakdown: the photo covered with
// a limited palette, as flat masses or (in the app) brush strokes along the
// fur, from a colour count and a broad-to-fine detail setting.
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
    this.r0 = Math.max(2, Math.round(Math.max(w, h)/160*(smoothing || 2.5)));   // the Shapes tab's smoothing radius
    this.sharp = sharpness(this.im, Math.max(3, Math.round(Math.max(w, h)/100)));
    this.hier = {};
    this.smooth = [];    // the last few Kuwahara results, by radius (each is ~3 floats per pixel)
  }
  Analyzer.prototype.smoothAt = function(r){
    for(var i=0;i<this.smooth.length;i++){
      if(this.smooth[i].r === r){ var hit = this.smooth.splice(i, 1)[0]; this.smooth.push(hit); return hit.sm; }
    }
    var sm = kuwahara(this.im, r);
    this.smooth.push({ r: r, sm: sm });
    if(this.smooth.length > 4) this.smooth.shift();
    return sm;
  };
  // values: group by value only. count: number of shapes. bgOne: merge
  // everything out of focus into one background shape. opts (optional):
  // smooth = majority passes, straight = outline simplification factor.
  Analyzer.prototype.compute = function(values, count, bgOne, opts){
    opts = opts || {};
    var im = this.im, w = im.w, h = im.h, n = w*h, key = values ? "v" : "c";
    var H = this.hier[key] || (this.hier[key] = buildHierarchy(im, this.smoothAt(this.r0), this.sharp, values));
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

    return finish(im, lab, opts.straight || 2);
  };

  // A result from a region map: ids compacted, each region's average colour
  // (from the original photo, linear RGB) and size, and the outline of every
  // connected piece straightened to segments within `straight` of the edge.
  // `group` (optional) maps a region id to its paint: regions that share
  // a palette colour but are kept apart (inside/outside the subject). The
  // result also carries each paint's colour and size; without groups every
  // region is its own paint.
  function finish(im, lab, straight, group){
    var w = im.w, h = im.h, n = w*h;
    var ids = new Map(), out = new Uint16Array(n), stats = [], raw = [];
    for(var p=0;p<n;p++){
      var k = ids.get(lab[p]);
      if(k === undefined){ k = stats.length; ids.set(lab[p], k); stats.push([0, 0, 0, 0]); raw.push(lab[p]); }
      out[p] = k; var s = stats[k]; s[0] += im.lr[p]; s[1] += im.lg[p]; s[2] += im.lb[p]; s[3]++;
    }
    var colors = new Float32Array(stats.length*3), sizes = new Uint32Array(stats.length);
    stats.forEach(function(s, k){ colors[k*3] = s[0]/s[3]; colors[k*3+1] = s[1]/s[3]; colors[k*3+2] = s[2]/s[3]; sizes[k] = s[3]; });
    var paint = new Uint16Array(stats.length), gids = new Map(), psum = [];
    stats.forEach(function(s, k){
      var g = group ? group[raw[k]] : k, j = gids.get(g);
      if(j === undefined){ j = psum.length; gids.set(g, j); psum.push([0, 0, 0, 0]); }
      paint[k] = j; var q = psum[j]; q[0] += s[0]; q[1] += s[1]; q[2] += s[2]; q[3] += s[3];
    });
    var paintColors = new Float32Array(psum.length*3), paintSizes = new Uint32Array(psum.length);
    psum.forEach(function(q, j){ paintColors[j*3] = q[0]/q[3]; paintColors[j*3+1] = q[1]/q[3]; paintColors[j*3+2] = q[2]/q[3]; paintSizes[j] = q[3]; });
    var gmax = -1; gids.forEach(function(_, g){ if(g > gmax) gmax = g; });
    var gpaint = new Int32Array(gmax + 1).fill(-1); gids.forEach(function(j, g){ gpaint[g] = j; });

    var eps = Math.max(1.5, Math.max(w, h)/260*straight), seen = new Uint8Array(n), polys = [], st = new Int32Array(n);
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
    return { w: w, h: h, labels: out, colors: colors, sizes: sizes, count: stats.length, polys: polys,
             paint: paint, paints: psum.length, paintColors: paintColors, paintSizes: paintSizes, gpaint: gpaint };
  }

  // ---------------- block-in: flat masses from a limited palette ----------------
  // A painter's first pass: mix a few piles of paint and cover the canvas
  // with them. The photo is smoothed, every pixel takes the nearest of K
  // palette colours, specks are absorbed into their surroundings and the
  // mass edges rounded off. One `detail` setting (0..1) drives the palette
  // size, the smoothing scale and the smallest mass kept.
  function rng(seed){
    return function(){
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // The palette: weighted k-means (k-means++ seeding, fixed seed so the
  // same photo always gives the same palette) on the smoothed colours.
  // Pixel weights let small but strongly coloured accents count more.
  // Accents are then handled on the photo's own colours, since heavy
  // smoothing has already mixed a small orange face into the grey head: a
  // strongly coloured patch far from every palette colour gets one of its
  // own (up to two), and strongly coloured pixels are placed by their own
  // colour rather than the smoothed one.
  function palette(sm, im, n, k, cw, weight, accent){
    var stride = Math.max(1, Math.ceil(n/60000)), m = Math.ceil(n/stride);
    var X = new Float32Array(m*3), Xo = new Float32Array(m*3), Wt = new Float32Array(m), Ac = new Uint8Array(m);
    for(var j=0, i=0; j<m; j++, i+=stride){
      X[j*3] = sm.L[i]; X[j*3+1] = sm.A[i]*cw; X[j*3+2] = sm.B[i]*cw;
      Xo[j*3] = im.L[i]; Xo[j*3+1] = im.A[i]*cw; Xo[j*3+2] = im.B[i]*cw;
      Wt[j] = weight ? weight[i] : 1; Ac[j] = accent ? accent[i] : 0;
    }
    function d2(P, j, c){ var a = P[j*3]-c[0], b = P[j*3+1]-c[1], d = P[j*3+2]-c[2]; return a*a + b*b + d*d; }
    var rand = rng(7), C = [], D = new Float32Array(m).fill(1);
    for(var c=0;c<k;c++){
      var total = 0; for(j=0;j<m;j++) total += Wt[j]*D[j];
      var r = rand()*total, pick = m-1;
      for(j=0;j<m;j++){ r -= Wt[j]*D[j]; if(r <= 0){ pick = j; break; } }
      var cen = [X[pick*3], X[pick*3+1], X[pick*3+2]];
      C.push(cen);
      for(j=0;j<m;j++){ var d = d2(X, j, cen); if(c === 0 || d < D[j]) D[j] = d; }
    }
    for(var it=0; it<10; it++){
      var S = []; for(c=0;c<k;c++) S.push([0,0,0,0]);
      for(j=0;j<m;j++){
        var bd = Infinity, bc = 0;
        for(c=0;c<k;c++){ d = d2(X, j, C[c]); if(d < bd){ bd = d; bc = c; } }
        var s = S[bc], wj = Wt[j]; s[0] += X[j*3]*wj; s[1] += X[j*3+1]*wj; s[2] += X[j*3+2]*wj; s[3] += wj;
      }
      for(c=0;c<k;c++) if(S[c][3]) C[c] = [S[c][0]/S[c][3], S[c][1]/S[c][3], S[c][2]/S[c][3]];
    }
    // accents (judged and placed on the photo's own colours): among the
    // strongly coloured pixels far from every palette colour, the densest
    // cluster becomes a colour of its own
    var FAR = 400, NEAR = 225, few = 0.001*m;   // ΔE 20 and 15
    for(var extra=0; extra<2; extra++){
      var far = [];
      for(j=0;j<m;j++){
        if(!Ac[j]) continue;
        var dj = Infinity; for(c=0;c<C.length;c++){ d = d2(Xo, j, C[c]); if(d < dj) dj = d; }
        if(dj > FAR) far.push(j);
      }
      if(far.length < few) break;
      var step = Math.max(1, Math.ceil(far.length/1500)), best = -1, bestN = 0;
      for(var u=0;u<far.length;u+=step){
        var cu = [Xo[far[u]*3], Xo[far[u]*3+1], Xo[far[u]*3+2]], cnt = 0;
        for(var v=0;v<far.length;v++) if(d2(Xo, far[v], cu) < NEAR) cnt++;
        if(cnt > bestN){ bestN = cnt; best = u; }
      }
      if(bestN < few) break;
      var cb = [Xo[far[best]*3], Xo[far[best]*3+1], Xo[far[best]*3+2]], acc = [0,0,0,0];
      for(v=0;v<far.length;v++) if(d2(Xo, far[v], cb) < NEAR){ acc[0] += Xo[far[v]*3]; acc[1] += Xo[far[v]*3+1]; acc[2] += Xo[far[v]*3+2]; acc[3]++; }
      C.push([acc[0]/acc[3], acc[1]/acc[3], acc[2]/acc[3]]);
    }
    // the darkest darks and lightest lights: anything of some size beyond
    // the palette's range of value gets its own colour, since a painter
    // wants those on the palette before anything else
    var lo = Infinity, hi = -Infinity;
    for(c=0;c<C.length;c++){ lo = Math.min(lo, C[c][0]); hi = Math.max(hi, C[c][0]); }
    [[-1, lo - 12], [1, hi + 12]].forEach(function(edge){
      var acc = [0,0,0,0];
      for(var j=0;j<m;j++){ var L = X[j*3]; if(edge[0] < 0 ? L < edge[1] : L > edge[1]){ acc[0] += L; acc[1] += X[j*3+1]; acc[2] += X[j*3+2]; acc[3]++; } }
      if(acc[3] >= few) C.push([acc[0]/acc[3], acc[1]/acc[3], acc[2]/acc[3]]);
    });
    var out = new Int32Array(n), K = C.length;
    for(i=0;i<n;i++){
      var own = accent && accent[i], P = own ? im : sm;
      var l = P.L[i], a = P.A[i]*cw, b2 = P.B[i]*cw; bd = Infinity; bc = 0;
      for(c=0;c<K;c++){ var cc = C[c], dl = l-cc[0], da = a-cc[1], db = b2-cc[2]; d = dl*dl + da*da + db*db; if(d < bd){ bd = d; bc = c; } }
      out[i] = bc;
    }
    var chroma = new Float32Array(K);
    for(c=0;c<K;c++) chroma[c] = Math.hypot(C[c][1], C[c][2]);
    // nearest palette colour for every pixel of another colour map
    function assign(P){
      var o = new Int32Array(n);
      for(var i=0;i<n;i++){
        var l = P.L[i], a = P.A[i]*cw, b2 = P.B[i]*cw, bd = Infinity, bc = 0;
        for(var c=0;c<K;c++){ var cc = C[c], dl = l-cc[0], da = a-cc[1], db = b2-cc[2], d = dl*dl + da*da + db*db; if(d < bd){ bd = d; bc = c; } }
        o[i] = bc;
      }
      return o;
    }
    return { lab: out, chroma: chroma, base: k, assign: assign };
  }
  // Majority filter for a map with few labels (window 2r+1): one box-count
  // pass per label, so the radius costs nothing extra. With a subject mask,
  // labels from `half` up belong inside it and a pixel only ever takes a
  // label from its own side, so the silhouette is never rounded away.
  function majorityK(w, h, lab, k, r, mask, half){
    var n = w*h, W1 = w + 1, I = new Int32Array(W1*(h+1)), best = new Int32Array(n), bestN = new Int32Array(n);
    for(var c=0;c<k;c++){
      var side = c >= half ? 1 : 0;
      for(var y=0;y<h;y++){ var s = 0; for(var x=0;x<w;x++){ if(lab[y*w + x] === c) s++; I[(y+1)*W1 + x + 1] = I[y*W1 + x + 1] + s; } }
      for(y=0;y<h;y++){
        var y0 = Math.max(0, y-r), y1 = Math.min(h-1, y+r);
        for(x=0;x<w;x++){
          var x0 = Math.max(0, x-r), x1 = Math.min(w-1, x+r);
          var cnt = I[(y1+1)*W1 + x1 + 1] - I[y0*W1 + x1 + 1] - I[(y1+1)*W1 + x0] + I[y0*W1 + x0];
          var p = y*w + x;
          if(mask && mask[p] !== side) continue;
          if(cnt > bestN[p] || (cnt === bestN[p] && lab[p] === c)){ bestN[p] = cnt; best[p] = c; }
        }
      }
    }
    return best;
  }
  // Pieces smaller than their label's minimum (less where the piece is in
  // focus) join whichever neighbouring label they touch most. Two passes,
  // so a speck absorbed into another speck follows it into the mass.
  function absorbSpecks(lab, w, h, minSize, focus, mask){
    var n = w*h;
    for(var pass=0; pass<2; pass++){
      var comp = new Int32Array(n).fill(-1), stack = new Int32Array(n), pix = new Int32Array(n);
      for(var s=0;s<n;s++){
        if(comp[s] >= 0) continue;
        var id = s, me = lab[s], sp = 0, size = 0, touch = new Map(), fsum = 0;
        stack[sp++] = s; comp[s] = id;
        while(sp){
          var p = stack[--sp], x = p % w, y = (p / w) | 0; pix[size++] = p; fsum += focus[p];
          var nb = [x > 0 ? p-1 : -1, x < w-1 ? p+1 : -1, y > 0 ? p-w : -1, y < h-1 ? p+w : -1];
          for(var i=0;i<4;i++){
            var q = nb[i]; if(q < 0) continue;
            if(lab[q] === me){ if(comp[q] < 0){ comp[q] = id; stack[sp++] = q; } }
            else if(!mask || mask[q] === mask[p]) touch.set(lab[q], (touch.get(lab[q]) || 0) + 1);
          }
        }
        if(size >= minSize[me]*(1 - 0.8*fsum/size) || !touch.size) continue;   // in focus: a fifth the size survives
        var bestL = me, bestN = -1;
        touch.forEach(function(c, l){ if(c > bestN){ bestN = c; bestL = l; } });
        for(i=0;i<size;i++) lab[pix[i]] = bestL;
      }
    }
    return lab;
  }
  function lerp(a, b, t){ return a + (b - a)*t; }

  // ---- stroke direction ----
  // The direction along which the picture changes least at each pixel
  // (the structure tensor's edge direction, averaged over radius r): along
  // the fur, along an edge. 0..255 for 0..π.
  function boxMean(a, w, h, r){
    var W1 = w + 1, I = new Float64Array(W1*(h+1)), out = new Float32Array(w*h);
    for(var y=0;y<h;y++){ var s = 0; for(var x=0;x<w;x++){ s += a[y*w + x]; I[(y+1)*W1 + x + 1] = I[y*W1 + x + 1] + s; } }
    for(y=0;y<h;y++){
      var y0 = Math.max(0, y-r), y1 = Math.min(h-1, y+r);
      for(x=0;x<w;x++){
        var x0 = Math.max(0, x-r), x1 = Math.min(w-1, x+r);
        out[y*w + x] = (I[(y1+1)*W1 + x1 + 1] - I[y0*W1 + x1 + 1] - I[(y1+1)*W1 + x0] + I[y0*W1 + x0])/((x1-x0+1)*(y1-y0+1));
      }
    }
    return out;
  }
  //
  // Where there's no clear direction nearby (snow, sky, a soft background)
  // the local one is just noise and the strokes would point every which
  // way, so it gives way to the direction over a wider area, and where
  // even that is unclear, to the picture's overall direction: broad, calm
  // strokes instead of scattered dabs. Each scale's tensor is normalised
  // and weighted by how clear (coherent) and how strong it is.
  function orientation(L, w, h, r){
    var n = w*h, xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
    var Gxx = 0, Gyy = 0, Gxy = 0;
    for(var y=1;y<h-1;y++) for(var x=1;x<w-1;x++){
      var p = y*w + x, gx = L[p+1] - L[p-1], gy = L[p+w] - L[p-w];
      xx[p] = gx*gx; yy[p] = gy*gy; xy[p] = gx*gy;
      Gxx += xx[p]; Gyy += yy[p]; Gxy += xy[p];
    }
    var tG = (Gxx + Gyy) || 1, gxx = Gxx/tG, gyy = Gyy/tG, gxy = Gxy/tG, meanT = tG/n;
    var Sxx = boxMean(xx, w, h, r), Syy = boxMean(yy, w, h, r), Sxy = boxMean(xy, w, h, r);
    var R2 = 4*r, Bxx = boxMean(xx, w, h, R2), Byy = boxMean(yy, w, h, R2), Bxy = boxMean(xy, w, h, R2);
    // how much to trust a tensor: clear direction (coherence) and enough
    // contrast to mean anything
    function trust(txx, tyy, txy, lo, span){
      var t = txx + tyy; if(t <= 1e-9) return 0;
      var coh = Math.sqrt((txx - tyy)*(txx - tyy) + 4*txy*txy)/t;
      return clamp01((coh - lo)/span)*clamp01(t/(0.25*meanT));
    }
    var out = new Uint8Array(n);
    for(p=0;p<n;p++){
      var tS = (Sxx[p] + Syy[p]) || 1e-9, tB = (Bxx[p] + Byy[p]) || 1e-9;
      var wS = trust(Sxx[p], Syy[p], Sxy[p], 0.15, 0.35), wB = trust(Bxx[p], Byy[p], Bxy[p], 0.1, 0.3);
      var oxx = wB*Bxx[p]/tB + (1 - wB)*gxx, oyy = wB*Byy[p]/tB + (1 - wB)*gyy, oxy = wB*Bxy[p]/tB + (1 - wB)*gxy;
      var exx = wS*Sxx[p]/tS + (1 - wS)*oxx, eyy = wS*Syy[p]/tS + (1 - wS)*oyy, exy = wS*Sxy[p]/tS + (1 - wS)*oxy;
      var a = 0.5*Math.atan2(2*exy, exx - eyy) + Math.PI/2;   // across the gradient
      a = ((a % Math.PI) + Math.PI) % Math.PI;
      out[p] = Math.round(a/Math.PI*255);
    }
    return out;
  }

  // ---- the subject's silhouette, from the focus map ----
  // Box dilate (any set pixel within r) or erode (all set), via an integral image.
  function morph(m, w, h, r, erode){
    var W1 = w + 1, I = new Int32Array(W1*(h+1)), out = new Uint8Array(w*h);
    for(var y=0;y<h;y++){ var s = 0; for(var x=0;x<w;x++){ s += m[y*w + x]; I[(y+1)*W1 + x + 1] = I[y*W1 + x + 1] + s; } }
    for(y=0;y<h;y++){
      var y0 = Math.max(0, y-r), y1 = Math.min(h-1, y+r);
      for(x=0;x<w;x++){
        var x0 = Math.max(0, x-r), x1 = Math.min(w-1, x+r);
        var cnt = I[(y1+1)*W1 + x1 + 1] - I[y0*W1 + x1 + 1] - I[(y1+1)*W1 + x0] + I[y0*W1 + x0];
        out[y*w + x] = erode ? (cnt === (x1-x0+1)*(y1-y0+1) ? 1 : 0) : (cnt > 0 ? 1 : 0);
      }
    }
    return out;
  }
  // Flood-fills pieces of `value` in m; each piece is dropped (set to 1-value)
  // when smaller than minSize, or, with fromBorder, kept only if it touches
  // the border (so enclosed holes are filled).
  function cleanPieces(m, w, h, value, minSize, fromBorder){
    var n = w*h, seen = new Uint8Array(n), stack = new Int32Array(n), pix = new Int32Array(n);
    for(var s=0;s<n;s++){
      if(seen[s] || m[s] !== value) continue;
      var sp = 0, size = 0, border = false; stack[sp++] = s; seen[s] = 1;
      while(sp){
        var p = stack[--sp], x = p % w, y = (p / w) | 0; pix[size++] = p;
        if(x === 0 || y === 0 || x === w-1 || y === h-1) border = true;
        if(x > 0 && !seen[p-1] && m[p-1] === value){ seen[p-1] = 1; stack[sp++] = p-1; }
        if(x < w-1 && !seen[p+1] && m[p+1] === value){ seen[p+1] = 1; stack[sp++] = p+1; }
        if(y > 0 && !seen[p-w] && m[p-w] === value){ seen[p-w] = 1; stack[sp++] = p-w; }
        if(y < h-1 && !seen[p+w] && m[p+w] === value){ seen[p+w] = 1; stack[sp++] = p+w; }
      }
      var drop = fromBorder ? !border : size < minSize;
      if(drop) for(var i=0;i<size;i++) m[pix[i]] = 1 - value;
    }
    return m;
  }
  // The in-focus part of the photo as one clean silhouette (gaps closed,
  // specks dropped, holes filled), or null when
  // there's no clear subject: nothing in focus, or everything.
  function subjectMask(focus, w, h){
    var n = w*h, m = new Uint8Array(n), on = 0;
    for(var p=0;p<n;p++){ m[p] = focus[p] > 0.5 ? 1 : 0; on += m[p]; }
    if(on < 0.005*n || on > 0.7*n) return null;
    var r = Math.max(2, Math.round(Math.max(w, h)/200));
    m = morph(morph(m, w, h, r, false), w, h, r, true);
    cleanPieces(m, w, h, 1, 0.003*n, false);
    cleanPieces(m, w, h, 0, 0, true);
    on = 0; for(p=0;p<n;p++) on += m[p];
    return (on < 0.005*n || on > 0.8*n) ? null : m;
  }

  // What the block-in needs from the photo alone, computed once and reused
  // for every setting: the in-focus map (0..1), the subject silhouette,
  // the stroke directions, and the palette weights and accent marks.
  //
  // Choosing the palette, in-focus pixels and (in colour mode) strongly
  // coloured ones count extra, so a small subject or a small accent like a
  // bird's orange face gets its own colours instead of being outvoted by
  // the background. The boosts are self-limiting: they bring that group up
  // to about 60% / 30% of the total weight and no further, so an orange
  // fox filling the frame isn't handed every colour while its white chest
  // and the snow share one muddy grey.
  Analyzer.prototype.subject = function(values){
    var key = values ? "v" : "c";
    this.subj = this.subj || {};
    if(this.subj[key]) return this.subj[key];
    var im = this.im, w = im.w, h = im.h, n = w*h, p;
    if(!this.focus){
      var focus = new Float32Array(n);
      for(p=0;p<n;p++){ var f = (this.sharp[p] - 0.12)/0.25; focus[p] = f < 0 ? 0 : f > 1 ? 1 : f; }
      this.focus = focus;
      this.mask = subjectMask(focus, w, h);
      this.angle = orientation(im.L, w, h, Math.max(2, Math.round(Math.max(w, h)/160)));
    }
    var chroma = new Float32Array(n), accent = values ? null : new Uint8Array(n), inFocus = 0, strong = 0;
    for(p=0;p<n;p++){
      var c = values ? 0 : Math.min(1, Math.hypot(im.A[p], im.B[p])/40);
      chroma[p] = c; if(c >= 0.7) strong++; if(this.focus[p] > 0.5) inFocus++;
      if(accent) accent[p] = c >= 0.7 ? 1 : 0;
    }
    function boost(share, target, max){ return share <= 0 ? 1 : Math.max(1, Math.min(max, target/(1-target)*(1-share)/share)); }
    var fBoost = boost(inFocus/n, 0.6, 4) - 1, cBoost = boost(strong/n, 0.3, 9) - 1;
    var weight = new Float32Array(n);
    for(p=0;p<n;p++){ c = chroma[p]; weight[p] = (1 + cBoost*c*c)*(1 + fBoost*this.focus[p]); }
    return (this.subj[key] = { focus: this.focus, mask: this.mask, angle: this.angle, weight: weight, accent: accent });
  };

  // Detail where it's in focus: the sharp parts of the photo (the subject)
  // are smoothed less, keep their smaller masses and finer edges; the
  // out-of-focus parts get the full coarse treatment. A painter's crisp
  // subject on a soft background.
  // colours: palette size (exact, accents included). detail 0..1: broad
  // to fine, through the smoothing scale and the smallest mass kept (the
  // stroke size follows it in the app).
  Analyzer.prototype.blocks = function(values, colours, detail){
    var im = this.im, w = im.w, h = im.h, n = w*h, t = Math.max(0, Math.min(1, detail)), long = Math.max(w, h), p;
    var S = this.subject(values), focus = S.focus, mask = S.mask;

    var k = Math.max(3, Math.round(colours));
    var rH = Math.max(2, Math.round(long/160*lerp(3.5, 0.6, t))), rL = Math.max(2, Math.round(rH/3));
    var smH = this.smoothAt(rH), sm = smH;
    if(rL < rH){
      var smL = this.smoothAt(rL);
      sm = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
      for(p=0;p<n;p++){ var f = focus[p]; sm.L[p] = smH.L[p] + (smL.L[p] - smH.L[p])*f; sm.A[p] = smH.A[p] + (smL.A[p] - smH.A[p])*f; sm.B[p] = smH.B[p] + (smL.B[p] - smH.B[p])*f; }
    }
    // the accents come on top of the base count; take them out of the
    // base so the total is the number asked for (a few tries, since the
    // accents found can change with the base)
    var pal, base = k;
    for(var tries=0; tries<3; tries++){
      pal = palette(sm, im, n, base, values ? 0 : 1, S.weight, S.accent);
      var total = pal.chroma.length;
      if(total === k || k - (total - base) < 3) break;
      base = k - (total - base);
    }
    var lab = pal.lab, K = pal.chroma.length;
    // The subject's silhouette is a line no mass crosses: inside it the
    // palette colours are separate masses (ids K..2K-1) from the same
    // colours outside, through the rounding and the speck absorption. A
    // beak the colour of the snow behind it still keeps its edge.
    k = mask ? 2*K : K;
    if(mask) for(p=0;p<n;p++) if(mask[p]) lab[p] += K;
    var mr = Math.max(1, Math.round(long/320*lerp(3.5, 0.5, t))), mrL = Math.max(1, Math.round(mr/3));
    var labH = majorityK(w, h, majorityK(w, h, lab, k, mr, mask, K), k, mr, mask, K);
    if(mrL < mr){
      var labL = majorityK(w, h, majorityK(w, h, lab, k, mrL, mask, K), k, mrL, mask, K);
      for(p=0;p<n;p++) labH[p] = focus[p] > 0.5 ? labL[p] : labH[p];
    }
    lab = labH;
    // an accent is kept at a sixth the size of a neutral mass, and any
    // strongly coloured mass at a quarter
    var minSize = new Float32Array(k), group = new Int32Array(k), unit = n*lerp(0.005, 0.0002, t);
    for(var c=0;c<k;c++){
      var g = c % K; group[c] = g;
      minSize[c] = unit*(g >= pal.base ? 1/6 : pal.chroma[g] > 28 ? 0.25 : 1);
    }
    absorbSpecks(lab, w, h, minSize, focus, mask);
    var R = finish(im, lab, 1, group);
    // for the brush strokes: the fur direction, and, in focus, the paint
    // nearest the photo's own colour at each pixel (lightly smoothed), so
    // the fine strokes can put back detail the mass clean-up took out
    R.angle = S.angle;
    R.mask = mask;                  // the subject's silhouette (or null): strokes stay on their side of it
    var nearRaw = pal.assign(this.smoothAt(2)), near = new Uint16Array(n);
    for(p=0;p<n;p++){
      var j = focus[p] > 0.5 ? R.gpaint[nearRaw[p]] : -1;
      near[p] = j >= 0 ? j : R.paint[R.labels[p]];
    }
    R.near = near;
    return R;
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
