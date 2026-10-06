// Finds the canvas in a photo of a painting.
//
//   guess()  — no hints: finds long near-horizontal / near-vertical lines
//              (Hough transform) and picks the four that best form the
//              canvas, then refines each corner.
//   refine() — snaps rough corner points onto the nearby canvas edges.
//
// Corners the method isn't sure of are reported as unsure and left where
// they were. Pure functions on RGBA buffers, so the same code runs on the
// main thread and in detect-worker.js.
(function(root){
  "use strict";

  // ---------------- image gradients ----------------
  // Light 3x3 blur per channel (suppresses paint texture), then Sobel per
  // channel, keeping the strongest channel so colour edges count as well
  // as brightness edges.
  function gradients(rgba, w, h){
    var ch = [new Float32Array(w*h), new Float32Array(w*h), new Float32Array(w*h)];
    var x, y, k, p;
    for(k=0;k<3;k++){
      var a = ch[k];
      for(y=1;y<h-1;y++) for(x=1;x<w-1;x++){
        p = y*w + x;
        var s = 0;
        for(var dy=-1;dy<=1;dy++){ var r = (p + dy*w)*4 + k; s += rgba[r-4] + rgba[r] + rgba[r+4]; }
        a[p] = s/9;
      }
    }
    var gx = new Float32Array(w*h), gy = new Float32Array(w*h), mag = new Float32Array(w*h);
    for(y=2;y<h-2;y++) for(x=2;x<w-2;x++){
      p = y*w + x;
      var best = 0, bx = 0, by = 0;
      for(k=0;k<3;k++){
        var c = ch[k];
        var sx = (c[p-w+1] + 2*c[p+1] + c[p+w+1]) - (c[p-w-1] + 2*c[p-1] + c[p+w-1]);
        var sy = (c[p+w-1] + 2*c[p+w] + c[p+w+1]) - (c[p-w-1] + 2*c[p-w] + c[p-w+1]);
        var m = sx*sx + sy*sy;
        if(m > best){ best = m; bx = sx; by = sy; }
      }
      gx[p] = bx; gy[p] = by; mag[p] = Math.sqrt(best);
    }
    return { w: w, h: h, gx: gx, gy: gy, mag: mag };
  }

  // gradients of an image object, computed once and kept on it
  function gradientsOf(img){
    if(!img._G) img._G = gradients(img.data, img.w, img.h);
    return img._G;
  }

  function percentile(arr, q){
    var max = 0, i;
    for(i=0;i<arr.length;i++) if(arr[i] > max) max = arr[i];
    if(!max) return 0;
    var hist = new Uint32Array(2048);
    for(i=0;i<arr.length;i++) hist[Math.min(2047, Math.floor(arr[i]/max*2047))]++;
    var n = 0, target = arr.length*q;
    for(i=0;i<2048;i++){ n += hist[i]; if(n >= target) return i/2047*max; }
    return max;
  }

  // ---------------- lines ----------------
  function lineFrom(phi, rho){
    var a = phi*Math.PI/180, n = { x: Math.cos(a), y: Math.sin(a) };
    return { phi: phi, rho: rho, n: n, u: { x: -n.y, y: n.x }, p0: { x: n.x*rho, y: n.y*rho } };
  }
  function intersectNR(l1, l2){
    var d = l1.n.x*l2.n.y - l1.n.y*l2.n.x;
    if(Math.abs(d) < 1e-9) return null;
    return { x: (l1.rho*l2.n.y - l1.n.y*l2.rho)/d, y: (l1.n.x*l2.rho - l1.rho*l2.n.x)/d };
  }

  // Hough transform restricted to near-horizontal and near-vertical lines
  // (within 22° — photos are taken roughly square-on). Each edge pixel votes
  // only near its own gradient direction. Peaks are kept close together
  // (3 px) so a canvas edge isn't swallowed by a strong line just beside it.
  function houghLines(G){
    var w = G.w, h = G.h, gx = G.gx, gy = G.gy, mag = G.mag;
    var T = percentile(mag, 0.85);
    var NPHI = 360, diag = Math.ceil(Math.hypot(w, h)), NR = 2*diag + 1;
    var acc = new Float32Array(NPHI*NR), cs = [], sn = [], i;
    for(i=0;i<NPHI;i++){ var a = i*0.5*Math.PI/180; cs.push(Math.cos(a)); sn.push(Math.sin(a)); }
    for(var y=3;y<h-3;y++) for(var x=3;x<w-3;x++){
      var p = y*w + x, m = mag[p];
      if(m < T) continue;
      var ox = Math.round(gx[p]/m), oy = Math.round(gy[p]/m);   // thin edges: non-max along the gradient
      if(mag[p + oy*w + ox] > m || mag[p - oy*w - ox] > m) continue;
      var phi = Math.atan2(gy[p], gx[p])*180/Math.PI; phi = ((phi % 180) + 180) % 180;
      if(!(Math.abs(phi - 90) <= 22 || phi <= 22 || phi >= 158)) continue;
      var wgt = Math.min(m/T, 3);
      for(var dp=-3; dp<=3; dp+=0.5){
        var f = ((phi + dp) % 180 + 180) % 180, fi = Math.round(f*2) % NPHI;
        acc[fi*NR + Math.round(x*cs[fi] + y*sn[fi]) + diag] += wgt;
      }
    }
    var minVotes = 0.04*Math.min(w, h);
    function family(test){
      var peaks = [];
      for(var fi=0; fi<NPHI; fi++){
        if(!test(fi/2)) continue;
        for(var r=0; r<NR; r++){
          var v = acc[fi*NR + r];
          if(v < minVotes) continue;
          var isMax = true;
          for(var df=-6; df<=6 && isMax; df++){
            var g = (fi + df + NPHI) % NPHI;
            for(var dr=-3; dr<=3; dr++){
              var rr = r + dr;
              if(rr < 0 || rr >= NR || (df === 0 && dr === 0)) continue;
              if(acc[g*NR + rr] > v){ isMax = false; break; }
            }
          }
          if(isMax) peaks.push({ phi: fi/2, rho: r - diag, votes: v });
        }
      }
      peaks.sort(function(a, b){ return b.votes - a.votes; });
      return peaks.slice(0, 40).map(function(l){ return lineFrom(l.phi, l.rho); });
    }
    return {
      T: T,
      H: family(function(f){ return Math.abs(f - 90) <= 22; }),
      V: family(function(f){ return f <= 22 || f >= 158; })
    };
  }

  // Edge support along a whole line, as prefix sums so any stretch of it
  // can be scored in O(1).
  function profile(G, L, T){
    var D = Math.ceil(Math.hypot(G.w, G.h)), n = 2*D + 1;
    var strong = new Uint32Array(n+1), valid = new Uint32Array(n+1);
    for(var i=0;i<n;i++){
      var t = i - D, x0 = L.p0.x + t*L.u.x, y0 = L.p0.y + t*L.u.y, s = 0, v = 0;
      if(x0 >= 3 && y0 >= 3 && x0 < G.w-3 && y0 < G.h-3){
        v = 1;
        for(var o=-1;o<=1;o++){
          var p = Math.round(y0 + o*L.n.y)*G.w + Math.round(x0 + o*L.n.x);
          if(Math.abs(G.gx[p]*L.n.x + G.gy[p]*L.n.y) > T*0.8){ s = 1; break; }
        }
      }
      strong[i+1] = strong[i] + s; valid[i+1] = valid[i] + v;
    }
    L.D = D; L.strong = strong; L.valid = valid;
  }
  function tOf(L, P){ return (P.x - L.p0.x)*L.u.x + (P.y - L.p0.y)*L.u.y; }
  function cover(L, t0, t1){
    if(t1 < t0){ var s = t0; t0 = t1; t1 = s; }
    var a = Math.max(0, Math.round(t0) + L.D), b = Math.min(L.strong.length - 1, Math.round(t1) + L.D);
    var v = L.valid[b] - L.valid[a];
    return v > 0 ? (L.strong[b] - L.strong[a])/v : 0;
  }

  // Scores every top/bottom/left/right combination: support along each side,
  // little support beyond the corners (canvas edges stop there; easel seams
  // and wall lines carry on), corner angles near 90°, size, and closeness
  // to the reference's proportions.
  function bestQuad(G, lines, refAspect){
    var H = lines.H.map(function(l){ return { l: l, y: (l.rho - G.w/2*l.n.x)/l.n.y }; }).sort(function(a, b){ return a.y - b.y; });
    var V = lines.V.map(function(l){ return { l: l, x: (l.rho - G.h/2*l.n.y)/l.n.x }; }).sort(function(a, b){ return a.x - b.x; });
    var best = null, minSide = 0.15*Math.min(G.w, G.h);
    for(var i=0;i<H.length;i++) for(var j=i+1;j<H.length;j++){
      if(H[j].y - H[i].y < 0.2*G.h) continue;
      for(var a=0;a<V.length;a++) for(var b=a+1;b<V.length;b++){
        if(V[b].x - V[a].x < 0.2*G.w) continue;
        var top = H[i].l, bot = H[j].l, lef = V[a].l, rig = V[b].l;
        var C = [intersectNR(top, lef), intersectNR(top, rig), intersectNR(bot, rig), intersectNR(bot, lef)];
        if(C.some(function(p){ return !p || p.x < -2 || p.y < -2 || p.x > G.w+2 || p.y > G.h+2; })) continue;
        var sides = [[top, C[0], C[1]], [rig, C[1], C[2]], [bot, C[2], C[3]], [lef, C[3], C[0]]];
        var sum = 0, min = 1, ext = 0, ok = true;
        for(var s=0;s<4;s++){
          var L = sides[s][0], ta = tOf(L, sides[s][1]), tb = tOf(L, sides[s][2]), len = Math.abs(tb - ta);
          if(len < minSide){ ok = false; break; }
          var c = cover(L, ta, tb); sum += c; if(c < min) min = c;
          var e = 0.12*len, dir = tb > ta ? 1 : -1;
          ext += cover(L, ta - dir*e, ta) + cover(L, tb, tb + dir*e);
        }
        if(!ok) continue;
        for(var k=0;k<4 && ok;k++){
          var P = C[k], Q = C[(k+1)%4], R = C[(k+3)%4];
          var v1x = Q.x-P.x, v1y = Q.y-P.y, v2x = R.x-P.x, v2y = R.y-P.y;
          var ang = Math.acos((v1x*v2x + v1y*v2y)/Math.hypot(v1x, v1y)/Math.hypot(v2x, v2y))*180/Math.PI;
          if(ang < 70 || ang > 110) ok = false;
        }
        if(!ok) continue;
        var area = Math.abs((C[0].x*C[1].y - C[1].x*C[0].y) + (C[1].x*C[2].y - C[2].x*C[1].y) + (C[2].x*C[3].y - C[3].x*C[2].y) + (C[3].x*C[0].y - C[0].x*C[3].y))/2;
        var score = sum/4 + 0.5*min - 0.8*ext/8 + 0.15*Math.sqrt(area/(G.w*G.h));
        if(refAspect){
          var wq = (Math.hypot(C[1].x-C[0].x, C[1].y-C[0].y) + Math.hypot(C[2].x-C[3].x, C[2].y-C[3].y))/2;
          var hq = (Math.hypot(C[3].x-C[0].x, C[3].y-C[0].y) + Math.hypot(C[2].x-C[1].x, C[2].y-C[1].y))/2;
          score -= 2*Math.abs(Math.log((wq/hq)/refAspect));
        }
        if(!best || score > best.score) best = { score: score, C: C, mean: sum/4, min: min };
      }
    }
    return best;
  }

  // ---------------- corner refinement ----------------
  // Searches for one edge leaving corner P toward neighbour Q: candidate
  // lines at small angles and offsets around the rough direction, scored by
  // the colour gradient across them. Offsets are measured inward (toward
  // the quad's centre).
  //
  // Starting from the strongest edge, it steps inward to a weaker parallel
  // edge when the strip between the two is plain: that's the side of the
  // panel, the easel rail or a wall line just outside the canvas, which sits
  // in front of everything. A textured strip is paint, so lines inside it
  // are part of the picture and are ignored.
  function findEdge(G, P, Q, inward, opts){
    var len = Math.hypot(Q.x - P.x, Q.y - P.y);
    var u0 = { x: (Q.x - P.x)/len, y: (Q.y - P.y)/len };
    var n0 = { x: -u0.y, y: u0.x };
    var sgn = (n0.x*inward.x + n0.y*inward.y) >= 0 ? 1 : -1;        // n0 direction that points inward
    var L = Math.min(opts.maxLen, 0.18*len);
    var byOffset = [];
    for(var k=-opts.out; k<=opts.in; k+=1){
      var bestK = null;
      for(var a=-opts.ang; a<=opts.ang; a+=0.25){
        var t = a*Math.PI/180;
        var u = { x: u0.x*Math.cos(t) - u0.y*Math.sin(t), y: u0.x*Math.sin(t) + u0.y*Math.cos(t) };
        var n = { x: -u.y, y: u.x };
        var dd = sgn*k, signed = 0, abs = 0, cnt = 0;
        var mags = [];
        for(var s=10; s<=L; s+=2){
          var x = Math.round(P.x + dd*n0.x + s*u.x), y = Math.round(P.y + dd*n0.y + s*u.y);
          if(x < 2 || y < 2 || x >= G.w-2 || y >= G.h-2) continue;
          var p = y*G.w + x, g = G.gx[p]*n.x + G.gy[p]*n.y;
          signed += g; abs += Math.abs(g); cnt++; mags.push(Math.abs(g));
        }
        if(cnt < 8) continue;
        var score = Math.abs(signed)/cnt;
        if(!bestK || score > bestK.score){
          bestK = { k: k, a: a, score: score, consistency: abs ? Math.abs(signed)/abs : 0, mags: mags, u: u, n: n,
                    p0: { x: P.x + dd*n0.x, y: P.y + dd*n0.y } };
        }
      }
      byOffset.push(bestK);
    }
    // candidate edges: local maxima across offsets that are consistent
    // (one side reliably lighter/darker) and continuous along the edge
    var cands = [];
    for(var i=0;i<byOffset.length;i++){
      var c = byOffset[i];
      if(!c) continue;
      var prev = byOffset[i-1], next = byOffset[i+1];
      if((prev && prev.score > c.score) || (next && next.score >= c.score)) continue;
      if(c.consistency < 0.75) continue;
      // contrast often changes along a canvas edge (different backgrounds
      // behind it), so only half of it needs to be clearly strong
      var lim = 0.25*c.score, strong = 0;
      c.mags.forEach(function(m){ if(m > lim) strong++; });
      if(strong/c.mags.length < 0.45) continue;
      cands.push(c);
    }
    if(!cands.length) return null;
    var pick = cands[0];
    cands.forEach(function(c){ if(c.score > pick.score) pick = c; });
    // step inward while there's a plain strip to a parallel edge
    var moved = true;
    while(moved){
      moved = false;
      for(var j=0;j<cands.length;j++){
        var d = cands[j];
        if(d.k <= pick.k + 3 || d.score < 0.35*pick.score || Math.abs(d.a - pick.a) > 2) continue;
        if(stripTexture(G, P, sgn, n0, pick, d, L) < 0.3*Math.min(pick.score, d.score)){ pick = d; moved = true; break; }
      }
    }
    return pick;
  }
  // How textured the strip between two parallel candidate edges is: the
  // mean change *along* the edge direction. A panel side, its shadow or an
  // easel rail are uniform along the edge (they only change across it);
  // brushwork changes in every direction.
  function stripTexture(G, P, sgn, n0, outer, inner, L){
    var sum = 0, cnt = 0, u = outer.u;
    for(var k = outer.k + 2; k <= inner.k - 2; k++){
      for(var s=10; s<=L; s+=3){
        var x = Math.round(P.x + sgn*k*n0.x + s*u.x), y = Math.round(P.y + sgn*k*n0.y + s*u.y);
        if(x < 2 || y < 2 || x >= G.w-2 || y >= G.h-2) continue;
        var p = y*G.w + x;
        sum += Math.abs(G.gx[p]*u.x + G.gy[p]*u.y); cnt++;
      }
    }
    return cnt ? sum/cnt : 0;
  }
  function intersectPU(l1, l2){
    var d = l1.u.x*l2.u.y - l1.u.y*l2.u.x;
    if(Math.abs(d) < 1e-6) return null;
    var t = ((l2.p0.x - l1.p0.x)*l2.u.y - (l2.p0.y - l1.p0.y)*l2.u.x)/d;
    return { x: l1.p0.x + t*l1.u.x, y: l1.p0.y + t*l1.u.y };
  }
  function refineCorners(G, C, opts){
    var mx = (C[0].x + C[1].x + C[2].x + C[3].x)/4, my = (C[0].y + C[1].y + C[2].y + C[3].y)/4;
    return C.map(function(P, i){
      var inward = { x: mx - P.x, y: my - P.y };
      var e1 = findEdge(G, P, C[(i+1)%4], inward, opts), e2 = findEdge(G, P, C[(i+3)%4], inward, opts);
      var X = (e1 && e2) ? intersectPU(e1, e2) : null;
      var reach = Math.max(opts.in, opts.out)*1.3;
      if(X && Math.hypot(X.x - P.x, X.y - P.y) <= reach) return { x: X.x, y: X.y, sure: true };
      return { x: P.x, y: P.y, sure: false };
    });
  }

  // ---------------- entry points ----------------
  // small: {data,w,h} roughly 600 px on the long edge (for the line search)
  // medium: {data,w,h} roughly 1500 px (for refinement)
  // refAspect: reference width/height, or 0 if unknown
  // Returns {found, corners:[{u,v}], sure:[bool]} in normalized coordinates.
  function guess(small, medium, refAspect){
    var Gs = gradientsOf(small);
    var lines = houghLines(Gs);
    lines.H.concat(lines.V).forEach(function(L){ profile(Gs, L, lines.T); });
    var q = bestQuad(Gs, lines, refAspect);
    if(!q || q.mean < 0.45 || q.min < 0.2) return { found: false };
    var sx = medium.w/small.w, sy = medium.h/small.h;
    var C = q.C.map(function(p){ return { x: p.x*sx, y: p.y*sy }; });
    var Gm = gradientsOf(medium);
    var R = refineCorners(Gm, C, { in: 50, out: 15, ang: 3, maxLen: 260 });
    return {
      found: true,
      corners: R.map(function(p){ return { u: clamp01(p.x/medium.w), v: clamp01(p.y/medium.h) }; }),
      sure: R.map(function(p){ return p.sure; }),
      score: q.score
    };
  }
  // corners: normalized rough points (TL,TR,BR,BL)
  function refine(medium, corners){
    var Gm = gradientsOf(medium);
    var C = corners.map(function(p){ return { x: p.u*medium.w, y: p.v*medium.h }; });
    var R = refineCorners(Gm, C, { in: 60, out: 60, ang: 6, maxLen: 260 });
    return {
      found: true,
      corners: R.map(function(p){ return { u: clamp01(p.x/medium.w), v: clamp01(p.y/medium.h) }; }),
      sure: R.map(function(p){ return p.sure; })
    };
  }
  // Snaps rough points, using the whole-photo guess where it agrees: for
  // each corner, the guessed corner if it's sure and near the rough point
  // (it has seen the whole canvas, so it isn't misled by a strong edge that
  // happens to be closer), otherwise the local refinement.
  function snap(small, medium, corners, refAspect){
    var local = refine(medium, corners);
    var g = guess(small, medium, refAspect);
    if(!g.found) return local;
    var near = 0.12;
    var out = { found: true, corners: [], sure: [] };
    for(var i=0;i<4;i++){
      var gc = g.corners[i], rc = corners[i];
      var d = Math.hypot((gc.u - rc.u)*medium.w, (gc.v - rc.v)*medium.h)/Math.max(medium.w, medium.h);
      if(g.sure[i] && d < near){ out.corners.push(gc); out.sure.push(true); }
      else { out.corners.push(local.corners[i]); out.sure.push(local.sure[i]); }
    }
    return out;
  }

  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  root.Detect = { guess: guess, refine: refine, snap: snap };
})(typeof self !== "undefined" ? self : this);
