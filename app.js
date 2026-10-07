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
    cornerSure: null, // after auto-detection: per corner, false = not sure (shown amber)
    detecting: false, // auto-detection running
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
    busy: false,     // alignment being baked
    // Shapes tab: the reference grouped into its big shapes. Values vs colour
    // follows the black & white button (state.grayscale).
    shapes: { count: 30, outlines: true, fill: false, bgOne: true, opacity: 100, chroma: 100 }, // chroma: % of the average colour's chroma
    shapesResult: null, // latest analysis (labels, average colours, outlines)
    shapesBusy: false,
    shapesPick: null    // id of the tapped shape
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
  var pinStage = $("pinStage"), pinView = $("pinView"), pinInner = $("pinInner"), pinRefImg = $("pinRefImg"), pinImg = $("pinImg");
  var pinPoly = $("pinPoly"), pinPolyHalo = $("pinPolyHalo"), loupe = $("loupe");
  var handles = [$("handle0"), $("handle1"), $("handle2"), $("handle3")];
  var pinOpacitySlider = $("pinOpacitySlider");
  var findEdgesBtn = $("findEdgesBtn"), zoomFitBtn = $("zoomFitBtn"), resetAlignBtn = $("resetAlignBtn"), retakeBtn = $("retakeBtn");
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

  var viewShapes = $("view-shapes"), shapesFrame = $("shapesFrame"), shapesView = $("shapesView");
  var shapesRef = $("shapesRef"), shapesCanvas = $("shapesCanvas"), shapesSlider = $("shapesSlider"), shapesCount = $("shapesCount");
  var shapesOpacitySlider = $("shapesOpacitySlider");
  var chromaRow = $("chromaRow"), chromaSlider = $("chromaSlider"), chromaLabel = $("chromaLabel");
  var outlinesSwitch = $("outlinesSwitch"), fillSwitch = $("fillSwitch"), bgOneSwitch = $("bgOneSwitch");
  var shapeSwatch = $("shapeSwatch"), shapeText = $("shapeText");

  var colorCard = $("colorCard"), compareCardSlot = $("compareCardSlot"), sideCardSlot = $("sideCardSlot");
  var ccEmpty = $("ccEmpty"), ccBody = $("ccBody");
  var ccRefMun = $("ccRefMun"), ccPaintMun = $("ccPaintMun");
  var ccRefSw = $("ccRefSw"), ccPaintSw = $("ccPaintSw"), ccDiff = $("ccDiff");

  var toastEl = $("toast");
  var confirmModal = $("confirmModal"), confirmMsg = $("confirmMsg"), confirmOk = $("confirmOk"), confirmCancel = $("confirmCancel");
  var ccMixBtn = $("ccMixBtn"), shapeMixBtn = $("shapeMixBtn");
  var mixModal = $("mixModal"), mixTitle = $("mixTitle"), mixTargetSw = $("mixTargetSw"), mixResultSw = $("mixResultSw");
  var mixClose = $("mixClose"), mixList = $("mixList"), mixAlt = $("mixAlt"), mixAltTitle = $("mixAltTitle"), mixAltList = $("mixAltList");
  var mixNote = $("mixNote"), mixDone = $("mixDone"), mixTargetMun = $("mixTargetMun"), mixResultMun = $("mixResultMun");

  $("versionLabel").textContent = "v" + (window.APP_VERSION || "?");

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
    Store.set("meta", { v: 2, corners: state.corners, lastCorners: state.lastCorners, offU: state.offU, offV: state.offV, shapes: state.shapes }).catch(storeFail);
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
      if(b.dataset.mode === "shapes") b.disabled = !hasRef;          // needs only the reference
      else if(b.dataset.mode !== "align") b.disabled = !hasAligned;
    });
    show(viewAlign, m === "align");
    show(viewCompare, m === "compare");
    show(viewSide, m === "side");
    show(viewShapes, m === "shapes");
    grayBtn.hidden = (m === "align");
    grayBtn.classList.toggle("on", state.grayscale);
    grayBtn.setAttribute("aria-pressed", state.grayscale ? "true" : "false");

    // header hint
    var hint;
    if(m === "align"){
      hint = !hasRef ? "reference → painting → compare"
           : !hasPhoto ? "now photograph your painting"
           : state.detecting ? "finding the canvas edges…"
           : "check the points are on the canvas corners · double-tap to zoom in";
    } else if(m === "compare"){
      hint = state.adjusting ? "drag the painting to line it up" : "hold the painting to peek and read colour";
    } else if(m === "shapes"){
      hint = state.shapesBusy && !state.shapesResult ? "finding the big shapes…"
           : (state.grayscale ? "big value shapes" : "big shapes by value and colour") + " · tap one to read it";
    } else {
      hint = "touch either image to read colours";
    }
    if((m === "compare" || m === "side") && viewZoom.z > 1) hint += " · double-tap to reset zoom";
    if(m === "shapes" && shapesZoom.z > 1) hint += " · double-tap to reset zoom";
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
      zoomFitBtn.textContent = pinZoom.z > 1 ? "Show whole photo" : "Zoom to painting";
      findEdgesBtn.disabled = state.detecting;
      findEdgesBtn.textContent = state.detecting ? "Finding…" : "Find edges";
      handles.forEach(function(h, i){ h.classList.toggle("unsure", !!state.cornerSure && !state.cornerSure[i]); });
      pinZoom.apply();
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

    // ---- shapes ----
    if(hasRef && m === "shapes") renderShapes();

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
    colorCard.title = "Hue and chroma are the nearest Munsell chip; value is measured. Each reading averages a " + side + "×" + side + " pixel patch.";
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
  var shapesZoom = makeZoom([shapesView], VIEW_MAX_ZOOM);

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
        if(now - lastTap < 350 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 30){
          if(single.doubleTap){ lastTap = 0; delete ptrs[e.pointerId]; single.doubleTap(); return; }
          if(zoom.z > 1){ lastTap = 0; zoom.reset(); onChange(); return; }
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
    if(m === "shapes" && !state.ref) return;
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
  grayBtn.addEventListener("click", function(){ state.grayscale = !state.grayscale; state.shapesPick = null; render(); });

  // ---------------- loading photos ----------------
  addRefBtn.addEventListener("click", function(){ refInput.click(); });
  changeRefBtn.addEventListener("click", function(){ refInput.click(); });
  refInput.addEventListener("change", function(){
    var f = refInput.files && refInput.files[0];
    refInput.value = "";
    if(!f) return;
    decodeToCanvas(f, WORK_DIM).then(function(im){
      state.ref = im;
      newShapesSource();
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
      var reused = setPhoto(im, null);
      state.aligned = null; state.reading = null;
      state.mode = "align";
      render();
      // Find the canvas: snap the remembered corners on a retake (already
      // close, so also zoom in for fine-tuning), or guess from scratch.
      if(reused) requestAnimationFrame(zoomToPainting);
      detectCanvas(reused ? "snap" : "guess");
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
    state.cornerSure = null;
    state.pinOpacity = 100;
    pinZoom.reset();
    return !corners && sameShape; // corners were reused from the last alignment
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
  // Stage-relative px of corner i (absolute children are placed from the
  // padding edge, inside the border).
  function cornerStagePos(i){
    var stageRect = pinStage.getBoundingClientRect(), innerRect = pinInner.getBoundingClientRect();
    var p = state.corners[i];
    return {
      x: innerRect.left - (stageRect.left + pinStage.clientLeft) + p.u*innerRect.width,
      y: innerRect.top  - (stageRect.top  + pinStage.clientTop)  + p.v*innerRect.height
    };
  }
  function layoutHandles(){
    if(!state.corners) return;
    var pts = state.corners.map(function(p){ return (p.u*100) + "," + (p.v*100); }).join(" ");
    pinPoly.setAttribute("points", pts);
    pinPolyHalo.setAttribute("points", pts);
    layoutRefOverlay();
    handles.forEach(function(h, i){
      var pos = cornerStagePos(i);
      h.style.left = pos.x + "px";
      h.style.top  = pos.y + "px";
    });
    if(activeHandle != null) drawLoupe(activeHandle);
  }

  // Zooms the align view so the four points fill the stage (with a margin),
  // or back out to the whole photo if already zoomed.
  function zoomToPainting(){
    if(!state.corners) return;
    var us = state.corners.map(function(p){ return p.u; }), vs = state.corners.map(function(p){ return p.v; });
    var u0 = Math.min.apply(null, us), u1 = Math.max.apply(null, us);
    var v0 = Math.min.apply(null, vs), v1 = Math.max.apply(null, vs);
    var bw = Math.max(0.02, u1 - u0), bh = Math.max(0.02, v1 - v0);
    var z = clamp(Math.min(0.84/bw, 0.84/bh), 1, PIN_MAX_ZOOM);
    if(z <= 1.02){ pinZoom.reset(); }
    else {
      pinZoom.z = z;
      pinZoom.pu = 0.5 - (u0 + u1)/2 * z;
      pinZoom.pv = 0.5 - (v0 + v1)/2 * z;
      pinZoom.clampPan();
    }
    render();
  }
  function toggleZoomToPainting(){
    if(pinZoom.z > 1){ pinZoom.reset(); render(); } else zoomToPainting();
  }

  // Magnifier: the photo around the held corner at 3x what's on screen,
  // with the outline to the neighbouring corners and a crosshair at the
  // exact point. Sits above the fingertip, or below it near the top.
  var LOUPE_D = 140, LOUPE_MAG = 3;
  function drawLoupe(i){
    if(!state.photo) return;
    var dpr = window.devicePixelRatio || 1;
    if(loupe.width !== LOUPE_D*dpr){ loupe.width = LOUPE_D*dpr; loupe.height = LOUPE_D*dpr; }
    var ctx = loupe.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var innerRect = pinInner.getBoundingClientRect();
    var scale = innerRect.width / state.photo.w * LOUPE_MAG; // loupe px per photo px
    var p = state.corners[i], cx = p.u*state.photo.w, cy = p.v*state.photo.h, R = LOUPE_D/2, srcR = R/scale;

    ctx.clearRect(0, 0, LOUPE_D, LOUPE_D);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI*2); ctx.clip();
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, LOUPE_D, LOUPE_D);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.photo.canvas, cx - srcR, cy - srcR, 2*srcR, 2*srcR, 0, 0, LOUPE_D, LOUPE_D);

    // outline to the neighbouring corners
    ctx.lineWidth = 2; ctx.strokeStyle = "#C1712F"; ctx.lineCap = "round";
    [(i+3)%4, (i+1)%4].forEach(function(j){
      var q = state.corners[j];
      ctx.beginPath(); ctx.moveTo(R, R);
      ctx.lineTo(R + (q.u*state.photo.w - cx)*scale, R + (q.v*state.photo.h - cy)*scale);
      ctx.stroke();
    });
    // crosshair
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.beginPath(); ctx.moveTo(R-14, R); ctx.lineTo(R-4, R); ctx.moveTo(R+4, R); ctx.lineTo(R+14, R);
    ctx.moveTo(R, R-14); ctx.lineTo(R, R-4); ctx.moveTo(R, R+4); ctx.lineTo(R, R+14); ctx.stroke();
    ctx.beginPath(); ctx.arc(R, R, 2, 0, Math.PI*2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();

    var pos = cornerStagePos(i), lift = 110;
    var y = pos.y - lift;
    if(y - R < -10) y = pos.y + lift; // no room above: show below
    loupe.style.left = pos.x + "px";
    loupe.style.top = y + "px";
    loupe.hidden = false;
  }
  function hideLoupe(){ loupe.hidden = true; }
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
      dragGen++;                                   // hand placement wins over any detection in progress
      if(state.cornerSure) state.cornerSure[i] = true;
      h.classList.remove("unsure");
      capturePointer(h, e);
      drawLoupe(i);
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
    function release(){ if(activeHandle === i){ activeHandle = null; hideLoupe(); persistMeta(); } }
    h.addEventListener("pointerup", release);
    h.addEventListener("pointercancel", release);
  });

  attachGestures(pinStage, pinZoom, {
    ignore: function(e){ return !!e.target.closest(".handle") || !state.photo; },
    panOnly: true,
    doubleTap: toggleZoomToPainting
  }, function(){ pinZoom.apply(); layoutHandles(); render(); });

  zoomFitBtn.addEventListener("click", toggleZoomToPainting);
  pinOpacitySlider.addEventListener("input", function(){ state.pinOpacity = Number(pinOpacitySlider.value); render(); });
  resetAlignBtn.addEventListener("click", function(){
    if(!state.photo) return;
    dragGen++;
    state.corners = defaultCorners();
    state.cornerSure = null;
    pinZoom.reset();
    render();
    persistMeta();
  });

  // The stage is fitted to the screen, so keep the handles on their corners
  // when the window resizes or the iPad rotates.
  function relayoutPin(){ if(state.mode === "align" && state.photo){ pinZoom.apply(); layoutHandles(); } }
  if(window.ResizeObserver) new ResizeObserver(relayoutPin).observe(pinStage);
  window.addEventListener("resize", function(){ relayoutPin(); render(); });

  // ---------------- background workers ----------------
  // Returns call(msg, transfer) → Promise of the worker's reply. Rejects if
  // workers aren't available or the worker fails, so callers can fall back
  // to doing the work on the main thread.
  function workerCaller(url){
    var w = null, failed = false, pending = {}, seq = 0;
    return function(msg, transfer){
      if(!w && !failed){
        try{
          w = new Worker(url);
          w.onmessage = function(e){ var p = pending[e.data.id]; delete pending[e.data.id]; if(p) p.resolve(e.data); };
          w.onerror = function(){
            failed = true; w = null;
            Object.keys(pending).forEach(function(k){ pending[k].reject(new Error("worker failed")); delete pending[k]; });
          };
        }catch(e){ failed = true; w = null; }
      }
      if(!w) return Promise.reject(new Error("no worker"));
      return new Promise(function(resolve, reject){
        msg.id = ++seq;
        pending[msg.id] = { resolve: resolve, reject: reject };
        w.postMessage(msg, transfer || []);
      });
    };
  }

  // ---------------- the warp ----------------
  var callWarp = workerCaller("warp-worker.js");
  function warpToCanvas(w, h, bytes){
    var out = document.createElement("canvas");
    out.width = w; out.height = h;
    var img = new ImageData(new Uint8ClampedArray(bytes), w, h);
    out.getContext("2d").putImageData(img, 0, 0);
    return { canvas: out, w: w, h: h };
  }
  function warpAsync(srcIm, cornersPx, dstW, dstH){
    var sData = srcIm.canvas.getContext("2d").getImageData(0, 0, srcIm.w, srcIm.h).data;
    return callWarp({ src: sData.buffer, sW: srcIm.w, sH: srcIm.h, corners: cornersPx, dstW: dstW, dstH: dstH }, [sData.buffer])
      .then(function(msg){ return warpToCanvas(msg.w, msg.h, msg.data); })
      .catch(function(){ return warpSync(srcIm, cornersPx, dstW, dstH); });
  }
  function warpSync(srcIm, cornersPx, dstW, dstH){
    var sData = srcIm.canvas.getContext("2d").getImageData(0, 0, srcIm.w, srcIm.h).data;
    return warpToCanvas(dstW, dstH, Warp.warpPerspective(sData, srcIm.w, srcIm.h, cornersPx, dstW, dstH).buffer);
  }

  // ---------------- finding the canvas automatically ----------------
  // "guess": from the whole photo, no hints (a new painting photo).
  // "snap": refine the current points (remembered corners on a retake, or
  //         points placed roughly by hand), helped by the guess where it agrees.
  // Corners it isn't sure of stay where they were and are shown in amber.
  // If the points are moved by hand while it's working, the result is dropped.
  var callDetect = workerCaller("detect-worker.js");
  var detectSeq = 0, dragGen = 0;
  function scaledPixels(im, longEdge){
    var s = Math.min(1, longEdge/Math.max(im.w, im.h));
    var w = Math.max(1, Math.round(im.w*s)), h = Math.max(1, Math.round(im.h*s));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im.canvas, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w: w, h: h };
  }
  function isDefaultCorners(c){
    return c && defaultCorners().every(function(d, i){ return Math.abs(d.u - c[i].u) < 0.005 && Math.abs(d.v - c[i].v) < 0.005; });
  }
  function detectCanvas(mode){
    if(!state.photo || !state.ref || !state.corners) return;
    var seq = ++detectSeq, photo = state.photo, gen = dragGen;
    var corners = state.corners.map(copyPt), refAspect = state.ref.w/state.ref.h;
    state.detecting = true;
    render();
    function runHere(){
      var small = scaledPixels(photo, 600), medium = scaledPixels(photo, 1500);
      return mode === "snap" ? Detect.snap(small, medium, corners, refAspect) : Detect.guess(small, medium, refAspect);
    }
    var small = scaledPixels(photo, 600), medium = scaledPixels(photo, 1500);
    callDetect({ mode: mode, corners: corners, refAspect: refAspect,
                 small: { buf: small.data.buffer, w: small.w, h: small.h },
                 medium: { buf: medium.data.buffer, w: medium.w, h: medium.h } },
               [small.data.buffer, medium.data.buffer])
      .then(function(msg){ return msg.result; })
      .catch(function(){ return runHere(); })
      .then(function(res){
        if(seq !== detectSeq || state.photo !== photo) return;     // a newer request or photo took over
        state.detecting = false;
        if(gen !== dragGen){ render(); return; }                   // the points were moved by hand meanwhile
        if(!res || !res.found){
          render();
          toast("Couldn't find the canvas edges. Drag the points onto the corners.");
          return;
        }
        state.corners = res.corners.map(copyPt);
        state.cornerSure = res.sure.slice();
        render();
        persistMeta();
        var unsure = res.sure.filter(function(s){ return !s; }).length;
        toast(unsure ? "Found the canvas. Check the amber point" + (unsure > 1 ? "s" : "") + "."
                     : "Found the canvas. Check the corners with the loupe.");
      })
      .catch(function(){ if(seq === detectSeq){ state.detecting = false; render(); } });
  }
  findEdgesBtn.addEventListener("click", function(){
    if(state.detecting) return;
    detectCanvas(isDefaultCorners(state.corners) ? "guess" : "snap");
  });

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
    m.lin = [lin.r, lin.g, lin.b];
    return m;
  }
  // Reads both images at the same spot under the pointer (the painting is
  // drawn shifted by the position offset, so it's sampled shifted back).
  function readAt(e, view){
    if(!state.ref || !state.aligned) return;
    var vr = view.getBoundingClientRect();
    if(!vr.width || !vr.height) return;            // not laid out (hidden)
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

  // ---------------- shapes: the reference's big shapes ----------------
  // The analysis runs in shapes-worker.js (main-thread fallback). The
  // reference is sent once; changing the number of shapes, values/colour or
  // the background option only replays the stored merge order, so it's quick.
  var SHAPES_DIM = 640;     // analysis resolution (long edge)
  var callShapes = workerCaller("shapes-worker.js");
  var shapesToken = 0, workerShapesToken = -1, shapesSeq = 0, shapesTimer = null;
  var mainAnalyzer = null, mainAnalyzerToken = -1, shapesPendingKey = null;

  // a new reference: forget the analysis
  function newShapesSource(){
    shapesToken++;
    state.shapesResult = null;
    state.shapesPick = null;
    shapesPendingKey = null;
    shapesZoom.reset();
  }
  function shapesWant(){
    return { token: shapesToken, values: state.grayscale, count: state.shapes.count, bgOne: state.shapes.bgOne };
  }
  function shapesKey(w){ return [w.token, w.values ? "v" : "c", w.count, w.bgOne ? 1 : 0].join(":"); }

  function requestShapes(delay){
    if(!state.ref) return;
    var want = shapesWant(), key = shapesKey(want);
    if((state.shapesResult && state.shapesResult.key === key) || shapesPendingKey === key) return;
    shapesPendingKey = key;
    clearTimeout(shapesTimer);
    shapesTimer = setTimeout(function(){ runShapes(want, key); }, delay || 0);
  }
  function runShapes(want, key){
    var seq = ++shapesSeq;
    state.shapesBusy = true;
    renderShapesStatus();
    function ask(withPixels){
      var msg = { token: want.token, values: want.values, count: want.count, bgOne: want.bgOne }, transfer = [];
      if(withPixels){
        var px = scaledPixels(state.ref, SHAPES_DIM);
        msg.pixels = { buf: px.data.buffer, w: px.w, h: px.h };
        transfer = [px.data.buffer];
      }
      return callShapes(msg, transfer).then(function(reply){
        if(reply.needPixels){
          if(withPixels) throw new Error("worker lost the image");
          return ask(true);
        }
        workerShapesToken = want.token;
        return reply.result;
      });
    }
    function runHere(){
      if(mainAnalyzerToken !== want.token){
        var px = scaledPixels(state.ref, SHAPES_DIM);
        mainAnalyzer = new Shapes.Analyzer(px.data, px.w, px.h);
        mainAnalyzerToken = want.token;
      }
      return mainAnalyzer.compute(want.values, want.count, want.bgOne);
    }
    ask(workerShapesToken !== want.token)
      .catch(function(){ return runHere(); })
      .then(function(res){
        if(seq !== shapesSeq || want.token !== shapesToken) return;   // superseded
        res.key = key; res.values = want.values;
        state.shapesResult = res;
        state.shapesBusy = false;
        shapesPendingKey = null;
        if(state.shapesPick !== null && state.shapesPick >= res.count) state.shapesPick = null;
        render();
      })
      .catch(function(){
        if(seq !== shapesSeq) return;
        state.shapesBusy = false; shapesPendingKey = null;
        render();
        toast("The shapes couldn't be worked out for this photo.");
      });
  }

  function renderShapesStatus(){
    var R = state.shapesResult;
    shapesCount.textContent = state.shapesBusy ? "· working…" : (R ? "· " + R.count : "");
  }

  // ---- colour intensity: scale chroma in OKLab, keeping lightness and hue ----
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
  // boost the chroma of a linear-RGB colour by `factor`; if that leaves the
  // screen's range, go as far as possible in the same direction
  function boostChroma(r, g, b, factor){
    if(factor === 1) return [r, g, b];
    var lab = linToOklab(r, g, b), lo = 1, hi = factor, out = oklabToLin(lab[0], lab[1]*factor, lab[2]*factor);
    if(inGamut(out)) return out;
    for(var i=0;i<20;i++){
      var mid = (lo + hi)/2, c = oklabToLin(lab[0], lab[1]*mid, lab[2]*mid);
      if(inGamut(c)) lo = mid; else hi = mid;
    }
    out = oklabToLin(lab[0], lab[1]*lo, lab[2]*lo);
    return [clamp(out[0], 0, 1), clamp(out[1], 0, 1), clamp(out[2], 0, 1)];
  }

  // Display colour of shape k (linear RGB): its average colour with the
  // colour intensity applied, or in values mode a grey of the same luminance.
  function shapeLin(R, k){
    var r = R.colors[k*3], g = R.colors[k*3+1], b = R.colors[k*3+2];
    if(R.values){ var y = 0.2126*r + 0.7152*g + 0.0722*b; return [y, y, y]; }
    return boostChroma(r, g, b, state.shapes.chroma/100);
  }
  function shapeCss(R, k){
    var c = shapeLin(R, k);
    return "rgb(" + toSrgb(c[0]) + "," + toSrgb(c[1]) + "," + toSrgb(c[2]) + ")";
  }
  // flat image of all shapes in their colours (fills any gaps the
  // straightened outlines leave); rebuilt when the intensity changes
  function shapesFillImage(R){
    var key = R.values ? "v" : state.shapes.chroma;
    if(R.fillImage && R.fillKey === key) return R.fillImage;
    var c = R.fillImage || document.createElement("canvas"); c.width = R.w; c.height = R.h;
    var ctx = c.getContext("2d"), img = ctx.createImageData(R.w, R.h), d = img.data, cache = [];
    for(var k=0;k<R.count;k++){ var col = shapeLin(R, k); cache.push([toSrgb(col[0]), toSrgb(col[1]), toSrgb(col[2])]); }
    for(var p=0;p<R.w*R.h;p++){ var cc = cache[R.labels[p]]; d[p*4] = cc[0]; d[p*4+1] = cc[1]; d[p*4+2] = cc[2]; d[p*4+3] = 255; }
    ctx.putImageData(img, 0, 0);
    R.fillKey = key;
    return (R.fillImage = c);
  }

  function renderShapes(){
    shapesFrame.style.setProperty("--ar", state.ref.w + "/" + state.ref.h);
    setSrc(shapesRef, state.ref);
    shapesRef.classList.toggle("gray", state.grayscale);
    if(shapesSlider.value != state.shapes.count) shapesSlider.value = state.shapes.count;
    if(shapesOpacitySlider.value != state.shapes.opacity) shapesOpacitySlider.value = state.shapes.opacity;
    if(chromaSlider.value != state.shapes.chroma) chromaSlider.value = state.shapes.chroma;
    chromaSlider.disabled = state.grayscale;             // greys have no chroma
    chromaRow.classList.toggle("disabled", state.grayscale);
    chromaLabel.textContent = "· ×" + (state.shapes.chroma/100).toFixed(2).replace(/0$/, "");
    // the shapes layer (outlines and fill) over the reference photo
    shapesCanvas.style.opacity = String(state.shapes.opacity/100);
    outlinesSwitch.classList.toggle("on", state.shapes.outlines);
    fillSwitch.classList.toggle("on", state.shapes.fill);
    bgOneSwitch.classList.toggle("on", state.shapes.bgOne);
    shapesZoom.apply();
    requestShapes(0);
    renderShapesStatus();
    drawShapes();
    renderShapeReadout();
  }

  function drawShapes(){
    var R = state.shapesResult, dpr = window.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(shapesFrame.clientWidth*dpr)), H = Math.max(1, Math.round(shapesFrame.clientHeight*dpr));
    if(shapesCanvas.width !== W || shapesCanvas.height !== H){ shapesCanvas.width = W; shapesCanvas.height = H; }
    var ctx = shapesCanvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // the previous result stays up while a new one is worked out, so the
    // picture doesn't flash as the slider moves
    if(!R) return;
    var sx = W/R.w, sy = H/R.h;
    function path(poly){
      var pts = poly.pts;
      ctx.beginPath();
      for(var i=0;i<pts.length;i+=2){
        var x = (pts[i] + 0.5)*sx, y = (pts[i+1] + 0.5)*sy;
        if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    if(state.shapes.fill){
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(shapesFillImage(R), 0, 0, W, H);
      R.polys.forEach(function(poly){ ctx.fillStyle = shapeCss(R, poly.id); path(poly); ctx.fill(); });
    }
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if(state.shapes.outlines){
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 3.2*dpr;
      R.polys.forEach(function(poly){ path(poly); ctx.stroke(); });
      ctx.strokeStyle = "rgba(240,236,228,0.92)"; ctx.lineWidth = 1.6*dpr;
      R.polys.forEach(function(poly){ path(poly); ctx.stroke(); });
    }
    if(state.shapesPick !== null){
      ctx.strokeStyle = "#E39A4C"; ctx.lineWidth = 3*dpr;
      R.polys.forEach(function(poly){ if(poly.id === state.shapesPick){ path(poly); ctx.stroke(); } });
    }
  }

  function renderShapeReadout(){
    var R = state.shapesResult, k = state.shapesPick;
    shapeMixBtn.hidden = !R || k === null;
    if(!R || k === null){
      shapeSwatch.style.background = "transparent";
      shapeText.textContent = "Tap a shape to read its " + (state.grayscale ? "value" : "colour");
      return;
    }
    var r = R.colors[k*3], g = R.colors[k*3+1], b = R.colors[k*3+2];
    var m = Munsell.fromLinearRGB(r, g, b);
    shapeSwatch.style.background = shapeCss(R, k);
    var pct = Math.max(1, Math.round(R.sizes[k]/(R.w*R.h)*100));
    if(R.values){
      shapeText.innerHTML = "Value <b>" + m.value.toFixed(1) + "</b> · about " + pct + "% of the picture";
    } else if(state.shapes.chroma !== 100){
      // the intensified colour, with the photo's own average for reference
      var c = shapeLin(R, k), mb = Munsell.fromLinearRGB(c[0], c[1], c[2]);
      shapeText.innerHTML = "<b>" + mb.notation + "</b> (photo " + m.notation + ") · about " + pct + "%";
    } else {
      shapeText.innerHTML = "<b>" + m.notation + "</b> · about " + pct + "% of the picture";
    }
  }

  // tap a shape to read its average colour
  function pickShape(e){
    var R = state.shapesResult;
    if(!R) return;
    var vr = shapesView.getBoundingClientRect();
    if(!vr.width || !vr.height) return;            // not laid out (hidden)
    var u = (e.clientX - vr.left)/vr.width, v = (e.clientY - vr.top)/vr.height;
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return;
    state.shapesPick = R.labels[Math.floor(v*R.h)*R.w + Math.floor(u*R.w)];
    drawShapes();
    renderShapeReadout();
  }
  attachGestures(shapesFrame, shapesZoom, { start: pickShape, move: pickShape }, render);

  shapesSlider.addEventListener("input", function(){
    state.shapes.count = Number(shapesSlider.value);
    state.shapesPick = null;
    requestShapes(120);
    renderShapesStatus();
  });
  shapesSlider.addEventListener("change", persistMeta);
  shapesOpacitySlider.addEventListener("input", function(){
    state.shapes.opacity = Number(shapesOpacitySlider.value);
    shapesCanvas.style.opacity = String(state.shapes.opacity/100);
  });
  shapesOpacitySlider.addEventListener("change", persistMeta);
  chromaSlider.addEventListener("input", function(){
    state.shapes.chroma = Number(chromaSlider.value);
    if(!state.shapes.fill) state.shapes.fill = true;    // the boost is only visible on the filled shapes
    render();
  });
  chromaSlider.addEventListener("change", persistMeta);
  function toggleShapesOption(name){
    return function(){
      state.shapes[name] = !state.shapes[name];
      if(name === "bgOne") state.shapesPick = null;
      render();
      persistMeta();
    };
  }
  outlinesSwitch.addEventListener("click", toggleShapesOption("outlines"));
  fillSwitch.addEventListener("click", toggleShapesOption("fill"));
  bgOneSwitch.addEventListener("click", toggleShapesOption("bgOne"));
  if(window.ResizeObserver) new ResizeObserver(function(){ if(state.mode === "shapes") drawShapes(); }).observe(shapesFrame);

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
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(confirmModal.classList.contains("show")) closeConfirm();
    if(mixModal.classList.contains("show")) closeMix();
  });

  // ---------------- paint recipes (mix.js) ----------------
  // Shows which of your paints, in what proportions, come closest to a colour.
  function showRecipe(targetLin, what){
    var res = Mix.recipe(targetLin), best = res.best;
    mixTitle.textContent = "Mix " + what;
    mixTargetSw.style.background = "rgb(" + toSrgb(targetLin[0]) + "," + toSrgb(targetLin[1]) + "," + toSrgb(targetLin[2]) + ")";
    mixResultSw.style.background = best.css;
    function notation(lin){ return Munsell.fromLinearRGB(lin[0], lin[1], lin[2]).notation; }
    mixTargetMun.textContent = notation(targetLin);
    mixResultMun.textContent = notation(best.lin);
    mixClose.innerHTML = "<b>" + best.closeness + "</b> (ΔE " + best.de.toFixed(1) + ")";
    fillRecipeList(mixList, best);
    mixAlt.hidden = !res.closer;
    if(res.closer){
      mixAltTitle.textContent = "Closer (ΔE " + res.closer.de.toFixed(1) + ", " + notation(res.closer.lin) + "), with " + res.closer.parts.length + " paints:";
      fillRecipeList(mixAltList, res.closer);
    }
    var notes = ["Proportions are estimates from typical pigment strengths — a starting point to adjust by eye."];
    if(best.approx || (res.closer && res.closer.approx)) notes.push("Alizarin Crimson and Transparent Maroon are approximated until they're calibrated from a swatch card.");
    notes.push("Mixing predicted with Mixbox (Secret Weapons), non-commercial licence.");
    mixNote.textContent = notes.join(" ");
    mixModal.classList.add("show");
  }
  function fillRecipeList(ul, r){
    ul.innerHTML = "";
    r.parts.forEach(function(p){
      var li = document.createElement("li");
      var chip = document.createElement("span"); chip.className = "mix-chip"; chip.style.background = p.paint.css;
      var name = document.createElement("span"); name.textContent = p.paint.name + (p.paint.approx ? " *" : "");
      var amt = document.createElement("span"); amt.className = "mix-amount";
      amt.innerHTML = "<b>" + p.label + "</b> · " + Math.max(1, Math.round(p.vol*100)) + "%";
      li.appendChild(chip); li.appendChild(name); li.appendChild(amt);
      ul.appendChild(li);
    });
  }
  function closeMix(){ mixModal.classList.remove("show"); }
  mixDone.addEventListener("click", closeMix);
  mixModal.addEventListener("click", function(e){ if(e.target === mixModal) closeMix(); });

  // reference colour at the spot read on the compare / side-by-side views
  ccMixBtn.addEventListener("click", function(){
    if(state.reading) showRecipe(state.reading.r.lin, "the reference colour");
  });
  // the tapped shape's colour as shown (including any colour intensity)
  shapeMixBtn.addEventListener("click", function(){
    var R = state.shapesResult, k = state.shapesPick;
    if(R && k !== null) showRecipe(shapeLin(R, k), state.grayscale ? "this value" : "this shape's colour");
  });

  function restart(){
    state.ref = null; state.photo = null; state.aligned = null;
    newShapesSource();
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
    // Ask for durable storage so the browser doesn't clear the saved photos
    // after a spell of non-use.
    if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(function(){}); }
    migrateLegacy().then(function(){
      return Promise.all([Store.get("meta"), Store.get("ref"), Store.get("photo"), Store.get("aligned")]);
    }).then(function(res){
      var meta = res[0] || {}, refBlob = res[1], photoBlob = res[2], alignedBlob = res[3];
      if(!refBlob) return;
      state.lastCorners = (meta.lastCorners && validCorners(meta.lastCorners.pts)) ? meta.lastCorners : null;
      state.offU = Number(meta.offU) || 0; state.offV = Number(meta.offV) || 0;
      if(meta.shapes && typeof meta.shapes === "object"){
        var s = meta.shapes;
        state.shapes = {
          count: clamp(Number(s.count) || 30, 8, 80),
          outlines: s.outlines !== false, fill: !!s.fill, bgOne: s.bgOne !== false,
          opacity: s.opacity === undefined ? 100 : clamp(Number(s.opacity) || 0, 0, 100),
          chroma: clamp(Number(s.chroma) || 100, 100, 300)
        };
      }
      return decodeToCanvas(refBlob, WORK_DIM).then(function(ref){
        state.ref = ref;
        newShapesSource();
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
