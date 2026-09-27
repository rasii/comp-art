(function(){
  "use strict";

  var WORK_DIM = 2000;     // long edge of the working reference and of the aligned output
  var SRC_MAX  = 3000;     // long edge kept for the raw painting photo (perspective source)
  var VIEW_MAX_ZOOM = 6;   // pinch-zoom limit on the compare / side-by-side views
  var PIN_MAX_ZOOM = 5;    // pinch-zoom limit on the align stage
  var OFF_MAX = 0.5;       // the painting can be shifted up to half the frame
  var LEGACY_KEY = "sightsize_v1"; // old localStorage save, migrated on first run

  // ---------------- state ----------------
  // Everything the screen shows is derived from this by render().
  // Images are {canvas, w, h} at working resolution; the canvases are the
  // source of truth for colour readings and for the perspective warp.
  var state = {
    ref: null,       // reference photo
    photo: null,     // painting photo (warp source)
    aligned: null,   // painting warped onto the reference's rectangle
    corners: null,   // 4 {u,v} normalized points in the photo, order TL,TR,BR,BL
    lastCorners: null, // {ar, pts} from the last alignment, reused for a same-shape photo
    pinOpacity: 100, // photo opacity on the align stage
    offU: 0, offV: 0, // aligned painting shifted against the reference, fraction of the frame
    adjusting: false, // compare: drag moves the painting instead of peeking
    opacityBeforeAdjust: null,
    mode: "align",
    grayscale: false,
    opacity: 100,    // painting opacity on the compare view
    peeking: false,  // finger held on the compare image: painting hidden
    reading: null,   // last colour reading {u, v, pointerType, r, p}
    busy: false      // alignment being baked
  };

  // ---------------- element refs ----------------
  var $ = function(id){ return document.getElementById(id); };
  var tabs = $("tabs"), stepHint = $("stepHint");
  var grayBtn = $("grayBtn"), restartBtn = $("restartBtn");

  var emptyStage = $("emptyStage"), setupPanel = $("setupPanel");
  var refRow = $("refRow"), curRow = $("curRow"), changeRefRow = $("changeRefRow");
  var addRefBtn = $("addRefBtn"), addCurBtn = $("addCurBtn"), changeRefBtn = $("changeRefBtn");
  var refInput = $("refInput"), curInput = $("curInput");

  var alignStageWrap = $("alignStageWrap");
  var pinStage = $("pinStage"), pinView = $("pinView"), pinInner = $("pinInner"), pinRefImg = $("pinRefImg"), pinImg = $("pinImg"), pinPoly = $("pinPoly");
  var handles = [$("handle0"), $("handle1"), $("handle2"), $("handle3")];
  var pinOpacitySlider = $("pinOpacitySlider");
  var resetAlignBtn = $("resetAlignBtn"), retakeBtn = $("retakeBtn");
  var confirmAlignBtn = $("confirmAlignBtn"), confirmAlignHTML = confirmAlignBtn.innerHTML;

  var viewAlign = $("view-align"), viewCompare = $("view-compare"), viewSide = $("view-side");
  var compareFrame = $("compareFrame"), compareView = $("compareView"), compareRef = $("compareRef"), compareCur = $("compareCur");
  var opacitySlider = $("opacitySlider");
  var adjustSwitch = $("adjustSwitch"), resetPosBtn = $("resetPosBtn"), retakeFromCompareBtn = $("retakeFromCompareBtn");
  var pickMarker = $("pickMarker");

  var sideFit = $("sideFit"), sideSplit = $("sideSplit");
  var sideRefFrame = $("sideRefFrame"), sideCurFrame = $("sideCurFrame");
  var sideRefView = $("sideRefView"), sideCurView = $("sideCurView");
  var sideRef = $("sideRef"), sideCur = $("sideCur");
  var sideRefMarker = $("sideRefMarker"), sideCurMarker = $("sideCurMarker");

  var colorCard = $("colorCard"), compareCardSlot = $("compareCardSlot"), sideCardSlot = $("sideCardSlot");
  var ccEmpty = $("ccEmpty"), ccBody = $("ccBody");
  var ccRefMun = $("ccRefMun"), ccPaintMun = $("ccPaintMun");
  var ccRefSw = $("ccRefSw"), ccPaintSw = $("ccPaintSw"), ccDiff = $("ccDiff"), ccNote = $("ccNote");

  var toastEl = $("toast");
  var confirmModal = $("confirmModal"), confirmMsg = $("confirmMsg"), confirmOk = $("confirmOk"), confirmCancel = $("confirmCancel");

  // Suppress long-press / right-click context menus and text selection
  // everywhere, so holding on an image never pops up browser actions.
  document.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  document.addEventListener("selectstart", function(e){ e.preventDefault(); });

  // ---------------- helpers ----------------
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ toastEl.classList.remove("show"); }, 2600);
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function show(el, on, display){ el.style.display = on ? (display || "") : "none"; }

  // setPointerCapture throws if the pointer has already gone (e.g. a touch
  // cancelled by the system mid-gesture); capture is a nicety, not required.
  function capturePointer(el, e){ try{ el.setPointerCapture(e.pointerId); }catch(err){} }

  // Decodes an image file into a canvas no larger than maxDim on its long edge.
  function decodeToCanvas(blob, maxDim){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      img.onload = function(){
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxDim / Math.max(w,h));
        var outW = Math.max(1, Math.round(w*scale)), outH = Math.max(1, Math.round(h*scale));
        var c = document.createElement("canvas");
        c.width = outW; c.height = outH;
        var ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, outW, outH);
        URL.revokeObjectURL(url);
        resolve({ canvas: c, w: outW, h: outH });
      };
      img.src = url;
    });
  }
  function canvasToBlob(canvas, type, quality){
    return new Promise(function(resolve, reject){
      canvas.toBlob(function(b){ b ? resolve(b) : reject(new Error("encode failed")); }, type, quality);
    });
  }
  function dataUrlToBlob(dataUrl){ return fetch(dataUrl).then(function(r){ return r.blob(); }); }

  // Display URL for an image object, created on first use. The screen shows a
  // high-quality JPEG of the canvas; colour readings come from the canvas itself.
  function urlOf(im){
    if(!im) return "";
    if(!im.url){
      im.url = im.canvas.toDataURL("image/jpeg", 0.95);
    }
    return im.url;
  }
  function setSrc(img, im){
    var url = urlOf(im);
    if(img.getAttribute("src") !== url) img.src = url;
  }

  // ---------------- persistence (IndexedDB) ----------------
  // Original photo files are stored as-is; the aligned result as PNG;
  // corners and offsets as a small record. Failures never block the app.
  var storeWarned = false;
  function storeFail(){
    if(!storeWarned) toast("Photos couldn't be saved on this device, but this session works fine.");
    storeWarned = true;
  }
  function persistMeta(){
    Store.set("meta", { v: 2, corners: state.corners, lastCorners: state.lastCorners, offU: state.offU, offV: state.offV }).catch(storeFail);
  }
  function persistBlob(key, blob){ return Store.set(key, blob).catch(storeFail); }
  function persistCanvas(key, canvas){
    return canvasToBlob(canvas, "image/png").then(function(b){ return persistBlob(key, b); }).catch(storeFail);
  }

  // ---------------- render ----------------
  // Derives every visible thing from state. Safe to call often.
  function render(){
    var m = state.mode, hasRef = !!state.ref, hasPhoto = !!state.photo, hasAligned = !!state.aligned;

    // tabs and views
    Array.prototype.forEach.call(tabs.querySelectorAll("button"), function(b){
      b.classList.toggle("active", b.dataset.mode === m);
      if(b.dataset.mode !== "align") b.disabled = !hasAligned;
    });
    show(viewAlign, m === "align");
    show(viewCompare, m === "compare");
    show(viewSide, m === "side");
    grayBtn.hidden = (m === "align");
    grayBtn.classList.toggle("on", state.grayscale);
    grayBtn.setAttribute("aria-pressed", state.grayscale ? "true" : "false");

    // header hint
    var hint;
    if(m === "align"){
      hint = !hasRef ? "reference → painting → compare"
           : !hasPhoto ? "now photograph your painting"
           : "drag the points to the canvas corners · pinch to zoom";
    } else if(m === "compare"){
      hint = state.adjusting ? "drag the painting to line it up" : "hold the painting to peek and read colour";
    } else {
      hint = "touch either image to read colours";
    }
    if(m !== "align" && viewZoom.z > 1) hint += " · double-tap to reset zoom";
    stepHint.textContent = hint;

    // ---- align ----
    show(emptyStage, !hasRef, "flex");
    show(setupPanel, !(hasRef && hasPhoto));
    show(refRow, !hasRef);
    show(curRow, hasRef);
    show(changeRefRow, hasRef);
    show(alignStageWrap, hasRef && hasPhoto);
    confirmAlignBtn.disabled = state.busy;
    if(state.busy){ if(confirmAlignBtn.textContent !== "Aligning…") confirmAlignBtn.textContent = "Aligning…"; }
    else if(confirmAlignBtn.innerHTML !== confirmAlignHTML) confirmAlignBtn.innerHTML = confirmAlignHTML;
    if(hasRef && hasPhoto){
      setSrc(pinImg, state.photo);
      setSrc(pinRefImg, state.ref);
      pinStage.style.setProperty("--ar", state.photo.w + " / " + state.photo.h);
      pinImg.style.opacity = String(state.pinOpacity/100);
      if(pinOpacitySlider.value != state.pinOpacity) pinOpacitySlider.value = state.pinOpacity;
      if(m === "align") layoutHandles();
    }

    // ---- compare / side ----
    if(hasRef && hasAligned){
      var ar = state.ref.w + "/" + state.ref.h;
      compareFrame.style.setProperty("--ar", ar);
      sideRefFrame.style.setProperty("--ar", ar);
      sideCurFrame.style.setProperty("--ar", ar);
      setSrc(compareRef, state.ref); setSrc(compareCur, state.aligned);
      setSrc(sideRef, state.ref);    setSrc(sideCur, state.aligned);
      if(m === "side") layoutSide();
    }
    if(opacitySlider.value != state.opacity) opacitySlider.value = state.opacity;
    compareCur.style.opacity = state.peeking ? "0" : String(state.opacity/100);
    adjustSwitch.classList.toggle("on", state.adjusting);
    compareFrame.classList.toggle("adjusting", state.adjusting);
    show(resetPosBtn, state.adjusting || state.offU !== 0 || state.offV !== 0);
    var shift = (state.offU || state.offV) ? "translate(" + (state.offU*100) + "%," + (state.offV*100) + "%)" : "";
    compareCur.style.transform = shift;
    sideCur.style.transform = shift;
    [compareRef, compareCur, sideRef, sideCur].forEach(function(img){ img.classList.toggle("gray", state.grayscale); });
    viewZoom.apply();

    // colour card: one card, shown in whichever view is active
    var slot = (m === "side") ? sideCardSlot : compareCardSlot;
    if(colorCard.parentElement !== slot) slot.appendChild(colorCard);
    ccEmpty.textContent = (m === "side") ? "Touch either image to read colours" : "Touch and hold the painting to read colours";
    renderReading();
  }

  function renderReading(){
    var rd = state.reading, m = state.mode;
    var showCompare = rd && m === "compare", showSide = rd && m === "side";
    pickMarker.hidden = !showCompare;
    sideRefMarker.hidden = !showSide;
    sideCurMarker.hidden = !showSide;
    ccBody.hidden = !rd;
    ccEmpty.hidden = !!rd;
    if(!rd) return;

    var pCss = rd.p ? rd.p.css : "transparent";
    if(showCompare){
      placeMarker(pickMarker, compareFrame, compareView, rd, "linear-gradient(90deg, " + rd.r.css + " 50%, " + pCss + " 50%)");
    } else {
      placeMarker(sideRefMarker, sideRefFrame, sideRefView, rd, rd.r.css);
      placeMarker(sideCurMarker, sideCurFrame, sideCurView, rd, pCss);
    }
    ccRefMun.textContent = rd.r.notation;
    ccRefSw.style.background = rd.r.css;
    if(rd.p){
      ccPaintMun.textContent = rd.p.notation;
      ccPaintSw.style.background = pCss;
      ccDiff.textContent = Munsell.describe(rd.r, rd.p);
    } else {
      ccPaintMun.textContent = "—";
      ccPaintSw.style.background = "transparent";
      ccDiff.textContent = "No painting at this spot.";
    }
    var side = 2*patchRadius(state.ref) + 1;
    ccNote.textContent = "Hue and chroma are the nearest Munsell chip; value is measured. Each reading averages a " + side + "×" + side + " pixel patch.";
  }

  // Marker at image-normalized (u,v), positioned in the frame's pixels so it
  // keeps its size whatever the view zoom. For touch, the ring sits above
  // the fingertip (or below it near the top edge).
  function placeMarker(mk, frame, view, rd, fill){
    var fr = frame.getBoundingClientRect(), vr = view.getBoundingClientRect();
    var x = vr.left - (fr.left + frame.clientLeft) + rd.u*vr.width;
    var y = vr.top  - (fr.top  + frame.clientTop)  + rd.v*vr.height;
    var touch = rd.pointerType === "touch";
    mk.classList.toggle("touch", touch);
    mk.classList.toggle("below", touch && y < 96);
    mk.style.left = x + "px";
    mk.style.top = y + "px";
    mk.querySelector(".pm-ring").style.background = fill;
  }

  // ---------------- lockstep pinch-zoom for a group of views ----------------
  // z/pu/pv are the same for every view in the group; pan is a fraction of
  // each frame, so frames of different pixel sizes stay in step.
  function makeZoom(views, maxZoom){
    var zm = { z: 1, pu: 0, pv: 0 };
    zm.clampPan = function(){
      zm.z = clamp(zm.z, 1, maxZoom);
      zm.pu = clamp(zm.pu, 1 - zm.z, 0);
      zm.pv = clamp(zm.pv, 1 - zm.z, 0);
    };
    zm.apply = function(){
      var t = (zm.z === 1) ? "" : "translate(" + (zm.pu*100) + "%," + (zm.pv*100) + "%) scale(" + zm.z + ")";
      views.forEach(function(v){ if(v.style.transform !== t) v.style.transform = t; });
    };
    zm.reset = function(){ zm.z = 1; zm.pu = 0; zm.pv = 0; };
    // zoom about a point (px, in the frame) by a factor
    zm.zoomAt = function(rect, x, y, factor){
      var newZ = clamp(zm.z*factor, 1, maxZoom);
      var cu = (x/rect.width - zm.pu)/zm.z, cv = (y/rect.height - zm.pv)/zm.z;
      zm.z = newZ;
      zm.pu = x/rect.width - cu*newZ;
      zm.pv = y/rect.height - cv*newZ;
      zm.clampPan();
    };
    // gesture from a start snapshot g to a new midpoint/distance
    zm.gesture = function(rect, g, mid, dist){
      var newZ = (dist > 0 && g.d0 > 0) ? clamp(g.z0 * dist/g.d0, 1, maxZoom) : zm.z;
      var cu = (g.mid0.x/rect.width - g.pu0)/g.z0, cv = (g.mid0.y/rect.height - g.pv0)/g.z0;
      zm.z = newZ;
      zm.pu = mid.x/rect.width - cu*newZ;
      zm.pv = mid.y/rect.height - cv*newZ;
      zm.clampPan();
    };
    zm.snapshot = function(mid, dist){ return { z0: zm.z, pu0: zm.pu, pv0: zm.pv, mid0: mid, d0: dist }; };
    return zm;
  }
  var pinZoom = makeZoom([pinView], PIN_MAX_ZOOM);
  var viewZoom = makeZoom([compareView, sideRefView, sideCurView], VIEW_MAX_ZOOM);

  // Pointer handling for a frame: two fingers (or wheel) zoom and pan the
  // group; one pointer goes to the `single` callbacks; a quick double tap
  // resets the zoom.
  function attachGestures(frame, zoom, single, onChange){
    var ptrs = {}, gesture = null, lastTap = 0, lastX = 0, lastY = 0;
    function count(){ return Object.keys(ptrs).length; }
    function local(){
      var rect = frame.getBoundingClientRect(), ids = Object.keys(ptrs), sx = 0, sy = 0;
      ids.forEach(function(id){ sx += ptrs[id].x; sy += ptrs[id].y; });
      var mid = { x: sx/ids.length - rect.left, y: sy/ids.length - rect.top };
      var dist = ids.length >= 2 ? Math.hypot(ptrs[ids[0]].x - ptrs[ids[1]].x, ptrs[ids[0]].y - ptrs[ids[1]].y) : 0;
      return { rect: rect, mid: mid, dist: dist };
    }
    function begin(){ var l = local(); gesture = zoom.snapshot(l.mid, l.dist); }

    frame.addEventListener("pointerdown", function(e){
      if(single.ignore && single.ignore(e)) return;
      e.preventDefault();
      capturePointer(frame, e);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if(count() === 1){
        var now = Date.now();
        if(now - lastTap < 350 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 30 && zoom.z > 1){
          lastTap = 0; zoom.reset(); onChange(); return;
        }
        lastTap = now; lastX = e.clientX; lastY = e.clientY;
        if(zoom.z > 1 && single.panOnly){ begin(); return; }
        if(single.start) single.start(e);
      } else {
        if(single.cancel) single.cancel(e);
        begin();
      }
    });
    frame.addEventListener("pointermove", function(e){
      if(!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if(gesture){
        var l = local();
        zoom.gesture(l.rect, gesture, l.mid, l.dist);
        onChange();
      } else if(single.move){
        single.move(e);
      }
    });
    function end(e){
      if(!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId];
      if(gesture){
        if(count() >= 1) begin(); else gesture = null; // remaining finger pans
      } else if(single.end){
        single.end(e);
      }
    }
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);

    frame.addEventListener("wheel", function(e){
      if(single.wheelIgnore && single.wheelIgnore()) return;
      e.preventDefault();
      var rect = frame.getBoundingClientRect();
      var factor = 1 - clamp(e.deltaY, -80, 80)*0.0025;
      zoom.zoomAt(rect, e.clientX - rect.left, e.clientY - rect.top, factor);
      onChange();
    }, { passive: false });
  }

  // ---------------- mode ----------------
  function setMode(m){
    if((m === "compare" || m === "side") && !state.aligned) return;
    if(m !== state.mode){
      state.mode = m;
      state.reading = null;
      state.peeking = false;
    }
    render();
  }
  tabs.addEventListener("click", function(e){
    var b = e.target.closest("button[data-mode]");
    if(!b || b.disabled) return;
    setMode(b.dataset.mode);
  });
  grayBtn.addEventListener("click", function(){ state.grayscale = !state.grayscale; render(); });

  // ---------------- loading photos ----------------
  addRefBtn.addEventListener("click", function(){ refInput.click(); });
  changeRefBtn.addEventListener("click", function(){ refInput.click(); });
  refInput.addEventListener("change", function(){
    var f = refInput.files && refInput.files[0];
    refInput.value = "";
    if(!f) return;
    decodeToCanvas(f, WORK_DIM).then(function(im){
      state.ref = im;
      state.aligned = null; state.photo = null; state.corners = null;
      state.offU = 0; state.offV = 0; state.reading = null;
      state.mode = "align";
      render();
      persistBlob("ref", f);
      Store.remove("photo").catch(function(){});
      Store.remove("aligned").catch(function(){});
      persistMeta();
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });

  addCurBtn.addEventListener("click", function(){ curInput.click(); });
  retakeBtn.addEventListener("click", function(){ curInput.click(); });
  retakeFromCompareBtn.addEventListener("click", function(){ setMode("align"); curInput.click(); });
  curInput.addEventListener("change", function(){
    var f = curInput.files && curInput.files[0];
    curInput.value = "";
    if(!f) return;
    decodeToCanvas(f, SRC_MAX).then(function(im){
      setPhoto(im, null);
      state.aligned = null; state.reading = null;
      state.mode = "align";
      render();
      persistBlob("photo", f);
      Store.remove("aligned").catch(function(){});
      persistMeta();
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });

  // Installs a painting photo as the warp source. Corners: the given ones,
  // else the last alignment's if the photo has the same shape (same camera,
  // same setup), else the extreme corners of the photo.
  function setPhoto(im, corners){
    state.photo = im;
    var last = state.lastCorners;
    var sameShape = last && last.ar && Math.abs(last.ar - im.w/im.h) < 0.01;
    state.corners = corners ? corners.map(copyPt) : sameShape ? last.pts.map(copyPt) : defaultCorners();
    state.pinOpacity = 100;
    pinZoom.reset();
  }
  function copyPt(p){ return { u: p.u, v: p.v }; }
  function defaultCorners(){
    return [ {u:0,v:0}, {u:1,v:0}, {u:1,v:1}, {u:0,v:1} ];
  }
  function validCorners(c){
    return Array.isArray(c) && c.length === 4 && c.every(function(p){ return p && isFinite(p.u) && isFinite(p.v); });
  }

  // ---------------- align: corner-pin stage ----------------
  // Layers: pin-view is zoomed/panned as a whole (a viewing aid only). Inside
  // it, pin-inner holds the photo and, beneath it, the reference warped into
  // the four-point quad — so fading the photo shows the reference at the
  // painting's size and perspective. Handles are siblings of the clipped
  // view so their on-screen size stays constant regardless of zoom.
  function cornersToPx(corners, w, h){
    return corners.map(function(p){ return { x: p.u*w, y: p.v*h }; });
  }
  function layoutHandles(){
    if(!state.corners) return;
    pinPoly.setAttribute("points", state.corners.map(function(p){ return (p.u*100) + "," + (p.v*100); }).join(" "));
    layoutRefOverlay();
    // absolute children are placed from the padding edge, inside the border
    var stageRect = pinStage.getBoundingClientRect(), innerRect = pinInner.getBoundingClientRect();
    var ox = stageRect.left + pinStage.clientLeft, oy = stageRect.top + pinStage.clientTop;
    handles.forEach(function(h, i){
      var p = state.corners[i];
      h.style.left = (innerRect.left - ox + p.u*innerRect.width) + "px";
      h.style.top  = (innerRect.top  - oy + p.v*innerRect.height) + "px";
    });
  }
  // Maps the reference image (w x h box) onto the corner quad with a CSS
  // matrix3d built from the same homography used for the final warp.
  function layoutRefOverlay(){
    var w = pinInner.offsetWidth, h = pinInner.offsetHeight;
    if(!w || !h || !state.ref) return;
    var rw = state.ref.w, rh = state.ref.h;
    var src = [ {x:0,y:0}, {x:rw,y:0}, {x:rw,y:rh}, {x:0,y:rh} ];
    var m = Warp.computeHomography(src, cornersToPx(state.corners, w, h));
    pinRefImg.style.width = rw + "px";
    pinRefImg.style.height = rh + "px";
    pinRefImg.style.transform = "matrix3d(" + [
      m[0], m[3], 0, m[6],
      m[1], m[4], 0, m[7],
      0,    0,    1, 0,
      m[2], m[5], 0, m[8]
    ].join(",") + ")";
  }

  var activeHandle = null;
  handles.forEach(function(h, i){
    h.addEventListener("pointerdown", function(e){
      e.preventDefault(); e.stopPropagation();
      activeHandle = i;
      capturePointer(h, e);
    });
    h.addEventListener("pointermove", function(e){
      if(activeHandle !== i) return;
      var rect = pinInner.getBoundingClientRect();
      state.corners[i] = {
        u: clamp((e.clientX - rect.left) / rect.width, 0, 1),
        v: clamp((e.clientY - rect.top) / rect.height, 0, 1)
      };
      layoutHandles();
    });
    function release(){ if(activeHandle === i){ activeHandle = null; persistMeta(); } }
    h.addEventListener("pointerup", release);
    h.addEventListener("pointercancel", release);
  });

  attachGestures(pinStage, pinZoom, {
    ignore: function(e){ return !!e.target.closest(".handle") || !state.photo; },
    panOnly: true
  }, function(){ pinZoom.apply(); layoutHandles(); });

  pinOpacitySlider.addEventListener("input", function(){ state.pinOpacity = Number(pinOpacitySlider.value); render(); });
  resetAlignBtn.addEventListener("click", function(){
    if(!state.photo) return;
    state.corners = defaultCorners();
    pinZoom.reset();
    render();
    persistMeta();
  });

  // The stage is fitted to the screen, so keep the handles on their corners
  // when the window resizes or the iPad rotates.
  function relayoutPin(){ if(state.mode === "align" && state.photo){ pinZoom.apply(); layoutHandles(); } }
  if(window.ResizeObserver) new ResizeObserver(relayoutPin).observe(pinStage);
  window.addEventListener("resize", function(){ relayoutPin(); render(); });

  // ---------------- the warp, off the main thread when possible ----------------
  var worker = null, pendingWarp = null, warpSeq = 0;
  function getWorker(){
    if(worker || getWorker.failed) return worker;
    try{
      worker = new Worker("warp-worker.js");
      worker.onmessage = function(e){
        var p = pendingWarp; pendingWarp = null;
        if(p && p.id === e.data.id) p.resolve(e.data);
      };
      worker.onerror = function(){
        getWorker.failed = true; worker = null;
        var p = pendingWarp; pendingWarp = null;
        if(p) p.reject(new Error("worker failed"));
      };
    }catch(e){ getWorker.failed = true; worker = null; }
    return worker;
  }
  function warpToCanvas(w, h, bytes){
    var out = document.createElement("canvas");
    out.width = w; out.height = h;
    var img = new ImageData(new Uint8ClampedArray(bytes), w, h);
    out.getContext("2d").putImageData(img, 0, 0);
    return { canvas: out, w: w, h: h };
  }
  function warpAsync(srcIm, cornersPx, dstW, dstH){
    var sData = srcIm.canvas.getContext("2d").getImageData(0, 0, srcIm.w, srcIm.h).data;
    var wk = getWorker();
    if(wk){
      return new Promise(function(resolve, reject){
        var id = ++warpSeq;
        pendingWarp = { id: id, resolve: resolve, reject: reject };
        wk.postMessage({ id: id, src: sData.buffer, sW: srcIm.w, sH: srcIm.h, corners: cornersPx, dstW: dstW, dstH: dstH }, [sData.buffer]);
      }).then(function(msg){ return warpToCanvas(msg.w, msg.h, msg.data); })
        .catch(function(){ return warpSync(srcIm, cornersPx, dstW, dstH); });
    }
    return Promise.resolve().then(function(){ return warpSync(srcIm, cornersPx, dstW, dstH); });
  }
  function warpSync(srcIm, cornersPx, dstW, dstH){
    var sData = srcIm.canvas.getContext("2d").getImageData(0, 0, srcIm.w, srcIm.h).data;
    return warpToCanvas(dstW, dstH, Warp.warpPerspective(sData, srcIm.w, srcIm.h, cornersPx, dstW, dstH).buffer);
  }

  confirmAlignBtn.addEventListener("click", function(){
    if(!state.photo || !state.ref || state.busy) return;
    state.busy = true;
    render();
    var cornersPx = cornersToPx(state.corners, state.photo.w, state.photo.h);
    warpAsync(state.photo, cornersPx, state.ref.w, state.ref.h).then(function(im){
      state.aligned = im;
      state.offU = 0; state.offV = 0;
      state.adjusting = false; state.opacityBeforeAdjust = null;
      state.lastCorners = { ar: state.photo.w/state.photo.h, pts: state.corners.map(copyPt) };
      state.reading = null;
      viewZoom.reset();
      state.busy = false;
      state.mode = "compare";
      render();
      persistMeta();
      persistCanvas("aligned", im.canvas);
    }).catch(function(){
      state.busy = false;
      render();
      toast("Alignment failed. Try again.");
    });
  });

  // ---------------- compare: opacity, position, peek, colour reading ----------------
  opacitySlider.addEventListener("input", function(){ state.opacity = Number(opacitySlider.value); render(); });

  adjustSwitch.addEventListener("click", function(){
    state.adjusting = !state.adjusting;
    if(state.adjusting){
      // the reference has to show through to line things up
      if(state.opacity > 70){ state.opacityBeforeAdjust = state.opacity; state.opacity = 50; }
      state.reading = null; // moving the painting makes the reading stale
    } else if(state.opacityBeforeAdjust !== null){
      if(state.opacity === 50) state.opacity = state.opacityBeforeAdjust;
      state.opacityBeforeAdjust = null;
    }
    render();
  });
  resetPosBtn.addEventListener("click", function(){
    state.offU = 0; state.offV = 0;
    render();
    persistMeta();
  });

  // Colour reading: averages a small patch of the working canvases (which
  // are unaffected by the on-screen opacity, grayscale, offset or zoom).
  function toLin(c){ c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function toSrgb(l){ var c = l <= 0.0031308 ? 12.92*l : 1.055*Math.pow(l, 1/2.4) - 0.055; return Math.round(clamp(c, 0, 1)*255); }
  function patchRadius(im){ return Math.max(1, Math.round(Math.max(im.w, im.h) / 300)); }
  function samplePatch(im, u, v){
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    var cx = Math.floor(u*im.w), cy = Math.floor(v*im.h), r = patchRadius(im);
    var x0 = Math.max(0, cx-r), y0 = Math.max(0, cy-r);
    var x1 = Math.min(im.w-1, cx+r), y1 = Math.min(im.h-1, cy+r);
    var d = im.canvas.getContext("2d").getImageData(x0, y0, x1-x0+1, y1-y0+1).data;
    var sr=0, sg=0, sb=0, n=0;
    for(var i=0;i<d.length;i+=4){ sr += toLin(d[i]); sg += toLin(d[i+1]); sb += toLin(d[i+2]); n++; }
    return { r: sr/n, g: sg/n, b: sb/n };
  }
  function readColour(lin){
    var m = Munsell.fromLinearRGB(lin.r, lin.g, lin.b);
    m.css = "rgb(" + toSrgb(lin.r) + "," + toSrgb(lin.g) + "," + toSrgb(lin.b) + ")";
    return m;
  }
  // Reads both images at the same spot under the pointer (the painting is
  // drawn shifted by the position offset, so it's sampled shifted back).
  function readAt(e, view){
    if(!state.ref || !state.aligned) return;
    var vr = view.getBoundingClientRect();
    var u = (e.clientX - vr.left) / vr.width, v = (e.clientY - vr.top) / vr.height;
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return;
    var refLin = samplePatch(state.ref, u, v);
    var curLin = samplePatch(state.aligned, u - state.offU, v - state.offV);
    state.reading = { u: u, v: v, pointerType: e.pointerType, r: readColour(refLin), p: curLin ? readColour(curLin) : null };
    renderReading();
  }

  // compare frame: hold to peek + read; drag to reposition when adjusting
  var posDrag = null;
  attachGestures(compareFrame, viewZoom, {
    start: function(e){
      if(!state.aligned) return;
      if(state.adjusting){
        posDrag = { x: e.clientX, y: e.clientY, u0: state.offU, v0: state.offV };
      } else {
        state.peeking = true;
        render();
        readAt(e, compareView);
      }
    },
    move: function(e){
      if(posDrag){
        var rect = compareView.getBoundingClientRect();
        state.offU = clamp(posDrag.u0 + (e.clientX - posDrag.x) / rect.width, -OFF_MAX, OFF_MAX);
        state.offV = clamp(posDrag.v0 + (e.clientY - posDrag.y) / rect.height, -OFF_MAX, OFF_MAX);
        render();
      } else if(state.peeking){
        readAt(e, compareView);
      }
    },
    end: function(){
      if(posDrag){ posDrag = null; persistMeta(); }
      if(state.peeking){ state.peeking = false; render(); }
    },
    cancel: function(){
      posDrag = null;
      if(state.peeking){ state.peeking = false; render(); }
    }
  }, render);

  // Side by side: the two frames go in a row or stacked, whichever lets
  // them be bigger in the space available for the photo's shape.
  function layoutSide(){
    if(!state.ref) return;
    var W = sideFit.clientWidth, H = sideFit.clientHeight, ar = state.ref.w / state.ref.h;
    if(!W || !H) return;
    var rowW = Math.min(W/2 - 5, (H - 22) * ar);
    var colW = Math.min(W, (H/2 - 5 - 22) * ar);
    sideSplit.classList.toggle("row", rowW >= colW);
  }
  if(window.ResizeObserver) new ResizeObserver(function(){ if(state.mode === "side") render(); }).observe(sideFit);

  // side by side: touching either image reads the same spot in both
  [ [sideRefFrame, sideRefView], [sideCurFrame, sideCurView] ].forEach(function(pair){
    attachGestures(pair[0], viewZoom, {
      start: function(e){ readAt(e, pair[1]); },
      move: function(e){ readAt(e, pair[1]); }
    }, render);
  });

  // ---------------- restart ----------------
  var confirmAction = null;
  function askConfirm(msg, okLabel, action){
    confirmMsg.textContent = msg;
    confirmOk.textContent = okLabel;
    confirmAction = action;
    confirmModal.classList.add("show");
  }
  function closeConfirm(){ confirmModal.classList.remove("show"); confirmAction = null; }
  confirmOk.addEventListener("click", function(){ var a = confirmAction; closeConfirm(); if(a) a(); });
  confirmCancel.addEventListener("click", closeConfirm);
  confirmModal.addEventListener("click", function(e){ if(e.target === confirmModal) closeConfirm(); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape" && confirmModal.classList.contains("show")) closeConfirm(); });

  function restart(){
    state.ref = null; state.photo = null; state.aligned = null;
    state.corners = null; state.lastCorners = null;
    state.offU = 0; state.offV = 0; state.adjusting = false; state.opacityBeforeAdjust = null;
    state.reading = null; state.peeking = false; state.mode = "align";
    pinZoom.reset(); viewZoom.reset();
    render();
    Store.clear().catch(function(){});
    try{ localStorage.removeItem(LEGACY_KEY); }catch(e){}
  }
  restartBtn.addEventListener("click", function(){
    askConfirm("Start a new painting? This clears your reference and painting photos.", "Start new", restart);
  });

  // ---------------- boot ----------------
  // One-time import of a save made by the old localStorage version.
  function migrateLegacy(){
    var raw = null;
    try{ raw = localStorage.getItem(LEGACY_KEY); }catch(e){}
    if(!raw) return Promise.resolve();
    var saved; try{ saved = JSON.parse(raw); }catch(e){ return Promise.resolve(); }
    var jobs = [];
    if(saved.ref) jobs.push(dataUrlToBlob(saved.ref).then(function(b){ return Store.set("ref", b); }));
    if(saved.aligned) jobs.push(dataUrlToBlob(saved.aligned).then(function(b){ return Store.set("aligned", b); }));
    jobs.push(Store.set("meta", { v: 2, corners: null, lastCorners: saved.lastCorners || null, offU: Number(saved.offU) || 0, offV: Number(saved.offV) || 0 }));
    return Promise.all(jobs).then(function(){ try{ localStorage.removeItem(LEGACY_KEY); }catch(e){} }).catch(function(){});
  }

  function boot(){
    render();
    migrateLegacy().then(function(){
      return Promise.all([Store.get("meta"), Store.get("ref"), Store.get("photo"), Store.get("aligned")]);
    }).then(function(res){
      var meta = res[0] || {}, refBlob = res[1], photoBlob = res[2], alignedBlob = res[3];
      if(!refBlob) return;
      state.lastCorners = (meta.lastCorners && validCorners(meta.lastCorners.pts)) ? meta.lastCorners : null;
      state.offU = Number(meta.offU) || 0; state.offV = Number(meta.offV) || 0;
      return decodeToCanvas(refBlob, WORK_DIM).then(function(ref){
        state.ref = ref;
        var jobs = [];
        if(photoBlob) jobs.push(decodeToCanvas(photoBlob, SRC_MAX).then(function(im){
          setPhoto(im, validCorners(meta.corners) ? meta.corners : null);
        }).catch(function(){}));
        if(alignedBlob) jobs.push(decodeToCanvas(alignedBlob, WORK_DIM).then(function(im){
          state.aligned = im;
        }).catch(function(){}));
        return Promise.all(jobs);
      }).then(function(){
        if(state.aligned) state.mode = "compare";
      });
    }).catch(function(){}).then(render);
  }
  boot();

  // Offline support: cache the app files so the home-screen app opens
  // without a network connection.
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
