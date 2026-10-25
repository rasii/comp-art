// Progress: the painting's stages, one per aligned photo, for the Progress
// tab and its timelapse.
//
// Each stage is the aligned painting (straightened and cropped to the
// reference's rectangle), so stages line up exactly. Stored with the
// project: the list under key "progress" ({items: [{id, t, key}], deleted:
// [ids]}; an older plain array is read too), each image as a
// JPEG under "prog-<id>" (full detail, up to 4000 px) and a small
// thumbnail under "progt-<id>". `key` identifies the painting photo it came
// from, so aligning the same photo again updates its stage instead of
// adding one.
//
// Also here: "even out lighting" (per-stage colour gains so changes in
// daylight or lamps don't flicker) and the timelapse recorder.
window.Progress = (function(){
  "use strict";

  // deleted: ids of stages deleted here, so a sync can't bring them back
  var store = null, list = [], deleted = [], blobs = {}, thumbs = {}, ready = Promise.resolve();

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function valid(it){ return it && typeof it.id === "string" && typeof it.t === "number"; }
  function saveList(){ return store.set("progress", { items: list.slice(), deleted: deleted.slice() }); }

  // (again for each project: forgets the previous project's stages)
  function init(s){
    store = s; list = []; deleted = []; blobs = {}; thumbs = {};
    return (ready = s.get("progress").then(function(r){
      if(store !== s) return;                                   // another project opened meanwhile
      var items = Array.isArray(r) ? r : (r && Array.isArray(r.items) ? r.items : []);
      list = items.filter(valid);
      deleted = (r && Array.isArray(r.deleted)) ? r.deleted.slice() : [];
    }).catch(function(){ list = []; }));
  }
  // Stages synced from another device (their images are already stored):
  // the union of both lists, the newer of any stage on both, minus deleted
  // ones. Returns whether anything changed.
  function merge(items, del){
    var s = store;
    return ready.then(function(){
      if(store !== s) return false;
      var changed = false, byId = {};
      (del || []).forEach(function(id){ if(deleted.indexOf(id) < 0){ deleted.push(id); changed = true; } });
      list.forEach(function(it){ byId[it.id] = it; });
      (items || []).filter(valid).forEach(function(it){
        var here = byId[it.id];
        if(!here || here.t < it.t){ byId[it.id] = { id: it.id, t: it.t, key: it.key || null }; delete blobs[it.id]; delete thumbs[it.id]; changed = true; }
      });
      var next = Object.keys(byId).map(function(id){ return byId[id]; })
        .filter(function(it){ return deleted.indexOf(it.id) < 0; })
        .sort(function(a, b){ return a.t - b.t; });
      if(next.length !== list.length) changed = true;
      if(!changed) return false;
      list = next;
      return saveList().then(function(){ return true; });
    });
  }
  function items(){ return list.slice(); }
  function count(){ return list.length; }
  // a new stage, or the latest one replaced when it came from the same photo
  function add(blob, key, thumb){
    var last = list[list.length - 1], item, replaced = false;
    if(last && key && last.key === key){ item = last; item.t = Date.now(); replaced = true; }
    else { item = { id: uid(), t: Date.now(), key: key || null }; list.push(item); }
    blobs[item.id] = blob;
    var jobs = [store.set("prog-" + item.id, blob), saveList()];
    if(thumb){ thumbs[item.id] = thumb; jobs.push(store.set("progt-" + item.id, thumb)); }
    else { delete thumbs[item.id]; jobs.push(store.remove("progt-" + item.id)); }
    return Promise.all(jobs).then(function(){ return { item: item, replaced: replaced }; });
  }
  function remove(id){
    list = list.filter(function(it){ return it.id !== id; });
    if(deleted.indexOf(id) < 0) deleted.push(id);
    delete blobs[id]; delete thumbs[id];
    return Promise.all([store.remove("prog-" + id), store.remove("progt-" + id), saveList()]);
  }
  function clear(){
    var ids = list.map(function(it){ return it.id; });
    deleted = deleted.concat(ids.filter(function(id){ return deleted.indexOf(id) < 0; }));
    list = []; blobs = {}; thumbs = {};
    return Promise.all(ids.map(function(id){ return Promise.all([store.remove("prog-" + id), store.remove("progt-" + id)]); }).concat([saveList()]));
  }
  // the small version for the thumbnail strip, or null if there isn't one
  // yet (stages from before v2.31); setThumb stores one made later
  function thumb(id){
    if(thumbs[id]) return Promise.resolve(thumbs[id]);
    return store.get("progt-" + id).then(function(b){ if(b) thumbs[id] = b; return b || null; }).catch(function(){ return null; });
  }
  function setThumb(id, b){ thumbs[id] = b; return store.set("progt-" + id, b).catch(function(){}); }
  function blob(id){
    if(blobs[id]) return Promise.resolve(blobs[id]);
    return store.get("prog-" + id).then(function(b){ if(b) blobs[id] = b; return b || null; });
  }
  function loadAll(){ return Promise.all(list.map(function(it){ return blob(it.id); })); }
  function cached(id){ return blobs[id] || null; }

  // ---------------- even out lighting ----------------
  var LIN = new Float32Array(256);
  for(var i=0;i<256;i++){ var c = i/255; LIN[i] = c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function toByte(l){ var c = l <= 0.0031308 ? 12.92*l : 1.055*Math.pow(l, 1/2.4) - 0.055; return c <= 0 ? 0 : c >= 1 ? 255 : Math.round(c*255); }

  // Per-stage gains [r, g, b] that bring each stage's lighting to the
  // latest stage's. Between two neighbouring stages most of the painting is
  // unchanged, so the typical (median) ratio of their pixels is the change
  // in lighting, not in paint. The ratios are chained back from the last
  // stage. smalls: same-size RGBA pixel arrays, one per stage, in order.
  function gains(smalls){
    var n = smalls.length, G = new Array(n);
    G[n-1] = [1, 1, 1];
    var BINS = 600, LR = 1.2, hist = [new Uint32Array(BINS), new Uint32Array(BINS), new Uint32Array(BINS)];   // ln ratios in ±LR
    for(var s=n-2; s>=0; s--){
      var a = smalls[s], b = smalls[s+1], r = [1, 1, 1];
      hist.forEach(function(h){ h.fill(0); });
      var cnt = 0;
      for(var p=0; p<a.length; p+=4){
        for(var ch=0; ch<3; ch++){
          var x = LIN[a[p+ch]], y = LIN[b[p+ch]];
          if(x < 0.02 || y < 0.02 || x > 0.95 || y > 0.95) continue;
          var lr = Math.log(y/x), bin = Math.round((lr + LR)/(2*LR)*(BINS-1));
          if(bin < 0 || bin >= BINS) continue;
          hist[ch][bin]++; if(ch === 0) cnt++;
        }
      }
      if(cnt > 200) for(ch=0; ch<3; ch++){
        var total = 0, h = hist[ch], half, acc = 0, k;
        for(k=0;k<BINS;k++) total += h[k];
        half = total/2;
        for(k=0;k<BINS && acc < half;k++) acc += h[k];
        r[ch] = Math.min(2.5, Math.max(0.4, Math.exp((k - 1)/(BINS-1)*2*LR - LR)));
      }
      G[s] = [G[s+1][0]*r[0], G[s+1][1]*r[1], G[s+1][2]*r[2]];
    }
    return G;
  }
  // applies gains (and optionally black & white) to a canvas in place
  function adjust(canvas, gain, gray){
    var g = gain || [1, 1, 1];
    if(!gray && g[0] === 1 && g[1] === 1 && g[2] === 1) return canvas;
    var ctx = canvas.getContext("2d"), img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    var lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for(var v=0; v<256; v++) for(var ch=0; ch<3; ch++) lut[ch][v] = toByte(LIN[v]*g[ch]);
    for(var p=0; p<d.length; p+=4){
      var R = lut[0][d[p]], G = lut[1][d[p+1]], B = lut[2][d[p+2]];
      if(gray){ var y = Math.round(0.2126*R + 0.7152*G + 0.0722*B); R = G = B = y; }
      d[p] = R; d[p+1] = G; d[p+2] = B;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // ---------------- timelapse ----------------
  function videoType(){
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    var types = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for(var i=0;i<types.length;i++) if(MediaRecorder.isTypeSupported(types[i])) return types[i];
    return null;
  }
  // The video's timing. `per`: seconds each photo is on screen, its
  // cross-fade into the next included. The first photo stays a little
  // longer, the finished painting longer still, and the reference (when
  // included) fades in slowly and stays. Returns, per position (the
  // stages, then the reference), when it starts, how long it holds and how
  // long it then fades into the next; and the total length.
  function timeline(stages, withRef, per){
    var n = stages + (withRef ? 1 : 0), fadeN = Math.min(0.45, per*0.4);
    var start = [], hold = [], fade = [], t = 0;
    for(var k=0;k<n;k++){
      var isRef = withRef && k === n-1, lastStage = k === stages-1;
      start.push(t);
      fade[k] = k === n-1 ? 0 : (withRef && k === n-2) ? 0.9 : fadeN;
      hold[k] = isRef ? 2.6 : lastStage ? Math.max(1.6, per*1.5) : (per - fadeN) + (k === 0 ? 0.6 : 0);
      t += hold[k] + fade[k];
    }
    return { n: n, start: start, hold: hold, fade: fade, duration: t };
  }
  // Plays the stages on `canvas` (sized by the caller) with a cross-fade
  // between each, optionally ending on the reference, and records it.
  // frame(k) returns a Promise of a drawable for position k (the stages,
  // then the reference); frames are prepared one ahead, so only a few are
  // in memory at once. Returns {promise, cancel}; the promise gives
  // {blob, type, seconds}.
  function record(canvas, stages, withRef, per, frame, onProgress){
    var type = videoType();
    if(!type) return { promise: Promise.reject(new Error("no recorder")), cancel: function(){} };
    var ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    var tl = timeline(stages, withRef, per), n = tl.n, start = tl.start, hold = tl.hold;
    var duration = tl.duration, ready = {}, pending = {}, cancelled = false, rec, chunks = [];
    function want(k){
      if(k >= n || ready[k] || pending[k]) return;
      pending[k] = frame(k).then(function(img){ ready[k] = img; delete pending[k]; });
    }
    function draw(img, alpha){
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, W, H);
    }
    var promise = new Promise(function(resolve, reject){
      var stream = canvas.captureStream(30);
      try{ rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10000000 }); }
      catch(e){ rec = new MediaRecorder(stream); }
      rec.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function(){
        stream.getTracks().forEach(function(tr){ tr.stop(); });
        if(cancelled){ reject(new Error("cancelled")); return; }
        var seconds = startedAt ? (performance.now() - startedAt)/1000 - 0.3 : duration;   // as recorded
        resolve({ blob: new Blob(chunks, { type: type.split(";")[0] }), type: type.split(";")[0], seconds: Math.max(duration, seconds) });
      };
      want(0); want(1);
      // the clock only runs while the frames it needs are ready, so a slow
      // decode makes a frame linger a moment rather than skip
      var clock = 0, last = null, started = false, startedAt = 0;
      function tick(now){
        if(cancelled){ if(rec.state !== "inactive") rec.stop(); else reject(new Error("cancelled")); return; }
        var k = 0;
        while(k < n-1 && clock >= start[k+1]) k++;
        var into = clock - start[k], fading = k < n-1 && into > hold[k];
        want(k); want(k+1); want(k+2);
        var cur = ready[k], next = fading ? ready[k+1] : null;
        if(!cur || (fading && !next)){ last = now; requestAnimationFrame(tick); return; }
        if(!started){ rec.start(250); started = true; last = now; startedAt = performance.now(); }
        ctx.globalAlpha = 1; ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, W, H);
        draw(cur, 1);
        if(fading) draw(next, Math.min(1, (into - hold[k])/tl.fade[k]));
        ctx.globalAlpha = 1;
        // drop frames that have gone by
        Object.keys(ready).forEach(function(j){ if(Number(j) < k) delete ready[j]; });
        if(onProgress) onProgress(Math.min(1, clock/duration));
        if(clock >= duration){ setTimeout(function(){ if(rec.state !== "inactive") rec.stop(); }, 300); return; }
        // real time, but never past a whole stage in one step: on a slow
        // moment (decoding a photo) every stage is still drawn, and the
        // video runs a touch longer rather than skipping one
        clock += (now - last)/1000; last = now;
        if(k + 2 < n) clock = Math.min(clock, start[k + 2]);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    return { promise: promise, cancel: function(){ cancelled = true; if(rec && rec.state !== "inactive") rec.stop(); } };
  }

  return { merge: merge, init: init, items: items, count: count, add: add, remove: remove, clear: clear, blob: blob, cached: cached, thumb: thumb, setThumb: setThumb,
           loadAll: loadAll, gains: gains, adjust: adjust, videoType: videoType, timeline: timeline, record: record };
})();
