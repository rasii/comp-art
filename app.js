(function(){
  "use strict";

  var WORK_DIM = 3000;     // long edge of the working reference and of the aligned output
  var SRC_MAX  = 3000;     // long edge kept for the raw painting photo (perspective source)
  var VIEW_MAX_ZOOM = 10;  // pinch-zoom limit on the compare / side-by-side / block-in views
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
    photoKey: null,  // identifies the painting photo (a stage per photo, see Progress)
    // Block-in tab: the reference painted with a limited palette. Values vs
    // colour follows the black & white button (state.grayscale).
    // shapes: how the picture is shown. opacity of the block-in over the
    // photo; chroma: colour intensity, % of the photo's own chroma;
    // enhancePhoto: apply it to the reference photo too.
    shapes: { opacity: 100, chroma: 100, enhancePhoto: false },
    // blocks: the breakdown itself. colours: palette size; detail: 0 flat
    // masses, then brush strokes from big to small; outlines and fill.
    blocks: { colours: 12, detail: 50, outlines: false, fill: true },
    shapesResult: null, // latest analysis (labels, average colours, outlines)
    shapesBusy: false,
    shapesPick: null,   // id of the tapped shape
    shapesPoint: null   // where it was tapped {u, v, pointerType}, for the photo's own colour there
  };

  // ---------------- element refs ----------------
  var $ = function(id){ return document.getElementById(id); };
  var tabs = $("tabs"), stepHint = $("stepHint");
  var grayBtn = $("grayBtn"), restartBtn = $("restartBtn"), saveBtn = $("saveBtn");
  var saveModal = $("saveModal"), savePaintingBtn = $("savePaintingBtn"), saveSideBtn = $("saveSideBtn");
  var saveNote = $("saveNote"), saveCancel = $("saveCancel");

  var emptyStage = $("emptyStage"), setupPanel = $("setupPanel");
  var refRow = $("refRow"), curRow = $("curRow"), changeRefRow = $("changeRefRow");
  var addRefBtn = $("addRefBtn"), addCurBtn = $("addCurBtn"), changeRefBtn = $("changeRefBtn");
  var refInput = $("refInput"), curInput = $("curInput");

  var alignStageWrap = $("alignStageWrap");
  var pinStage = $("pinStage"), pinView = $("pinView"), pinInner = $("pinInner"), pinRefImg = $("pinRefImg"), pinImg = $("pinImg");
  var pinPoly = $("pinPoly"), loupe = $("loupe");
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

  var viewShapes = $("view-shapes"), shapesFrame = $("shapesFrame"), shapesView = $("shapesView"), shapesImg = $("shapesImg");
  var shapesRef = $("shapesRef"), shapesCanvas = $("shapesCanvas");
  var detailSlider = $("detailSlider"), detailLabel = $("detailLabel"), paletteRow = $("paletteRow");
  var coloursSlider = $("coloursSlider"), coloursLabel = $("coloursLabel");
  var shapesOpacitySlider = $("shapesOpacitySlider");
  var chromaRow = $("chromaRow"), chromaSlider = $("chromaSlider"), chromaLabel = $("chromaLabel");
  var outlinesSwitch = $("outlinesSwitch"), fillSwitch = $("fillSwitch");
  var shapeSwatch = $("shapeSwatch"), shapeText = $("shapeText"), shapePrompt = $("shapePrompt"), shapeReadout = $("shapeReadout");
  var photoReadout = $("photoReadout"), photoSwatch = $("photoSwatch"), photoText = $("photoText"), photoMixBtn = $("photoMixBtn");
  var enhanceRow = $("enhanceRow"), enhanceSwitch = $("enhanceSwitch"), shapesPhoto = $("shapesPhoto"), shapesMarker = $("shapesMarker");

  var colorCard = $("colorCard"), compareCardSlot = $("compareCardSlot"), sideCardSlot = $("sideCardSlot");
  var ccEmpty = $("ccEmpty"), ccBody = $("ccBody");
  var ccRefMun = $("ccRefMun"), ccPaintMun = $("ccPaintMun"), ccRefName = $("ccRefName");
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
  // and a double tap never zooms or scrolls the page (see app.css)
  document.addEventListener("dblclick", function(e){ e.preventDefault(); }, { passive: false });

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
    if(img._im === im) return;     // already showing this image
    img._im = im;
    img.src = urlOf(im);
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
    Store.set("meta", { v: 2, corners: state.corners, lastCorners: state.lastCorners, offU: state.offU, offV: state.offV, shapes: state.shapes, blocks: state.blocks, photoKey: state.photoKey, progEven: progEven, progRef: progRef, progSpeed: progSpeedIdx }).catch(storeFail);
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
      if(b.dataset.mode === "blocks") b.disabled = !hasRef;       // needs only the reference
      else if(b.dataset.mode === "progress") b.disabled = !Progress.count();
      else if(b.dataset.mode !== "align") b.disabled = !hasAligned;
    });
    show(viewAlign, m === "align");
    show(viewCompare, m === "compare");
    show(viewSide, m === "side");
    show(viewShapes, m === "blocks");
    show(viewProgress, m === "progress");
    grayBtn.hidden = (m === "align");
    saveBtn.hidden = !(hasAligned && (m === "compare" || m === "side"));
    grayBtn.classList.toggle("on", state.grayscale);
    grayBtn.setAttribute("aria-pressed", state.grayscale ? "true" : "false");

    renderHint();

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
      if(m === "align") requestRefIntensity(0);
      showRef(pinRefImg);
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
      if(m === "compare" || m === "side") requestRefIntensity(0);   // (made once, shared by every tab)
      showRef(compareRef); setSrc(compareCur, state.aligned);
      showRef(sideRef);    setSrc(sideCur, state.aligned);
      if(m === "side") layoutSide();
    }
    if(opacitySlider.value != state.opacity) opacitySlider.value = state.opacity;
    compareCur.style.opacity = state.peeking ? "0" : String(state.opacity/100);
    adjustSwitch.classList.toggle("on", state.adjusting);
    compareFrame.classList.toggle("adjusting", state.adjusting);
    show(resetPosBtn, state.adjusting || state.offU !== 0 || state.offV !== 0);
    // the offset is a fraction of the photo, which is letterboxed in its frame
    function shiftIn(frame){
      if(!state.offU && !state.offV) return "";
      var c = imageRect(frame);
      return "translate(" + (state.offU*c.w*100) + "%," + (state.offV*c.h*100) + "%)";
    }
    compareCur.style.transform = shiftIn(compareFrame);
    sideCur.style.transform = shiftIn(sideCurFrame);
    [compareRef, compareCur, sideRef, sideCur].forEach(function(img){ img.classList.toggle("gray", state.grayscale); });
    // re-fit pan to the frame's current size (only measurable while shown)
    if(m === "compare") compareZoom.clampPan();
    if(m === "side") sideZoom.clampPan();
    compareZoom.apply(); sideZoom.apply();

    // ---- progress ----
    if(m === "progress") renderProgress();

    // ---- shapes ----
    if(hasRef && m === "blocks") renderShapes();

    // colour card: one card, shown in whichever view is active
    var slot = (m === "side") ? sideCardSlot : compareCardSlot;
    if(colorCard.parentElement !== slot) slot.appendChild(colorCard);
    ccEmpty.textContent = (m === "side") ? "Touch either image to read colours" : "Touch and hold the painting to read colours";
    renderReading();
  }

  // header hint for the current tab
  function renderHint(){
    var m = state.mode, hasRef = !!state.ref, hasPhoto = !!state.photo;
    var hint;
    if(m === "align"){
      hint = !hasRef ? "reference → painting → compare"
           : !hasPhoto ? "now photograph your painting"
           : state.detecting ? "finding the canvas edges…"
           : "check the points are on the canvas corners · double-tap to zoom in";
    } else if(m === "compare"){
      hint = state.adjusting ? "drag the painting to line it up" : "hold the painting to peek and read colour";
      if(refIntensityOn()) hint += " · reference at intensity ×" + (state.shapes.chroma/100).toFixed(2).replace(/0$/, "");
    } else if(m === "progress"){
      hint = Progress.count() > 1 ? "slide or play to watch the painting develop" : "each aligned photo is kept here";
    } else if(m === "blocks"){
      hint = state.shapesBusy && !state.shapesResult ? "blocking in…"
           : (state.blocks.detail === 0 ? "flat masses" : "brush strokes") + " from a few " + (state.grayscale ? "values" : "mixtures") + " · tap one to read it";
    } else {
      hint = "touch either image to read colours";
      if(refIntensityOn()) hint += " · reference at intensity ×" + (state.shapes.chroma/100).toFixed(2).replace(/0$/, "");
    }
    if(m === "blocks" && state.shapesPick !== null && state.shapesResult) hint += " · double-tap to clear";
    else if((m === "compare" && compareZoom.z > 1) || (m === "side" && sideZoom.z > 1) || (m === "blocks" && shapesZoom.z > 1)) hint += " · double-tap to reset zoom";
    stepHint.textContent = hint;
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
    ccRefName.textContent = rd.intensity ? "Reference ×" + rd.intensity : "Reference";
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
    var side = rd.patch || 2*patchRadius(state.ref) + 1;
    colorCard.title = "Hue and chroma are the nearest Munsell chip; value is measured. This reading averages a " + side + "×" + side + " pixel patch (smaller when zoomed in).";
  }

  // Marker at image-normalized (u,v), positioned in the frame's pixels so it
  // keeps its size whatever the view zoom. For touch, the ring sits above
  // the fingertip (or below it near the top edge).
  function placeMarker(mk, frame, view, rd, fill){
    positionMarker(mk, frame, view, rd);
    mk.querySelector(".pm-ring").style.background = fill;
  }
  function positionMarker(mk, frame, view, rd){
    var fr = frame.getBoundingClientRect(), vr = view.getBoundingClientRect(), c = imageRect(frame);
    var x = vr.left - (fr.left + frame.clientLeft) + (c.x + rd.u*c.w)*vr.width;
    var y = vr.top  - (fr.top  + frame.clientTop)  + (c.y + rd.v*c.h)*vr.height;
    var touch = rd.pointerType === "touch";
    mk.classList.toggle("touch", touch);
    mk.classList.toggle("below", touch && y < 96);
    mk.style.left = x + "px";
    mk.style.top = y + "px";
  }

  // Where the reference sits in a frame that letterboxes it (object-fit:
  // contain), as fractions of the frame: {x, y, w, h}.
  function imageRect(frame){
    var W = frame.clientWidth, H = frame.clientHeight;
    if(!state.ref || !W || !H) return { x: 0, y: 0, w: 1, h: 1 };
    var ar = state.ref.w / state.ref.h, w = 1, h = 1;
    if(W/H > ar) w = H*ar/W; else h = W/ar/H;
    return { x: (1-w)/2, y: (1-h)/2, w: w, h: h };
  }

  // ---------------- lockstep pinch-zoom for a group of views ----------------
  // z/pu/pv are the same for every view in the group; pan is a fraction of
  // each frame, so frames of different pixel sizes stay in step. With
  // content() (the image's rect in the frame, for a letterboxed image), pan
  // keeps the image covering the frame on any axis where it's bigger than
  // the frame, and centred where it's still smaller.
  function makeZoom(views, maxZoom, content){
    var zm = { z: 1, pu: 0, pv: 0 };
    function clampAxis(p, z, a, len){
      if(z*len <= 1) return 0.5 - z*(a + len/2);
      return clamp(p, 1 - z*(a + len), -z*a);
    }
    zm.clampPan = function(){
      zm.z = clamp(zm.z, 1, maxZoom);
      var c = content ? content() : { x: 0, y: 0, w: 1, h: 1 };
      zm.pu = clampAxis(zm.pu, zm.z, c.x, c.w);
      zm.pv = clampAxis(zm.pv, zm.z, c.y, c.h);
    };
    zm.apply = function(){
      var t = (zm.z === 1 && !zm.pu && !zm.pv) ? "" : "translate(" + (zm.pu*100) + "%," + (zm.pv*100) + "%) scale(" + zm.z + ")";
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
  var compareZoom = makeZoom([compareView], VIEW_MAX_ZOOM, function(){ return imageRect(compareFrame); });
  var sideZoom = makeZoom([sideRefView, sideCurView], VIEW_MAX_ZOOM, function(){ return imageRect(sideRefFrame); });
  var shapesZoom = makeZoom([shapesView], VIEW_MAX_ZOOM, function(){ return imageRect(shapesFrame); });

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
    if(m === "blocks" && !state.ref) return;
    if(m === "progress" && !Progress.count()) return;
    if(m === "progress" && m !== state.mode){ progIndex = Progress.count() - 1; prepareProgressFiles(); }
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
  changeRefBtn.addEventListener("click", function(){
    var n = Progress.count();
    if(!n){ refInput.click(); return; }
    prepareProgressFiles();
    askConfirm("A different reference starts a new painting: its " + n + " progress photo" + (n > 1 ? "s are" : " is") + " cleared once you choose it.",
      "Choose reference", function(){ refInput.click(); }, { label: "Save the progress photos first", action: saveAllProgress });
  });
  refInput.addEventListener("change", function(){
    var f = refInput.files && refInput.files[0];
    refInput.value = "";
    if(!f) return;
    decodeToCanvas(f, WORK_DIM).then(function(im){
      state.ref = im;
      newShapesSource();
      clearProgress();
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
      state.photoKey = Date.now().toString(36);    // a new painting photo: aligning it adds a stage
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
      compareZoom.reset(); sideZoom.reset();
      state.busy = false;
      state.mode = "compare";
      render();
      persistMeta();
      persistCanvas("aligned", im.canvas);
      addStage(im);
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
  // The patch: at most 1/300 of the image (smooths grain, JPEG blocks and
  // canvas texture), and never more than the marker's centre dot on screen
  // (the point you aim with), so zooming in reads finer detail, down to
  // 3×3 pixels.
  var RING_R = 3;            // css px: radius of the marker's centre dot
  function patchRadius(im){ return Math.max(1, Math.round(Math.max(im.w, im.h) / 300)); }
  // radius for an image shown `shownW` css px wide
  function patchFor(im, shownW){
    return clamp(Math.round(RING_R*im.w/Math.max(1, shownW)), 1, patchRadius(im));
  }
  function samplePatch(im, u, v, radius){
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    var cx = Math.floor(u*im.w), cy = Math.floor(v*im.h), r = radius || patchRadius(im);
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
  function readAt(e, frame, view){
    if(!state.ref || !state.aligned) return;
    var vr = view.getBoundingClientRect(), c = imageRect(frame);
    if(!vr.width || !vr.height) return;            // not laid out (hidden)
    var u = ((e.clientX - vr.left) / vr.width - c.x) / c.w;
    var v = ((e.clientY - vr.top) / vr.height - c.y) / c.h;
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return;
    var shown = vr.width*c.w, rr = patchFor(state.ref, shown), ra = patchFor(state.aligned, shown);
    var refLin = samplePatch(state.ref, u, v, rr);
    if(refIntensityOn()){
      var bo = Shapes.boostChroma(refLin.r, refLin.g, refLin.b, state.shapes.chroma/100);
      refLin = { r: bo[0], g: bo[1], b: bo[2] };
    }
    var curLin = samplePatch(state.aligned, u - state.offU, v - state.offV, ra);
    state.reading = { u: u, v: v, pointerType: e.pointerType, patch: 2*rr + 1, r: readColour(refLin), p: curLin ? readColour(curLin) : null,
                      intensity: refIntensityOn() ? (state.shapes.chroma/100).toFixed(2).replace(/0$/, "") : null };
    renderReading();
  }

  // compare frame: hold to peek + read; drag to reposition when adjusting
  var posDrag = null;
  attachGestures(compareFrame, compareZoom, {
    start: function(e){
      if(!state.aligned) return;
      if(state.adjusting){
        posDrag = { x: e.clientX, y: e.clientY, u0: state.offU, v0: state.offV };
      } else {
        state.peeking = true;
        render();
        readAt(e, compareFrame, compareView);
      }
    },
    move: function(e){
      if(posDrag){
        var rect = compareView.getBoundingClientRect(), c = imageRect(compareFrame);
        state.offU = clamp(posDrag.u0 + (e.clientX - posDrag.x) / (rect.width*c.w), -OFF_MAX, OFF_MAX);
        state.offV = clamp(posDrag.v0 + (e.clientY - posDrag.y) / (rect.height*c.h), -OFF_MAX, OFF_MAX);
        render();
      } else if(state.peeking){
        readAt(e, compareFrame, compareView);
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
  if(window.ResizeObserver) new ResizeObserver(function(){ if(state.mode === "compare") render(); }).observe(compareFrame);

  // side by side: touching either image reads the same spot in both
  [ [sideRefFrame, sideRefView], [sideCurFrame, sideCurView] ].forEach(function(pair){
    attachGestures(pair[0], sideZoom, {
      start: function(e){ readAt(e, pair[0], pair[1]); },
      move: function(e){ readAt(e, pair[0], pair[1]); }
    }, render);
  });

  // ---------------- block-in: the reference painted with a limited palette ----------------
  // The analysis runs in shapes-worker.js (main-thread fallback). The
  // reference is sent once; changing a setting reuses what the worker
  // already holds, so it's quick.
  var SHAPES_DIM = 640;     // analysis resolution (long edge)
  var shapesLast = null;    // the latest result, kept even when the settings have moved on
  var callShapes = workerCaller("shapes-worker.js");
  var shapesToken = 0, workerShapesToken = -1, shapesTimer = null, shapesRunning = false;
  var mainAnalyzer = null, mainAnalyzerToken = -1, shapesPendingKey = null;

  // a new reference: forget the analysis
  function newShapesSource(){
    shapesToken++;
    state.shapesResult = null;
    state.shapesPick = null;
    state.shapesPoint = null;
    shapesPendingKey = null; shapesLast = null;
    enhancedKey = null; enhancePendingKey = null;
    shapesPhoto.hidden = true;
    shapesZoom.reset();
    forgetRefIntensity();
  }

  // ---- the reference photo with the colour intensity applied ----
  // Rendered in the worker at display size and shown over the original.
  var ENHANCE_DIM = 1400, enhanceSeq = 0, enhanceTimer = null, workerPhotoToken = -1;
  var enhancedKey = null, enhancePendingKey = null;
  function enhanceOn(){ return state.shapes.enhancePhoto && !state.grayscale; }
  function requestEnhanced(delay){
    if(!state.ref || !enhanceOn() || state.shapes.chroma === 100){ shapesPhoto.hidden = true; return; }
    var key = shapesToken + ":" + state.shapes.chroma;
    if(enhancedKey === key){ shapesPhoto.hidden = false; return; }
    if(enhancePendingKey === key) return;
    enhancePendingKey = key;
    clearTimeout(enhanceTimer);
    var token = shapesToken, factor = state.shapes.chroma/100;
    enhanceTimer = setTimeout(function(){ runEnhance(key, token, factor); }, delay || 0);
  }
  function runEnhance(key, token, factor){
    var seq = ++enhanceSeq;
    function ask(withPixels){
      var msg = { kind: "enhance", slot: "view", token: token, factor: factor }, transfer = [];
      if(withPixels){
        var px = scaledPixels(state.ref, ENHANCE_DIM);
        msg.pixels = { buf: px.data.buffer, w: px.w, h: px.h };
        transfer = [px.data.buffer];
      }
      return callShapes(msg, transfer).then(function(reply){
        if(reply.needPixels){ if(withPixels) throw new Error("worker lost the image"); return ask(true); }
        workerPhotoToken = token;
        return reply.result;
      });
    }
    function runHere(){
      var px = scaledPixels(state.ref, ENHANCE_DIM), out = Shapes.enhance(px.data, px.w, px.h, factor);
      return { buf: out.buffer, w: px.w, h: px.h };
    }
    ask(workerPhotoToken !== token)
      .catch(function(){ return runHere(); })
      .then(function(res){
        if(seq !== enhanceSeq || token !== shapesToken) return;   // superseded
        shapesPhoto.width = res.w; shapesPhoto.height = res.h;
        shapesPhoto.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(res.buf), res.w, res.h), 0, 0);
        enhancedKey = key; enhancePendingKey = null;
        shapesPhoto.hidden = !(enhanceOn() && state.shapes.chroma !== 100);
      })
      .catch(function(){ enhancePendingKey = null; });
  }
  // ---- the reference at the Block-in intensity, on every tab ----
  // Block-in's "Show intensity on the reference" switch, with the intensity
  // above ×1.0, shows the reference boosted on Align, Compare and Side by
  // side too, so it looks the same everywhere. Made at full size in the
  // worker (so zooming in stays sharp) and shown in place of the original
  // once ready; until then the last one made (or the original) stays up.
  // Not in black & white, where it can't be seen. Colour readings of the
  // reference get the same boost (readAt), so a recipe matches what's on
  // screen. Saved images, the video and the contact sheet use it too
  // (refForSaving), waiting for it if it isn't ready yet.
  var refInt = { key: null, url: null, pending: null, seq: 0, timer: null, workerToken: -1, promise: null, promiseKey: null };
  function refIntensityOn(){ return !!state.ref && enhanceOn() && state.shapes.chroma !== 100; }
  function forgetRefIntensity(){
    if(refInt.url) URL.revokeObjectURL(refInt.url);
    refInt.key = null; refInt.url = null; refInt.pending = null; refInt.seq++;
    clearTimeout(refInt.timer);
  }
  function requestRefIntensity(delay){
    if(!refIntensityOn()) return;
    var key = shapesToken + ":" + state.shapes.chroma;
    if(refInt.key === key || refInt.pending === key) return;
    refInt.pending = key;
    clearTimeout(refInt.timer);
    var token = shapesToken, factor = state.shapes.chroma/100;
    refInt.timer = setTimeout(function(){ runRefIntensity(key, token, factor); }, delay || 0);
  }
  function runRefIntensity(key, token, factor){
    var seq = ++refInt.seq;
    refInt.promiseKey = key;
    function ask(withPixels){
      var msg = { kind: "enhance", slot: "full", token: token, factor: factor }, transfer = [];
      if(withPixels){
        var px = scaledPixels(state.ref, WORK_DIM);
        msg.pixels = { buf: px.data.buffer, w: px.w, h: px.h };
        transfer = [px.data.buffer];
      }
      return callShapes(msg, transfer).then(function(reply){
        if(reply.needPixels){ if(withPixels) throw new Error("worker lost the image"); return ask(true); }
        refInt.workerToken = token;
        return reply.result;
      });
    }
    function runHere(){
      var px = scaledPixels(state.ref, WORK_DIM), out = Shapes.enhance(px.data, px.w, px.h, factor);
      return { buf: out.buffer, w: px.w, h: px.h };
    }
    return (refInt.promise = ask(refInt.workerToken !== token)
      .catch(function(){ return runHere(); })
      .then(function(res){
        if(seq !== refInt.seq || token !== shapesToken) return null;
        var c = document.createElement("canvas"); c.width = res.w; c.height = res.h;
        c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(res.buf), res.w, res.h), 0, 0);
        return canvasToBlob(c, "image/jpeg", 0.95).then(function(b){
          if(seq !== refInt.seq || token !== shapesToken) return null;
          if(refInt.url) URL.revokeObjectURL(refInt.url);
          refInt.url = URL.createObjectURL(b); refInt.key = key; refInt.pending = null;
          render();
          return refInt.url;
        });
      })
      .catch(function(){ if(seq === refInt.seq) refInt.pending = null; return null; }));
  }
  // the boosted reference's url once it's ready (made now if need be), or
  // null when the switch is off or it couldn't be made
  function ensureRefIntensity(){
    if(!refIntensityOn()) return Promise.resolve(null);
    var key = shapesToken + ":" + state.shapes.chroma;
    if(refInt.key === key && refInt.url) return Promise.resolve(refInt.url);
    if(refInt.pending === key && refInt.promiseKey === key && refInt.promise) return refInt.promise;
    clearTimeout(refInt.timer);
    refInt.pending = key;
    return runRefIntensity(key, shapesToken, state.shapes.chroma/100);
  }
  // the reference to put in saved images and the video: boosted when the
  // switch says so, else the original
  function refForSaving(){
    return ensureRefIntensity().then(function(url){
      if(!url) return state.ref.canvas;
      return new Promise(function(resolve){
        var img = new Image();
        img.onload = function(){ resolve(img); };
        img.onerror = function(){ resolve(state.ref.canvas); };
        img.src = url;
      });
    });
  }
  function refNote(){ return refIntensityOn() ? "The reference at intensity ×" + (state.shapes.chroma/100).toFixed(2).replace(/0$/, "") + ", as shown." : ""; }
  // the reference as Compare and Side by side show it
  function showRef(img){
    if(refIntensityOn() && refInt.url){
      if(img._im !== refInt.url){ img._im = refInt.url; img.src = refInt.url; }
    } else {
      setSrc(img, state.ref);
    }
  }

  function shapesWant(){
    return { token: shapesToken, values: state.grayscale, colours: state.blocks.colours, detail: state.blocks.detail };
  }
  function shapesKey(w){ return [w.token, w.values ? "v" : "c", w.colours, w.detail].join(":"); }
  function useShapesResult(res){
    state.shapesResult = res;
    // shape numbers change with each result: re-pick at the tapped spot
    state.shapesPick = state.shapesPoint ? labelAt(res, state.shapesPoint) : null;
  }

  // Asks for the breakdown the settings want now. A result already in hand
  // (or the last one for this method) is used at once and any pending
  // request dropped; otherwise a run is scheduled after `delay` ms (sliders
  // ask with a small delay, so a drag only runs once it settles).
  function requestShapes(delay){
    if(!state.ref) return;
    var want = shapesWant(), key = shapesKey(want);
    if(state.shapesResult && state.shapesResult.key === key){ settleShapes(); return; }
    var last = shapesLast;
    if(last && last.key === key){ settleShapes(); useShapesResult(last); return; }
    if(shapesPendingKey === key) return;
    shapesPendingKey = key;
    state.shapesBusy = true;
    clearTimeout(shapesTimer);
    shapesTimer = setTimeout(kickShapes, delay || 0);
  }
  // Starts the wanted breakdown unless one is already running; when that
  // finishes it starts whatever is wanted by then, so a slider drag never
  // queues up a backlog of runs in the worker.
  function kickShapes(){
    if(shapesRunning || shapesPendingKey === null || !state.ref) return;
    var want = shapesWant(), key = shapesKey(want);
    shapesPendingKey = key;
    runShapes(want, key);
  }
  function shapesDone(key){
    shapesRunning = false;
    if(shapesPendingKey !== null && shapesPendingKey !== key) kickShapes();
  }
  // nothing is wanted beyond what's shown: forget any pending request
  function settleShapes(){
    clearTimeout(shapesTimer);
    if(shapesPendingKey !== null){ shapesPendingKey = null; state.shapesBusy = false; renderShapesStatus(); }
  }
  function runShapes(want, key){
    shapesRunning = true;
    renderShapesStatus();
    function ask(withPixels){
      var msg = { token: want.token, values: want.values, colours: want.colours, detail: want.detail }, transfer = [];
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
      return mainAnalyzer.blocks(want.values, want.colours, want.detail/100);
    }
    ask(workerShapesToken !== want.token)
      .catch(function(){ return runHere(); })
      .then(function(res){
        shapesDone(key);
        if(want.token !== shapesToken) return;                   // a different reference by now
        res.key = key; res.values = want.values; res.detail = want.detail;
        shapesLast = res;                                        // kept even if no longer wanted
        if(shapesPendingKey === key){ shapesPendingKey = null; state.shapesBusy = false; }
        if(shapesKey(shapesWant()) === key) useShapesResult(res);
        render();
      })
      .catch(function(){
        if(shapesRunning) shapesDone(key);
        if(want.token !== shapesToken || shapesPendingKey !== key) return;
        state.shapesBusy = false; shapesPendingKey = null;
        render();
        toast("The breakdown couldn't be worked out for this photo.");
      });
  }

  function renderShapesStatus(){
    var R = state.shapesResult, busy = state.shapesBusy ? "· working…" : "";
    detailLabel.textContent = busy || (state.blocks.detail === 0 ? "· flat masses" : "");
    coloursLabel.textContent = busy || (R ? "· " + R.paints + (R.values ? " values" : "") : "");
  }

  function linCss(c){ return "rgb(" + toSrgb(c[0]) + "," + toSrgb(c[1]) + "," + toSrgb(c[2]) + ")"; }
  function greyOf(r, g, b){ var y = 0.2126*r + 0.7152*g + 0.0722*b; return [y, y, y]; }

  // Display colour of paint g (linear RGB): its average colour with the
  // colour intensity applied (shapes.js, OKLab chroma scaling), or in
  // values mode a grey of the same luminance. A mass shows its paint's
  // colour (the same paint can make several masses).
  function paintLin(R, g){
    var r = R.paintColors[g*3], gg = R.paintColors[g*3+1], b = R.paintColors[g*3+2];
    if(R.values) return greyOf(r, gg, b);
    return Shapes.boostChroma(r, gg, b, state.shapes.chroma/100);
  }
  function shapeLin(R, k){ return paintLin(R, R.paint[k]); }
  function shapeCss(R, k){ return linCss(shapeLin(R, k)); }

  // The photo's own colour at a tapped spot, as shown: enhanced when the
  // intensity is applied to the photo, grey in values mode.
  function photoLin(pt){
    var s = samplePatch(state.ref, pt.u, pt.v, pt.r);
    if(state.grayscale) return greyOf(s.r, s.g, s.b);
    if(enhanceOn()) return Shapes.boostChroma(s.r, s.g, s.b, state.shapes.chroma/100);
    return [s.r, s.g, s.b];
  }
  function labelAt(R, pt){ return R.labels[Math.min(R.h-1, Math.floor(pt.v*R.h))*R.w + Math.min(R.w-1, Math.floor(pt.u*R.w))]; }
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

  // The masses painted as brush strokes along the fur (the direction field
  // from shapes.js), in their paint colours: big strokes everywhere, then
  // fine ones wherever the masses change within a big stroke's reach, so
  // flat areas stay broad and detail gets detail. Rebuilt when the result,
  // the intensity or the canvas size changes.
  function strokesImage(R, W, H){
    var key = (R.values ? "v" : state.shapes.chroma) + ":" + W + "x" + H;
    if(R.strokeImage && R.strokeKey === key) return R.strokeImage;
    var c = R.strokeImage || document.createElement("canvas"); c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    ctx.drawImage(shapesFillImage(R), 0, 0, W, H);          // underneath, so no gaps show
    // With a subject silhouette, the subject's strokes go on a layer of
    // their own that's cut to the silhouette and laid on top, so neither
    // side's strokes spill across the edge: a crisp subject on a soft
    // background.
    var inner = null, ictx = ctx;
    if(R.mask){
      inner = document.createElement("canvas"); inner.width = W; inner.height = H;
      ictx = inner.getContext("2d");
      ictx.drawImage(shapesFillImage(R), 0, 0, W, H);
      ictx.lineCap = "round";
    }
    var css = []; for(var g=0;g<R.paints;g++) css.push(linCss(paintLin(R, g)));
    var w = R.w, h = R.h, sx = W/w, sy = H/h, t = (R.detail == null ? 50 : R.detail)/100;
    var big = Math.max(w, h)/(73 + 67*t), small = big/3;    // stroke width, analysis px
    var fineShare = Math.min(1, 0.7 + 0.6*t);              // share of the photo-led fine strokes: full from halfway up
    var seed = 1;
    function rnd(){ seed = (seed*1664525 + 1013904223) >>> 0; return seed/4294967296; }
    ctx.lineCap = "round";
    function layer(s, lenMul, where, fine){
      var step = s*0.9, pts = [];
      for(var y=step/2; y<h; y+=step) for(var x=step/2; x<w; x+=step) pts.push(x + (rnd()-0.5)*step, y + (rnd()-0.5)*step);
      var order = []; for(var i=0;i<pts.length/2;i++) order.push(i);
      for(i=order.length-1;i>0;i--){ var j = Math.floor(rnd()*(i+1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      ctx.lineWidth = ictx.lineWidth = s*(sx + sy)/2;
      order.forEach(function(i){
        var x = pts[i*2], y = pts[i*2+1];
        var px = Math.min(w-1, Math.max(0, Math.round(x))), py = Math.min(h-1, Math.max(0, Math.round(y))), p = py*w + px;
        if(where && !where(p)) return;
        var a = R.angle[p]/255*Math.PI, L = s*lenMul*(0.7 + 0.6*rnd());
        var dx = Math.cos(a)*L/2, dy = Math.sin(a)*L/2;
        var g = (R.mask && R.mask[p]) ? ictx : ctx;
        g.strokeStyle = css[fine ? R.near[p] : R.paint[R.labels[p]]];
        g.globalAlpha = 0.85 + 0.15*rnd();
        g.beginPath(); g.moveTo((x-dx)*sx, (y-dy)*sy); g.lineTo((x+dx)*sx, (y+dy)*sy); g.stroke();
      });
    }
    layer(big, 2.5, null, false);
    // fine strokes where the masses change within a big stroke's reach, or
    // where the photo's own colour (in focus) wants a different paint
    var d = Math.max(1, Math.round(big)), lab = R.labels, paint = R.paint, near = R.near;
    layer(small, 3, function(p){
      var x = p % w, y = (p / w) | 0, l = lab[p];
      if((x >= d && lab[p-d] !== l) || (x < w-d && lab[p+d] !== l) || (y >= d && lab[p-d*w] !== l) || (y < h-d && lab[p+d*w] !== l)) return true;
      return near[p] !== paint[l] && rnd() < fineShare;
    }, true);
    ctx.globalAlpha = 1;
    if(inner){
      ictx.globalAlpha = 1;
      ictx.globalCompositeOperation = "destination-in";
      ictx.imageSmoothingEnabled = true;
      ictx.drawImage(maskImage(R), 0, 0, W, H);
      ctx.drawImage(inner, 0, 0);
    }
    R.strokeKey = key; R.strokeChroma = state.shapes.chroma; R.strokeSize = W + "x" + H;
    return (R.strokeImage = c);
  }

  // the silhouette as an alpha image (opaque inside), at analysis size
  function maskImage(R){
    if(R.maskImage) return R.maskImage;
    var c = document.createElement("canvas"); c.width = R.w; c.height = R.h;
    var ctx = c.getContext("2d"), img = ctx.createImageData(R.w, R.h), d = img.data;
    for(var p=0;p<R.w*R.h;p++){ d[p*4+3] = R.mask[p] ? 255 : 0; }
    ctx.putImageData(img, 0, 0);
    return (R.maskImage = c);
  }

  function renderShapes(){
    setSrc(shapesRef, state.ref);
    shapesRef.classList.toggle("gray", state.grayscale);
    if(coloursSlider.value != state.blocks.colours) coloursSlider.value = state.blocks.colours;
    if(detailSlider.value != state.blocks.detail) detailSlider.value = state.blocks.detail;
    if(shapesOpacitySlider.value != state.shapes.opacity) shapesOpacitySlider.value = state.shapes.opacity;
    if(chromaSlider.value != state.shapes.chroma) chromaSlider.value = state.shapes.chroma;
    chromaSlider.disabled = state.grayscale;             // greys have no chroma
    chromaRow.classList.toggle("disabled", state.grayscale);
    chromaLabel.textContent = "· ×" + (state.shapes.chroma/100).toFixed(2).replace(/0$/, "");
    // the shapes layer (outlines and fill) over the reference photo
    shapesCanvas.style.opacity = String(state.shapes.opacity/100);
    outlinesSwitch.classList.toggle("on", state.blocks.outlines);
    fillSwitch.classList.toggle("on", state.blocks.fill);
    enhanceSwitch.classList.toggle("on", state.shapes.enhancePhoto);
    enhanceSwitch.disabled = state.grayscale;
    enhanceRow.classList.toggle("disabled", state.grayscale);
    shapesZoom.clampPan(); shapesZoom.apply();
    requestShapes(0);
    requestEnhanced(120);
    renderShapesStatus();
    drawShapes();
    renderPalette();
    renderShapeReadout();
  }

  // block-in: the palette as swatches, lightest to darkest; tap one to see
  // where that mixture goes
  var paletteKey = null;
  function renderPalette(){
    var R = state.shapesResult, on = !!R;
    paletteRow.hidden = !on;
    if(!on){ paletteKey = null; return; }
    var picked = state.shapesPick === null ? -1 : R.paint[state.shapesPick];
    var key = R.key + ":" + state.shapes.chroma + ":" + picked;
    if(key === paletteKey) return;
    paletteKey = key;
    var order = []; for(var g=0;g<R.paints;g++) order.push(g);
    function lum(g){ return 0.2126*R.paintColors[g*3] + 0.7152*R.paintColors[g*3+1] + 0.0722*R.paintColors[g*3+2]; }
    order.sort(function(a, b){ return lum(b) - lum(a); });
    paletteRow.innerHTML = "";
    order.forEach(function(g){
      var sw = document.createElement("button");
      sw.className = "palette-sw" + (g === picked ? " on" : "");
      sw.style.background = linCss(paintLin(R, g));
      sw.title = Math.max(1, Math.round(R.paintSizes[g]/(R.w*R.h)*100)) + "% of the picture";
      sw.addEventListener("click", function(){
        var k = Array.prototype.indexOf.call(R.paint, g);   // any shape of this paint
        state.shapesPick = (g === picked) ? null : k;
        state.shapesPoint = null;
        drawShapes(); renderPalette(); renderShapeReadout(); renderHint();
      });
      paletteRow.appendChild(sw);
    });
  }

  // the photo and shapes layers sit where the letterboxed photo goes
  function layoutShapesImg(){
    var c = imageRect(shapesFrame), st = shapesImg.style;
    st.left = (c.x*100) + "%"; st.top = (c.y*100) + "%";
    st.width = (c.w*100) + "%"; st.height = (c.h*100) + "%";
  }
  function drawShapes(){
    layoutShapesImg();
    var R = state.shapesResult, dpr = window.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(shapesImg.clientWidth*dpr)), H = Math.max(1, Math.round(shapesImg.clientHeight*dpr));
    if(shapesCanvas.width !== W || shapesCanvas.height !== H){ shapesCanvas.width = W; shapesCanvas.height = H; }
    var ctx = shapesCanvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // the previous result stays up while a new one is worked out, so the
    // picture doesn't flash as the slider moves
    if(!R) return;
    var sx = W/R.w, sy = H/R.h, preview = "";
    function path(poly){
      var pts = poly.pts;
      ctx.beginPath();
      for(var i=0;i<pts.length;i+=2){
        var x = (pts[i] + 0.5)*sx, y = (pts[i+1] + 0.5)*sy;
        if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    if(state.blocks.fill){
      ctx.imageSmoothingEnabled = true;
      if(R.detail > 0 && R.angle){   // detail 0 is flat masses
        if(chromaDragging && R.strokeImage && R.strokeSize === W + "x" + H && !R.values){
          ctx.drawImage(R.strokeImage, 0, 0);
          preview = "saturate(" + (state.shapes.chroma/R.strokeChroma).toFixed(3) + ")";
        } else {
          ctx.drawImage(strokesImage(R, W, H), 0, 0);
        }
      } else {
        ctx.drawImage(shapesFillImage(R), 0, 0, W, H);
        R.polys.forEach(function(poly){ ctx.fillStyle = shapeCss(R, poly.id); path(poly); ctx.fill(); });
      }
    }
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if(state.blocks.outlines){
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 3.2*dpr;
      R.polys.forEach(function(poly){ path(poly); ctx.stroke(); });
      ctx.strokeStyle = "rgba(240,236,228,0.92)"; ctx.lineWidth = 1.6*dpr;
      R.polys.forEach(function(poly){ path(poly); ctx.stroke(); });
    }
    if(state.shapesPick !== null){
      ctx.strokeStyle = "#E39A4C"; ctx.lineWidth = 3*dpr;
      var g = R.paint[state.shapesPick];   // every shape of the picked paint
      R.polys.forEach(function(poly){ if(R.paint[poly.id] === g){ path(poly); ctx.stroke(); } });
    }
    if(shapesCanvas.style.filter !== preview) shapesCanvas.style.filter = preview;
  }

  // Two readings for the tapped spot, each with its own Mix button: the
  // shape's colour (its average, with the intensity) and the photo's own
  // colour right there (enhanced if the intensity is shown on the photo).
  function renderShapeReadout(){
    var R = state.shapesResult, k = state.shapesPick, pt = state.shapesPoint;
    var has = !!R && k !== null && k !== undefined && k < R.count;
    shapePrompt.hidden = has; shapeReadout.hidden = !has; photoReadout.hidden = !(has && pt); shapesMarker.hidden = !(has && pt);
    if(!has){
      shapePrompt.textContent = "Tap a mass or a swatch to read its " + (state.grayscale ? "value" : "colour");
      return;
    }
    var pct = Math.max(1, Math.round(R.paintSizes[R.paint[k]]/(R.w*R.h)*100));
    var s = shapeLin(R, k), ms = Munsell.fromLinearRGB(s[0], s[1], s[2]);
    shapeSwatch.style.background = linCss(s);
    shapeText.innerHTML = (R.values ? "Value <b>" + ms.value.toFixed(1) + "</b>" : "<b>" + ms.notation + "</b>") + " · about " + pct + "% of the picture";
    if(!pt) return;   // picked from the palette: no spot on the photo to read

    var p = photoLin(pt), mp = Munsell.fromLinearRGB(p[0], p[1], p[2]);
    photoSwatch.style.background = linCss(p);
    photoText.innerHTML = state.grayscale ? "Value <b>" + mp.value.toFixed(1) + "</b>"
      : "<b>" + mp.notation + "</b>" + (enhanceOn() && state.shapes.chroma !== 100 ? " · intensified" : "");
    placeMarker(shapesMarker, shapesFrame, shapesView, pt, linCss(p));
  }

  // tap a shape to read its colour, and the photo's colour at that spot
  function pickShape(e){
    var R = state.shapesResult;
    if(!R) return;
    var vr = shapesView.getBoundingClientRect(), c = imageRect(shapesFrame);
    if(!vr.width || !vr.height) return;            // not laid out (hidden)
    var u = ((e.clientX - vr.left)/vr.width - c.x)/c.w, v = ((e.clientY - vr.top)/vr.height - c.y)/c.h;
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return;
    state.shapesPoint = { u: u, v: v, pointerType: e.pointerType, r: patchFor(state.ref, vr.width*c.w) };
    state.shapesPick = labelAt(R, state.shapesPoint);
    drawShapes();
    renderPalette();
    renderShapeReadout();
    renderHint();
  }
  // Zooming only moves the picture (and the marker); the shapes are drawn
  // once and scaled, not redrawn for every finger movement.
  function shapesZoomed(){
    shapesZoom.apply();
    if(!shapesMarker.hidden && state.shapesPoint) positionMarker(shapesMarker, shapesFrame, shapesView, state.shapesPoint);
    renderHint();
  }
  // Double tap: clears the selected shape or paint. The first tap of the
  // pair has already picked whatever it landed on, so what was selected
  // *before* it decides: something was selected → just clear it; nothing
  // was → it's the usual double-tap to reset the zoom (and the first
  // tap's pick is cleared too).
  var pickBeforeTap = null;
  function clearShapesPick(){
    state.shapesPick = null; state.shapesPoint = null;
    drawShapes(); renderPalette(); renderShapeReadout();
  }
  attachGestures(shapesFrame, shapesZoom, {
    start: function(e){ pickBeforeTap = state.shapesPick; pickShape(e); },
    move: pickShape,
    doubleTap: function(){
      if(pickBeforeTap === null) shapesZoom.reset();
      clearShapesPick();
      shapesZoomed();
    }
  }, shapesZoomed);

  detailSlider.addEventListener("input", function(){
    state.blocks.detail = Number(detailSlider.value);
    requestShapes(120);
    renderShapesStatus();
  });
  detailSlider.addEventListener("change", persistMeta);
  coloursSlider.addEventListener("input", function(){
    state.blocks.colours = Number(coloursSlider.value);
    requestShapes(120);
    renderShapesStatus();
  });
  coloursSlider.addEventListener("change", persistMeta);
  shapesOpacitySlider.addEventListener("input", function(){
    state.shapes.opacity = Number(shapesOpacitySlider.value);
    shapesCanvas.style.opacity = String(state.shapes.opacity/100);
  });
  shapesOpacitySlider.addEventListener("change", persistMeta);
  // dragging: the brush strokes (slow to paint) are previewed with a
  // saturation filter, and painted for real when the slider is let go
  var chromaDragging = false;
  chromaSlider.addEventListener("input", function(){
    chromaDragging = true;
    state.shapes.chroma = Number(chromaSlider.value);
    // make the change visible: fill the shapes unless it's already shown somewhere
    if(!state.blocks.fill && !state.shapes.enhancePhoto) state.blocks.fill = true;
    render();
  });
  chromaSlider.addEventListener("change", function(){
    chromaDragging = false;
    render();
    persistMeta();
  });
  function toggleShapesOption(name){
    return function(){
      var o = (name === "outlines" || name === "fill") ? state.blocks : state.shapes;
      o[name] = !o[name];
      render();
      persistMeta();
    };
  }
  outlinesSwitch.addEventListener("click", toggleShapesOption("outlines"));
  fillSwitch.addEventListener("click", toggleShapesOption("fill"));
  enhanceSwitch.addEventListener("click", toggleShapesOption("enhancePhoto"));
  if(window.ResizeObserver) new ResizeObserver(function(){ if(state.mode === "blocks"){ shapesZoom.clampPan(); shapesZoom.apply(); drawShapes(); renderShapeReadout(); } }).observe(shapesFrame);

  // ---------------- progress: the painting's stages ----------------
  // One stage per aligned photo (progress.js keeps them on the device).
  // The tab shows one stage large, a slider and thumbnails to move through
  // them, play, delete, save all, and the timelapse video. The history
  // belongs to the reference: a new reference or "Start new painting"
  // clears it (both ask first, with the chance to save the photos).
  var viewProgress = $("view-progress"), progImg = $("progImg"), progInfo = $("progInfo");
  var progPlay = $("progPlay"), progSlider = $("progSlider"), progStrip = $("progStrip"), progEvenSwitch = $("progEvenSwitch");
  var progVideoBtn = $("progVideoBtn"), progSaveAllBtn = $("progSaveAllBtn"), progDeleteBtn = $("progDeleteBtn");
  var progSheetBtn = $("progSheetBtn"), progSpeed = $("progSpeed"), progSpeedLabel = $("progSpeedLabel"), progRefSwitch = $("progRefSwitch");
  var sheetPreview = $("sheetPreview");
  var videoModal = $("videoModal"), videoTitle = $("videoTitle"), videoCanvas = $("videoCanvas"), videoPreview = $("videoPreview");
  var videoBar = $("videoBar"), videoNote = $("videoNote"), videoClose = $("videoClose"), videoSave = $("videoSave");

  var STAGE_DIM = 4000;         // stages and saved paintings: at most this on the long side
  var STAGE_MIN = 2000;         // ...and at least this (a painting small in its photo is enlarged a little)
  var THUMB_DIM = 240;          // the thumbnail strip
  var progIndex = -1, progTimer = null, progUrls = {}, progThumbs = {}, progStripKey = null, progEven = false;
  // video / contact sheet options: time per photo (steps) and whether the reference comes last
  var SPEEDS = [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3], progSpeedIdx = 4, progRef = false;
  function perPhoto(){ return SPEEDS[progSpeedIdx]; }
  function secs(x){ return String(x) + " s"; }
  var progGains = null, progGainsKey = null, progShownKey = null;

  // a stage image from an aligned painting: JPEG, the uncovered warp edge
  // in the app's background colour
  function stageBlob(im){
    var s = Math.min(1, STAGE_DIM/Math.max(im.w, im.h));
    var c = document.createElement("canvas"); c.width = Math.round(im.w*s); c.height = Math.round(im.h*s);
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im.canvas, 0, 0, c.width, c.height);
    return canvasToBlob(c, "image/jpeg", 0.9);
  }
  // The painting straightened at the detail the camera actually captured:
  // from the original painting photo (kept as it was taken), only the
  // canvas area, sized from how many photo pixels it covers (between
  // STAGE_MIN and STAGE_DIM on the long side), in the reference's shape.
  // The photo is cropped to the canvas before straightening, so even a
  // large photo never needs a full-size working copy. Cached for the
  // current photo and corners. Resolves to {blob, w, h} (JPEG).
  var fullCache = null;
  function fullPainting(){
    if(!state.ref || !state.corners) return Promise.reject(new Error("nothing to straighten"));
    var corners = state.corners.map(copyPt), ar = state.ref.w/state.ref.h;
    var key = state.photoKey + "|" + JSON.stringify(corners) + "|" + state.ref.w + "x" + state.ref.h;
    if(fullCache && fullCache.key === key) return fullCache.promise;
    var p = Store.get("photo").then(function(b){
      if(!b) throw new Error("no original photo");
      return decodeBlob(b);
    }).then(function(img){
      var W = img.naturalWidth, H = img.naturalHeight;
      var P = corners.map(function(c){ return { x: c.u*W, y: c.v*H }; });
      function d(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
      var qw = (d(P[0], P[1]) + d(P[3], P[2]))/2, qh = (d(P[0], P[3]) + d(P[1], P[2]))/2, long = Math.max(qw, qh, 1);
      var outLong = clamp(Math.round(long), STAGE_MIN, STAGE_DIM), s = outLong/long;
      var w = ar >= 1 ? outLong : Math.round(outLong*ar), h = ar >= 1 ? Math.round(outLong/ar) : outLong;
      var xs = P.map(function(q){ return q.x; }), ys = P.map(function(q){ return q.y; });
      var x0 = Math.max(0, Math.floor(Math.min.apply(null, xs)) - 2), y0 = Math.max(0, Math.floor(Math.min.apply(null, ys)) - 2);
      var x1 = Math.min(W, Math.ceil(Math.max.apply(null, xs)) + 2), y1 = Math.min(H, Math.ceil(Math.max.apply(null, ys)) + 2);
      var cw = Math.max(1, Math.round((x1 - x0)*s)), ch = Math.max(1, Math.round((y1 - y0)*s));
      var c = document.createElement("canvas"); c.width = cw; c.height = ch;
      var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, cw, ch);
      var cp = P.map(function(q){ return { x: (q.x - x0)*s, y: (q.y - y0)*s }; });
      return warpAsync({ canvas: c, w: cw, h: ch }, cp, w, h);
    }).then(function(im){
      var c = document.createElement("canvas"); c.width = im.w; c.height = im.h;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, im.w, im.h);   // the warp's uncovered edge
      ctx.drawImage(im.canvas, 0, 0);
      return canvasToBlob(c, "image/jpeg", 0.92).then(function(b){ return { blob: b, w: im.w, h: im.h }; });
    });
    fullCache = { key: key, promise: p };
    p.catch(function(){ if(fullCache && fullCache.key === key) fullCache = null; });
    return p;
  }
  function thumbOf(blob){
    return decodeBlob(blob).then(function(img){
      var s = THUMB_DIM/Math.max(img.naturalWidth, img.naturalHeight);
      var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth*s)); c.height = Math.max(1, Math.round(img.naturalHeight*s));
      var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, c.width, c.height);
      return canvasToBlob(c, "image/jpeg", 0.85);
    });
  }
  // a new stage: the full-detail painting (or, if that can't be made, the
  // aligned image as shown) and its thumbnail
  function addStage(im){
    fullPainting().then(function(r){ return r.blob; }).catch(function(){ return stageBlob(im); })
      .then(function(b){ return thumbOf(b).catch(function(){ return null; }).then(function(t){ return Progress.add(b, state.photoKey, t); }); })
      .then(function(r){
        if(progThumbs[r.item.id]){ URL.revokeObjectURL(progThumbs[r.item.id]); delete progThumbs[r.item.id]; }
        if(progUrls[r.item.id]){ URL.revokeObjectURL(progUrls[r.item.id]); delete progUrls[r.item.id]; }
        progIndex = Progress.count() - 1; progStripKey = null; progGains = null;
        render();
      }).catch(storeFail);
  }
  function clearProgress(){
    stopPlay();
    Object.keys(progUrls).forEach(function(id){ URL.revokeObjectURL(progUrls[id]); });
    Object.keys(progThumbs).forEach(function(id){ URL.revokeObjectURL(progThumbs[id]); });
    progUrls = {}; progThumbs = {}; progIndex = -1; progStripKey = null; progGains = null; progShownKey = null;
    return Progress.clear().catch(function(){});
  }
  // the thumbnail's url; stages from before thumbnails get one made (and kept) now
  function thumbUrl(id){
    if(progThumbs[id]) return Promise.resolve(progThumbs[id]);
    return Progress.thumb(id).then(function(t){
      if(t) return t;
      return Progress.blob(id).then(function(b){ return b ? thumbOf(b).then(function(nt){ Progress.setThumb(id, nt); return nt; }) : null; });
    }).then(function(t){ return t ? (progThumbs[id] = progThumbs[id] || URL.createObjectURL(t)) : ""; });
  }
  function urlOfStage(id){
    if(progUrls[id]) return Promise.resolve(progUrls[id]);
    return Progress.blob(id).then(function(b){ if(!b) return ""; return (progUrls[id] = progUrls[id] || URL.createObjectURL(b)); });
  }
  function stageWhen(t, first){
    var d = new Date(t), opts = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
    var when = d.toLocaleString(undefined, opts);
    var mins = Math.round((t - first)/60000), days = Math.floor(mins/1440), hrs = Math.floor((mins % 1440)/60), m = mins % 60;
    var since = mins < 1 ? "Under a minute" : (days ? days + (days === 1 ? " day " : " days ") : "") + (hrs ? hrs + " h " : "") + (!days && m ? m + " min" : "");
    return { when: when, since: since.trim() };
  }

  // the lighting gains for every stage (small copies compared), cached
  function ensureGains(){
    var items = Progress.items(), key = items.map(function(it){ return it.id; }).join(",");
    if(progGains && progGainsKey === key) return Promise.resolve(progGains);
    return Promise.all(items.map(function(it){ return Progress.blob(it.id).then(smallPixels); })).then(function(smalls){
      progGains = Progress.gains(smalls); progGainsKey = key;
      return progGains;
    });
  }
  function decodeBlob(b){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(b), img = new Image();
      img.onload = function(){ resolve(img); setTimeout(function(){ URL.revokeObjectURL(url); }, 0); };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  function smallPixels(b){
    return decodeBlob(b).then(function(img){
      var c = document.createElement("canvas"); c.width = 160; c.height = Math.max(1, Math.round(160*img.naturalHeight/img.naturalWidth));
      var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    });
  }
  // a stage as shown: as photographed, or with the lighting evened out
  function shownStage(i){
    var it = Progress.items()[i];
    if(!progEven) return urlOfStage(it.id);
    return Promise.all([ensureGains(), Progress.blob(it.id)]).then(function(r){
      return decodeBlob(r[1]).then(function(img){
        var s = Math.min(1, 1600/Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth*s); c.height = Math.round(img.naturalHeight*s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        Progress.adjust(c, r[0][i], false);
        return c.toDataURL("image/jpeg", 0.9);
      });
    });
  }

  function renderProgress(){
    var items = Progress.items(), n = items.length;
    if(!n) return;
    if(progIndex < 0 || progIndex >= n) progIndex = n - 1;
    var it = items[progIndex];
    progSlider.max = String(n - 1);
    if(progSlider.value != progIndex) progSlider.value = progIndex;
    progSlider.disabled = n < 2; progPlay.disabled = n < 2;
    var w = stageWhen(it.t, items[0].t);
    // how long since the photo before, and since the first
    var since = progIndex === 0 ? "The first photo"
      : stageWhen(it.t, items[progIndex - 1].t).since + " after the previous" + (progIndex > 1 ? " · " + w.since.toLowerCase() + " after the first" : "");
    progInfo.innerHTML = "<b>Stage " + (progIndex + 1) + " of " + n + "</b> · " + w.when + "<br><span>" + since + "</span>";
    progEvenSwitch.classList.toggle("on", progEven);
    progEvenSwitch.disabled = n < 2;
    progRefSwitch.classList.toggle("on", progRef);
    if(progSpeed.value != progSpeedIdx) progSpeed.value = progSpeedIdx;
    progSpeedLabel.textContent = "· " + secs(perPhoto());
    progVideoBtn.textContent = "Make timelapse video · about " + Math.round(Progress.timeline(n, progRef, perPhoto()).duration) + " s";
    progImg.classList.toggle("gray", state.grayscale);
    // the large view
    var key = it.id + ":" + (progEven ? "e" : "o") + ":" + n;
    if(key !== progShownKey){
      progShownKey = key;
      shownStage(progIndex).then(function(src){ if(progShownKey === key) progImg.src = src; }).catch(function(){});
    }
    // thumbnails, rebuilt only when the list changes
    var skey = items.map(function(x){ return x.id; }).join(",");
    if(skey !== progStripKey){
      progStripKey = skey;
      progStrip.innerHTML = "";
      items.forEach(function(x, i){
        var b = document.createElement("button"), im = document.createElement("img");
        im.alt = "Stage " + (i + 1);
        thumbUrl(x.id).then(function(u){ im.src = u; });
        b.appendChild(im);
        b.addEventListener("click", function(){ stopPlay(); progIndex = i; renderProgress(); renderHint(); });
        progStrip.appendChild(b);
      });
    }
    Array.prototype.forEach.call(progStrip.children, function(b, i){ b.classList.toggle("on", i === progIndex); });
    var on = progStrip.children[progIndex];
    if(on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    progPlay.textContent = progTimer ? "Pause" : "Play";
  }
  progSlider.addEventListener("input", function(){ stopPlay(); progIndex = Number(progSlider.value); renderProgress(); renderHint(); });
  function stopPlay(){ if(progTimer){ clearInterval(progTimer); progTimer = null; progPlay.textContent = "Play"; } }
  progPlay.addEventListener("click", function(){
    if(progTimer){ stopPlay(); return; }
    var n = Progress.count();
    if(progIndex >= n - 1) progIndex = 0;
    renderProgress();
    progTimer = setInterval(function(){
      if(progIndex >= Progress.count() - 1){ stopPlay(); renderProgress(); return; }
      progIndex++; renderProgress(); renderHint();
    }, 700);
    progPlay.textContent = "Pause";
  });
  progEvenSwitch.addEventListener("click", function(){ progEven = !progEven; persistMeta(); renderProgress(); });
  progRefSwitch.addEventListener("click", function(){ progRef = !progRef; persistMeta(); renderProgress(); });
  progSpeed.addEventListener("input", function(){ progSpeedIdx = Number(progSpeed.value); renderProgress(); });
  progSpeed.addEventListener("change", persistMeta);
  progDeleteBtn.addEventListener("click", function(){
    var it = Progress.items()[progIndex];
    if(!it) return;
    askConfirm("Delete stage " + (progIndex + 1) + "? This can't be undone.", "Delete", function(){
      stopPlay();
      if(progUrls[it.id]){ URL.revokeObjectURL(progUrls[it.id]); delete progUrls[it.id]; }
      if(progThumbs[it.id]){ URL.revokeObjectURL(progThumbs[it.id]); delete progThumbs[it.id]; }
      Progress.remove(it.id).catch(function(){});
      progStripKey = null; progGains = null; progShownKey = null;
      if(progIndex >= Progress.count()) progIndex = Progress.count() - 1;
      if(!Progress.count()) state.mode = state.aligned ? "compare" : "align";
      render();
    });
  });

  // ---- saving: all the images, as photographed ----
  // The images have to be in hand before the tap (the share sheet only
  // opens straight from a tap), so they're loaded whenever the tab or a
  // "clear" question is shown.
  var progFilesReady = false;
  function prepareProgressFiles(){ progFilesReady = false; return Progress.loadAll().then(function(){ progFilesReady = true; }).catch(function(){}); }
  function progressFiles(){
    var stamp = fileStamp();
    return Progress.items().map(function(it, i){
      var b = Progress.cached(it.id);
      return b ? new File([b], "comp-art-stage-" + (i < 9 ? "0" : "") + (i + 1) + "-" + stamp + ".jpg", { type: "image/jpeg" }) : null;
    });
  }
  function saveAllProgress(){
    var files = progressFiles();
    if(!progFilesReady || files.some(function(f){ return !f; })){ prepareProgressFiles(); toast("Getting the photos ready. Tap again in a moment."); return; }
    deliverMany(files);
  }
  function deliverMany(files){
    var touch = navigator.maxTouchPoints > 0;
    if(touch && navigator.canShare && navigator.canShare({ files: files })){
      navigator.share({ files: files }).catch(function(e){ if(!e || e.name !== "AbortError") files.forEach(download); });
    } else {
      files.forEach(function(f, i){ setTimeout(function(){ download(f); }, i*250); });
    }
  }
  progSaveAllBtn.addEventListener("click", saveAllProgress);

  // ---- the timelapse video: the stages cross-fading, ending on the reference ----
  // The dialog shows the video being made (or the contact sheet), then the
  // result with a Save button: saving needs a fresh tap, since making it
  // takes longer than iOS allows between a tap and the share sheet.
  var videoRun = null, videoFile = null, videoUrl = null, sheetRun = 0;
  function closeVideo(){
    if(videoRun){ videoRun.cancel(); videoRun = null; }
    sheetRun++;
    videoModal.classList.remove("show");
    videoPreview.pause(); videoPreview.removeAttribute("src");
    sheetPreview.removeAttribute("src");
    if(videoUrl){ URL.revokeObjectURL(videoUrl); videoUrl = null; }
    videoFile = null;
  }
  function openResult(title, note){
    videoTitle.textContent = title; videoNote.textContent = note;
    videoBar.style.width = "0";
    videoCanvas.hidden = true; videoPreview.hidden = true; sheetPreview.hidden = true;
    videoSave.disabled = true; videoClose.textContent = "Cancel";
    videoModal.classList.add("show");
  }
  function showResult(file, title, note){
    videoFile = file; videoUrl = URL.createObjectURL(file);
    videoTitle.textContent = title; videoNote.textContent = note;
    videoSave.textContent = file.type.indexOf("video") === 0 ? "Save video" : "Save image";
    videoSave.disabled = false; videoClose.textContent = "Close";
  }
  progVideoBtn.addEventListener("click", function(){
    var items = Progress.items();
    if(!items.length || !state.ref) return;
    if(!Progress.videoType()){ toast("This browser can't make videos."); return; }
    stopPlay();
    // the video's size: the reference's shape, 1920 px on the long side (even numbers)
    var ar = state.ref.w/state.ref.h, L = 1920;
    var W = ar >= 1 ? L : Math.round(L*ar), H = ar >= 1 ? Math.round(L/ar) : L;
    videoCanvas.width = W - (W % 2); videoCanvas.height = H - (H % 2);
    var per = perPhoto(), withRef = progRef, length = Math.round(Progress.timeline(items.length, withRef, per).duration);
    openResult("Making the timelapse…", "Keep this screen open while it records (about " + length + " s).");
    videoCanvas.hidden = false;
    var gray = state.grayscale;
    var gainsP = progEven && items.length > 1 ? ensureGains() : Promise.resolve(null);
    function frame(k){
      return gainsP.then(function(G){
        var src = k < items.length ? Progress.blob(items[k].id).then(decodeBlob) : refForSaving();
        return src.then(function(img){
          var c = document.createElement("canvas"); c.width = videoCanvas.width; c.height = videoCanvas.height;
          var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, c.width, c.height);
          return Progress.adjust(c, (G && k < items.length) ? G[k] : null, gray);
        });
      });
    }
    videoRun = Progress.record(videoCanvas, items.length, withRef, per, frame, function(f){ videoBar.style.width = Math.round(f*100) + "%"; });
    videoRun.promise.then(function(res){
      videoRun = null;
      var ext = res.type.indexOf("mp4") >= 0 ? "mp4" : "webm";
      showResult(new File([res.blob], "comp-art-timelapse-" + fileStamp() + "." + ext, { type: res.type }), "Timelapse",
                 Math.round(res.seconds) + " seconds, " + Math.max(1, Math.round(res.blob.size/1048576)) + " MB.");
      videoCanvas.hidden = true; videoPreview.hidden = false;
      videoPreview.src = videoUrl; videoPreview.play().catch(function(){});
    }).catch(function(e){
      videoRun = null;
      if(e && e.message === "cancelled") return;
      closeVideo();
      toast("The video couldn't be made on this device.");
    });
  });
  // ---- the contact sheet: every stage in a grid, captioned ----
  // Laid out as close to square as the photos' shape allows, at most 3200 px
  // wide; follows "Even out lighting", "Include the reference" and the
  // black & white button, like the video.
  progSheetBtn.addEventListener("click", function(){
    var items = Progress.items();
    if(!items.length || !state.ref) return;
    stopPlay();
    var run = ++sheetRun, withRef = progRef, gray = state.grayscale, count = items.length + (withRef ? 1 : 0);
    openResult("Making the contact sheet…", "");
    var ar = state.ref.w/state.ref.h, cols = 1, best = Infinity;
    for(var c=1; c<=count; c++){
      var rows = Math.ceil(count/c), d = Math.abs(Math.log(c*ar/rows));
      if(d < best - 1e-9){ best = d; cols = c; }
    }
    var rowsN = Math.ceil(count/cols);
    var CW = Math.min(800, Math.floor(3200/(cols + 0.05*(cols + 1)))), CH = Math.round(CW/ar);
    var gap = Math.round(CW*0.05), cap = Math.round(Math.max(28, CW*0.1));
    var W = cols*CW + (cols + 1)*gap, H = rowsN*(CH + cap) + (rowsN + 1)*gap;
    var s = Math.min(1, Math.sqrt(CANVAS_MAX/(W*H)));          // within the iPad's largest canvas
    if(s < 1){ CW = Math.floor(CW*s); CH = Math.round(CW/ar); gap = Math.round(CW*0.05); cap = Math.round(Math.max(24, CW*0.1)); W = cols*CW + (cols + 1)*gap; H = rowsN*(CH + cap) + (rowsN + 1)*gap; }
    var sheet = document.createElement("canvas"); sheet.width = W; sheet.height = H;
    var ctx = sheet.getContext("2d");
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "middle";
    var first = items[0].t;
    var gainsP = progEven && items.length > 1 ? ensureGains() : Promise.resolve(null);
    function cell(i, img, G, label, sub){
      var col = i % cols, row = Math.floor(i/cols);
      var x = gap + col*(CW + gap), y = gap + row*(CH + cap + gap);
      var c = document.createElement("canvas"); c.width = CW; c.height = CH;
      var cx = c.getContext("2d"); cx.imageSmoothingQuality = "high"; cx.drawImage(img, 0, 0, CW, CH);
      Progress.adjust(c, G, gray);
      ctx.drawImage(c, x, y);
      ctx.fillStyle = "#EDE6D9"; ctx.font = "600 " + Math.round(cap*0.42) + "px -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(label, x, y + CH + cap*0.5);
      if(sub){
        var lw = ctx.measureText(label).width;
        ctx.fillStyle = "#A79C8B"; ctx.font = Math.round(cap*0.36) + "px -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText("  " + sub, x + lw, y + CH + cap*0.5);
      }
    }
    gainsP.then(function(G){
      // one stage at a time, so only one full-size photo is decoded at once
      var chain = Promise.resolve();
      items.forEach(function(it, i){
        chain = chain.then(function(){
          if(run !== sheetRun) throw new Error("cancelled");
          return Progress.blob(it.id).then(decodeBlob).then(function(img){
            var d = new Date(it.t);
            cell(i, img, G ? G[i] : null, "Stage " + (i + 1), d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + (i ? " · " + stageWhen(it.t, first).since : ""));
            videoBar.style.width = Math.round((i + 1)/count*100) + "%";
          });
        });
      });
      return chain.then(function(){
        if(!withRef) return canvasToBlob(sheet, "image/jpeg", 0.9);
        return refForSaving().then(function(src){
          cell(items.length, src, null, "Reference", "");
          return canvasToBlob(sheet, "image/jpeg", 0.9);
        });
      });
    }).then(function(blob){
      if(run !== sheetRun) return;
      videoBar.style.width = "100%";
      showResult(new File([blob], "comp-art-contact-sheet-" + fileStamp() + ".jpg", { type: "image/jpeg" }), "Contact sheet",
                 count + " pictures, " + W + " × " + H + " px.");
      sheetPreview.src = videoUrl; sheetPreview.hidden = false;
    }).catch(function(e){
      if(run !== sheetRun || (e && e.message === "cancelled")) return;
      closeVideo();
      toast("The contact sheet couldn't be made.");
    });
  });

  videoClose.addEventListener("click", closeVideo);
  videoSave.addEventListener("click", function(){ if(videoFile) deliver(videoFile); });

  // ---------------- restart ----------------
  // extra (optional): {label, action}, a third button that runs its action
  // and closes the dialog, e.g. "save the photos first"
  var confirmAction = null, confirmExtraAction = null, confirmExtra = $("confirmExtra");
  function askConfirm(msg, okLabel, action, extra){
    confirmMsg.textContent = msg;
    confirmOk.textContent = okLabel;
    confirmAction = action;
    confirmExtraAction = extra ? extra.action : null;
    confirmExtra.hidden = !extra;
    if(extra) confirmExtra.textContent = extra.label;
    confirmModal.classList.add("show");
  }
  function closeConfirm(){ confirmModal.classList.remove("show"); confirmAction = null; confirmExtraAction = null; }
  confirmExtra.addEventListener("click", function(){ var a = confirmExtraAction; closeConfirm(); if(a) a(); });
  confirmOk.addEventListener("click", function(){ var a = confirmAction; closeConfirm(); if(a) a(); });
  confirmCancel.addEventListener("click", closeConfirm);
  confirmModal.addEventListener("click", function(e){ if(e.target === confirmModal) closeConfirm(); });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(confirmModal.classList.contains("show")) closeConfirm();
    if(palModal.classList.contains("show")){ if(!palListView.hidden) closePalettes(); return; }
    if(mixModal.classList.contains("show")) closeMix();
    if(saveModal.classList.contains("show")) closeSave();
    if(videoModal.classList.contains("show")) closeVideo();
  });

  // ---------------- paint recipes (mix.js) ----------------
  // Shows which of your paints, in what proportions, come closest to a colour.
  var lastRecipe = null;   // what the Mix dialog is showing, to redo it for another palette
  function showRecipe(targetLin, what){
    lastRecipe = { lin: targetLin, what: what };
    fillPaletteSelect();
    mixTitle.textContent = "Mix " + what;
    var paints = Palettes.activePaints();
    if(!paints.length){
      mixResultSw.style.background = "transparent"; mixResultMun.textContent = "";
      mixClose.textContent = "This palette has no paints yet. Add some under Palettes…";
      mixList.innerHTML = ""; mixAlt.hidden = true; mixNote.textContent = "";
      mixModal.classList.add("show");
      return;
    }
    var res = Mix.recipe(targetLin, paints), best = res.best;
    mixTargetSw.style.background = linCss(targetLin);
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
    if(best.approx || (res.closer && res.closer.approx)) notes.push("* Estimated from the paint's pigments or colour rather than measured.");
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

  // ---------------- palettes: choosing, editing, your own paints ----------------
  // The Mix dialog mixes from the active palette (picker at its top); the
  // Palettes dialog over it lists, creates, edits and deletes palettes,
  // and adds your own paints (palettes.js). Everything is saved on the
  // device straight away.
  var mixPalette = $("mixPalette"), mixPalettesBtn = $("mixPalettesBtn");
  var palModal = $("palModal"), palListView = $("palListView"), palEditView = $("palEditView");
  var paintEditView = $("paintEditView"), photoPickView = $("photoPickView");
  var palList = $("palList"), palNewBtn = $("palNewBtn"), palExportBtn = $("palExportBtn"), palImportBtn = $("palImportBtn"), palDoneBtn = $("palDoneBtn");
  var palName = $("palName"), palCount = $("palCount"), paintList = $("paintList"), paintAddBtn = $("paintAddBtn");
  var palDeleteBtn = $("palDeleteBtn"), palEditDone = $("palEditDone");
  var paintEditTitle = $("paintEditTitle"), paintName = $("paintName"), paintPigments = $("paintPigments"), pigChips = $("pigChips");
  var paintColour = $("paintColour"), paintColourState = $("paintColourState"), paintPhotoBtn = $("paintPhotoBtn"), paintColourClear = $("paintColourClear");
  var paintStrengthRow = $("paintStrengthRow"), paintStrength = $("paintStrength"), pvTube = $("pvTube"), pvTint = $("pvTint");
  var paintMsg = $("paintMsg"), paintDeleteBtn = $("paintDeleteBtn"), paintCancel = $("paintCancel"), paintSave = $("paintSave");
  var pickCanvas = $("pickCanvas"), pickSw = $("pickSw"), pickTxt = $("pickTxt"), pickCancel = $("pickCancel"), pickUse = $("pickUse");
  var pickFrame = $("pickFrame"), pickView = $("pickView"), photoPickMarker = $("photoPickMarker");
  var pickInput = $("pickInput"), importInput = $("importInput");

  function persistPalettes(){ Palettes.save(Store).catch(storeFail); }
  function fillPaletteSelect(){
    mixPalette.innerHTML = "";
    Palettes.list().forEach(function(p){
      var o = document.createElement("option"); o.value = p.id; o.textContent = p.name;
      mixPalette.appendChild(o);
    });
    mixPalette.value = Palettes.activeId();
  }
  mixPalette.addEventListener("change", function(){
    Palettes.setActive(mixPalette.value);
    persistPalettes();
    if(lastRecipe) showRecipe(lastRecipe.lin, lastRecipe.what);
  });

  function showPalView(v){
    palListView.hidden = v !== "list"; palEditView.hidden = v !== "edit";
    paintEditView.hidden = v !== "paint"; photoPickView.hidden = v !== "pick";
    palModal.querySelector(".pal-box").scrollTop = 0;
  }
  function openPalettes(){ renderPalList(); showPalView("list"); palModal.classList.add("show"); }
  function closePalettes(){
    palModal.classList.remove("show");
    fillPaletteSelect();
    if(lastRecipe && mixModal.classList.contains("show")) showRecipe(lastRecipe.lin, lastRecipe.what);
  }
  mixPalettesBtn.addEventListener("click", openPalettes);
  palDoneBtn.addEventListener("click", closePalettes);
  palModal.addEventListener("click", function(e){ if(e.target === palModal && !palListView.hidden) closePalettes(); });

  function chip(css){ var c = document.createElement("span"); c.style.background = css; return c; }
  function renderPalList(){
    palList.innerHTML = "";
    Palettes.list().forEach(function(pal){
      var li = document.createElement("li"), row = document.createElement("div");
      row.className = "pal-row" + (pal.id === Palettes.activeId() ? " on" : "");
      var dot = document.createElement("span"); dot.className = "pal-dot";
      var main = document.createElement("div"); main.className = "pal-main";
      var name = document.createElement("span"); name.className = "pal-name"; name.textContent = pal.name;
      var chips = document.createElement("span"); chips.className = "pal-chips";
      pal.paints.map(Palettes.paintById).filter(Boolean).forEach(function(p){ chips.appendChild(chip(p.css)); });
      main.appendChild(name); main.appendChild(chips);
      var btn = document.createElement("button"); btn.className = "btn small";
      btn.textContent = pal.builtin ? "Copy" : "Edit";
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        editPalette(pal.builtin ? Palettes.create(pal) : pal);
      });
      row.addEventListener("click", function(){ Palettes.setActive(pal.id); persistPalettes(); renderPalList(); });
      row.appendChild(dot); row.appendChild(main); row.appendChild(btn);
      li.appendChild(row); palList.appendChild(li);
    });
  }
  palNewBtn.addEventListener("click", function(){ editPalette(Palettes.create(Palettes.active())); });

  // ---- one palette: its name and which paints are in it ----
  var editPal = null;
  function editPalette(pal){
    editPal = { id: pal.id, name: pal.name, paints: pal.paints.slice() };
    palName.value = editPal.name;
    renderPaintList();
    showPalView("edit");
  }
  palName.addEventListener("input", function(){ editPal.name = palName.value; });
  function renderPaintList(){
    paintList.innerHTML = "";
    var paints = Palettes.allPaints(), builtIn = paints.filter(function(p){ return p.builtin; }), mine = paints.filter(function(p){ return !p.builtin; });
    function group(title, list){
      var h = document.createElement("li"); h.className = "paint-group"; h.textContent = title; paintList.appendChild(h);
      list.forEach(function(p){
        var li = document.createElement("li"); li.className = "paint-row";
        var lab = document.createElement("label");
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = editPal.paints.indexOf(p.id) >= 0;
        cb.addEventListener("change", function(){
          var i = editPal.paints.indexOf(p.id);
          if(cb.checked && i < 0) editPal.paints.push(p.id);
          if(!cb.checked && i >= 0) editPal.paints.splice(i, 1);
          renderPalCount();
        });
        var c = document.createElement("span"); c.className = "mix-chip"; c.style.background = p.css;
        var txt = document.createElement("span"); txt.className = "paint-txt";
        var nm = document.createElement("span"); nm.textContent = p.name + (p.approx ? " *" : "");
        var pg = document.createElement("span"); pg.className = "paint-pig"; pg.textContent = p.pigments || "by colour";
        txt.appendChild(nm); txt.appendChild(pg);
        lab.appendChild(cb); lab.appendChild(c); lab.appendChild(txt);
        li.appendChild(lab);
        if(p.user){
          var ed = document.createElement("button"); ed.className = "btn ghost small"; ed.textContent = "Edit";
          ed.addEventListener("click", function(){ openPaintEditor(p.id); });
          li.appendChild(ed);
        }
        paintList.appendChild(li);
      });
    }
    group("Built in", builtIn);
    if(mine.length) group("Your paints", mine);
    renderPalCount();
  }
  function renderPalCount(){
    var n = editPal.paints.length;
    palCount.textContent = n ? n + (n === 1 ? " paint" : " paints") + " in this palette" + (n > 9 ? " · recipes use the 9 best suited to each colour" : "")
                             : "Tick the paints you have.";
    palEditDone.disabled = !n;
  }
  palEditDone.addEventListener("click", function(){
    if(!editPal.paints.length) return;
    Palettes.savePalette(editPal);
    Palettes.setActive(editPal.id);
    persistPalettes();
    renderPalList();
    showPalView("list");
  });
  palDeleteBtn.addEventListener("click", function(){
    var pal = editPal;
    askConfirm("Delete the palette “" + (pal.name || "My palette") + "”? Its paints stay in your list.", "Delete", function(){
      Palettes.deletePalette(pal.id);
      persistPalettes();
      renderPalList();
      showPalView("list");
    });
  });

  // ---- one of your paints ----
  var editPaint = null;
  function openPaintEditor(id){
    var rec = id ? Palettes.paintRecord(id) : null;
    editPaint = rec || { name: "", pigments: "", variants: {}, colour: null, strength: 0 };
    if(!editPaint.variants) editPaint.variants = {};
    paintEditTitle.textContent = rec ? "Edit paint" : "Add a paint";
    paintName.value = editPaint.name;
    paintPigments.value = editPaint.pigments || "";
    paintStrength.value = String(editPaint.strength || 0);
    paintDeleteBtn.hidden = !rec;
    updatePaint();
    showPalView("paint");
  }
  paintAddBtn.addEventListener("click", function(){ openPaintEditor(null); });
  function hex(rgb){ return "#" + rgb.map(function(v){ return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }
  function updatePaint(){
    editPaint.name = paintName.value;
    editPaint.pigments = paintPigments.value;
    var r = Palettes.resolve(editPaint);
    // the codes found, with a choice where one code covers several paints
    pigChips.innerHTML = "";
    r.chips.forEach(function(c){
      var row = document.createElement("div"); row.className = "pig-chip" + (c.known ? "" : " unknown");
      var b = document.createElement("b"); b.textContent = c.code;
      row.appendChild(b);
      if(c.variants){
        var sel = document.createElement("select");
        c.variants.forEach(function(v){ var o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
        sel.value = c.variant;
        sel.addEventListener("change", function(){ editPaint.variants[c.base] = sel.value; updatePaint(); });
        row.appendChild(sel);
      } else {
        var t = document.createElement("span"); t.textContent = c.known ? c.name : "not in the pigment list";
        row.appendChild(t);
      }
      pigChips.appendChild(row);
    });
    paintColourState.textContent = editPaint.colour ? "Set" : "Not set";
    if(editPaint.colour) paintColour.value = hex(editPaint.colour);
    paintColourClear.hidden = !editPaint.colour;
    // strength only matters for a paint described by its colour alone
    paintStrengthRow.hidden = !(r.ok && !r.chips.some(function(c){ return c.known; }));
    pvTube.style.background = r.ok ? r.paint.css : "transparent";
    pvTint.style.background = r.ok ? Mix.tint(r.paint, 0.15) : "transparent";
    paintMsg.textContent = r.msg;
    paintSave.disabled = !r.ok || !editPaint.name.trim();
  }
  paintName.addEventListener("input", updatePaint);
  paintPigments.addEventListener("input", updatePaint);
  paintColour.addEventListener("input", function(){
    var v = paintColour.value;
    editPaint.colour = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    updatePaint();
  });
  paintColourClear.addEventListener("click", function(){ editPaint.colour = null; updatePaint(); });
  paintStrength.addEventListener("change", function(){ editPaint.strength = Number(paintStrength.value) || 0; updatePaint(); });
  paintCancel.addEventListener("click", function(){ renderPaintList(); showPalView("edit"); });
  paintSave.addEventListener("click", function(){
    var isNew = !editPaint.id;
    editPaint.name = editPaint.name.trim();
    var id = Palettes.savePaint(editPaint);
    if(isNew && editPal.paints.indexOf(id) < 0) editPal.paints.push(id);   // a new paint goes into the palette being edited
    persistPalettes();
    renderPaintList();
    showPalView("edit");
  });
  paintDeleteBtn.addEventListener("click", function(){
    var rec = editPaint;
    askConfirm("Delete “" + rec.name + "”? It's taken out of every palette.", "Delete", function(){
      Palettes.deletePaint(rec.id);
      editPal.paints = editPal.paints.filter(function(x){ return x !== rec.id; });
      persistPalettes();
      renderPaintList();
      showPalView("edit");
    });
  });

  // ---- the tube colour from a photo (a swatch, a manufacturer's chart) ----
  // Pinch to zoom in (double-tap to zoom out), tap or drag to read: the
  // ring shows the spot, and the patch read is what's inside the ring.
  var pickIm = null, pickColour = null, pickPt = null;
  var pickZoom = makeZoom([pickView], 16);
  paintPhotoBtn.addEventListener("click", function(){ pickInput.click(); });
  pickInput.addEventListener("change", function(){
    var f = pickInput.files && pickInput.files[0];
    pickInput.value = "";
    if(!f) return;
    decodeToCanvas(f, 3000).then(function(im){
      pickIm = im; pickColour = null; pickPt = null;
      pickCanvas.width = im.w; pickCanvas.height = im.h;
      pickCanvas.getContext("2d").drawImage(im.canvas, 0, 0);
      pickSw.style.background = "transparent"; pickTxt.textContent = "Tap the photo · pinch to zoom in"; pickUse.disabled = true;
      photoPickMarker.hidden = true;
      pickZoom.reset(); pickZoom.apply();
      showPalView("pick");
      fitPickFrame();
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });
  // the frame takes the photo's shape, as wide as the dialog and at most 60% of the screen tall
  function fitPickFrame(){
    if(!pickIm) return;
    pickFrame.style.width = ""; pickFrame.style.height = "";
    var W = pickFrame.parentNode.clientWidth, ar = pickIm.w/pickIm.h, h = Math.min(W/ar, 0.6*window.innerHeight);
    pickFrame.style.width = Math.round(h*ar) + "px"; pickFrame.style.height = Math.round(h) + "px";
  }
  function placePickMarker(){
    if(!pickPt){ photoPickMarker.hidden = true; return; }
    var fr = pickFrame.getBoundingClientRect(), vr = pickView.getBoundingClientRect();
    photoPickMarker.style.left = (vr.left - fr.left + pickPt.u*vr.width) + "px";
    photoPickMarker.style.top = (vr.top - fr.top + pickPt.v*vr.height) + "px";
    photoPickMarker.classList.toggle("touch", pickPt.pointerType === "touch");
    photoPickMarker.classList.toggle("below", pickPt.pointerType === "touch" && vr.top - fr.top + pickPt.v*vr.height < 96);
    photoPickMarker.hidden = false;
  }
  function pickAt(e){
    if(!pickIm) return;
    var vr = pickView.getBoundingClientRect();
    var u = (e.clientX - vr.left)/vr.width, v = (e.clientY - vr.top)/vr.height;
    var s = samplePatch(pickIm, u, v, patchFor(pickIm, vr.width));
    if(!s) return;
    pickPt = { u: u, v: v, pointerType: e.pointerType };
    pickColour = [toSrgb(s.r), toSrgb(s.g), toSrgb(s.b)];
    var css = "rgb(" + pickColour.join(",") + ")";
    pickSw.style.background = css;
    photoPickMarker.querySelector(".pm-ring").style.background = css;
    pickTxt.textContent = "This colour";
    pickUse.disabled = false;
    placePickMarker();
  }
  attachGestures(pickFrame, pickZoom, { start: pickAt, move: pickAt }, function(){ pickZoom.apply(); placePickMarker(); });
  pickCancel.addEventListener("click", function(){ showPalView("paint"); });
  pickUse.addEventListener("click", function(){
    if(pickColour) editPaint.colour = pickColour;
    pickIm = null;
    updatePaint();
    showPalView("paint");
  });

  // ---- export / import ----
  palExportBtn.addEventListener("click", function(){
    var data = JSON.stringify(Palettes.exportData(), null, 1);
    deliver(new File([data], "comp-art-palettes-" + fileStamp() + ".json", { type: "application/json" }));
  });
  palImportBtn.addEventListener("click", function(){ importInput.click(); });
  importInput.addEventListener("change", function(){
    var f = importInput.files && importInput.files[0];
    importInput.value = "";
    if(!f) return;
    f.text().then(function(txt){
      var added = Palettes.importData(JSON.parse(txt));
      if(!added){ toast("That file isn't a Comp-Art palettes export."); return; }
      persistPalettes();
      renderPalList();
      toast("Added " + added.palettes + (added.palettes === 1 ? " palette" : " palettes") + " and " + added.paints + (added.paints === 1 ? " paint." : " paints."));
    }).catch(function(){ toast("That file couldn't be read."); });
  });

  // reference colour at the spot read on the compare / side-by-side views
  ccMixBtn.addEventListener("click", function(){
    if(state.reading) showRecipe(state.reading.r.lin, "the reference colour");
  });
  // the tapped shape's colour as shown (including any colour intensity)
  shapeMixBtn.addEventListener("click", function(){
    var R = state.shapesResult, k = state.shapesPick;
    if(R && k !== null) showRecipe(shapeLin(R, k), state.grayscale ? "this value" : "this paint");
  });
  // the photo's own colour at the tapped spot, as shown
  photoMixBtn.addEventListener("click", function(){
    if(state.shapesPoint) showRecipe(photoLin(state.shapesPoint), state.grayscale ? "the photo's value here" : "the photo's colour here");
  });

  // ---------------- saving images ----------------
  // The aligned painting on its own, or reference and painting in one image
  // (side by side for an upright or square reference, one above the other
  // for a wide one), at working resolution, in black & white when values
  // mode is on. The JPEGs are made when the dialog opens, so the share
  // sheet can open straight from the tap that chooses one (iOS only allows
  // it within a tap).
  var saveFiles = null, saveSeq = 0;
  function grayCopy(im, src){
    var c = document.createElement("canvas"); c.width = im.w; c.height = im.h;
    var ctx = c.getContext("2d");
    ctx.drawImage(src || im.canvas, 0, 0, im.w, im.h);
    if(state.grayscale){
      var img = ctx.getImageData(0, 0, im.w, im.h), d = img.data;
      for(var i=0;i<d.length;i+=4){ var y = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; d[i] = d[i+1] = d[i+2] = y; }
      ctx.putImageData(img, 0, 0);
    }
    return c;
  }
  // the painting for saving: the full-detail version (fullPainting), or the
  // aligned image as shown if that can't be made. Resolves to a drawable
  // with its size {src, w, h, blob?} (blob: the JPEG, when it can be used as is).
  function paintingForSaving(){
    return fullPainting().then(function(r){
      return decodeBlob(r.blob).then(function(img){ return { src: img, w: r.w, h: r.h, blob: r.blob }; });
    }).catch(function(){
      var c = paintingCanvas();
      return { src: c, w: c.width, h: c.height, blob: null };
    });
  }
  // the reference for saving at size w × h: the boosted one if the switch
  // is on, else the original file, decoded at that size
  function referenceForSaving(w, h){
    if(refIntensityOn()) return refForSaving();
    return Store.get("ref").then(function(b){
      if(!b) return state.ref.canvas;
      return decodeToCanvas(b, Math.max(w, h)).then(function(im){ return im.canvas; });
    }).catch(function(){ return state.ref.canvas; });
  }
  function paintingCanvas(){
    var c = grayCopy(state.aligned), ctx = c.getContext("2d");
    // the warp leaves any area outside the photo transparent: JPEG would
    // make it black, so it goes on the app's background colour instead
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  // (scaled down if needed to stay within iOS's largest canvas, 16.7 MP;
  // the painting drawn at the reference's size, which an older, smaller
  // aligned image may not match)
  var CANVAS_MAX = 16000000;
  function sideBySideCanvas(refSrc, paint){
    var row = state.ref.w <= state.ref.h, pw = paint ? paint.w : state.ref.w, ph = paint ? paint.h : state.ref.h;
    var W0 = row ? 2.02*pw : pw, H0 = row ? ph : 2.02*ph;
    var s = Math.min(1, Math.sqrt(CANVAS_MAX/(W0*H0)));
    var w = Math.round(pw*s), h = Math.round(ph*s), gap = Math.round(0.02*Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = row ? 2*w + gap : w; c.height = row ? h : 2*h + gap;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(grayCopy({ w: w, h: h }, refSrc || state.ref.canvas), 0, 0, w, h);
    ctx.drawImage(paint ? grayCopy({ w: w, h: h }, paint.src) : paintingCanvas(), row ? w + gap : 0, row ? 0 : h + gap, w, h);
    return c;
  }
  function fileStamp(){
    var d = new Date(), p = function(n){ return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
  function openSave(){
    if(!state.ref || !state.aligned) return;
    var seq = ++saveSeq;
    saveFiles = null;
    savePaintingBtn.disabled = saveSideBtn.disabled = true;
    savePaintingBtn.textContent = saveSideBtn.textContent = "Preparing…";
    saveNote.textContent = state.grayscale ? "In black & white, since values mode is on." : refNote();
    saveModal.classList.add("show");
    var stamp = fileStamp();
    // let the dialog draw before the (brief) work of making the images
    requestAnimationFrame(function(){ setTimeout(function(){
      if(seq !== saveSeq) return;
      paintingForSaving().then(function(paint){
        if(seq !== saveSeq) throw new Error("closed");
        return referenceForSaving(paint.w, paint.h).then(function(refSrc){
          if(seq !== saveSeq) throw new Error("closed");
          // the painting's JPEG as is, unless it has to be made black & white
          var paintBlob = (paint.blob && !state.grayscale) ? Promise.resolve(paint.blob)
                        : canvasToBlob(grayCopy({ w: paint.w, h: paint.h }, paint.src), "image/jpeg", 0.92);
          return Promise.all([paintBlob, canvasToBlob(sideBySideCanvas(refSrc, paint), "image/jpeg", 0.92)]);
        });
      }).then(function(b){
        if(seq !== saveSeq) return;
        saveFiles = {
          painting: new File([b[0]], "comp-art-painting-" + stamp + ".jpg", { type: "image/jpeg" }),
          side: new File([b[1]], "comp-art-side-by-side-" + stamp + ".jpg", { type: "image/jpeg" })
        };
        savePaintingBtn.textContent = "Painting photo";
        saveSideBtn.textContent = "Reference and painting side by side";
        savePaintingBtn.disabled = saveSideBtn.disabled = false;
      }).catch(function(){
        if(seq !== saveSeq) return;
        closeSave();
        toast("The images couldn't be made. Try again.");
      });
    }, 0); });
  }
  function closeSave(){ saveSeq++; saveModal.classList.remove("show"); }
  // iPad (and other touch devices): the share sheet, with "Save Image" for
  // Photos. Elsewhere, or if sharing isn't possible: a download.
  function deliver(file){
    var touch = navigator.maxTouchPoints > 0;
    if(touch && navigator.canShare && navigator.canShare({ files: [file] })){
      navigator.share({ files: [file] }).catch(function(e){ if(!e || e.name !== "AbortError") download(file); });
    } else {
      download(file);
    }
  }
  function download(file){
    var url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
  }
  saveBtn.addEventListener("click", openSave);
  savePaintingBtn.addEventListener("click", function(){ if(saveFiles){ var f = saveFiles.painting; closeSave(); deliver(f); } });
  saveSideBtn.addEventListener("click", function(){ if(saveFiles){ var f = saveFiles.side; closeSave(); deliver(f); } });
  saveCancel.addEventListener("click", closeSave);
  saveModal.addEventListener("click", function(e){ if(e.target === saveModal) closeSave(); });

  function restart(){
    clearProgress();
    state.ref = null; state.photo = null; state.aligned = null; state.photoKey = null;
    newShapesSource();
    state.corners = null; state.lastCorners = null;
    state.offU = 0; state.offV = 0; state.adjusting = false; state.opacityBeforeAdjust = null;
    state.reading = null; state.peeking = false; state.mode = "align";
    pinZoom.reset(); compareZoom.reset(); sideZoom.reset();
    render();
    // the photos, their settings and the progress go; your palettes and paints stay
    ["ref", "photo", "aligned", "meta"].forEach(function(k){ Store.remove(k).catch(function(){}); });
    try{ localStorage.removeItem(LEGACY_KEY); }catch(e){}
  }
  restartBtn.addEventListener("click", function(){
    // Straight on to choosing the new reference. The picker has to open
    // within the tap on "Start new" (iOS only allows it from a user
    // gesture), and it does: the confirm button runs this synchronously.
    // Cancelling it leaves the usual "Add reference photo" screen.
    var n = Progress.count();
    if(n) prepareProgressFiles();
    askConfirm("Start a new painting? This clears your reference and painting photos" + (n ? ", and the " + n + " progress photo" + (n > 1 ? "s" : "") : "") + ".", "Start new", function(){
      restart();
      refInput.click();
    }, n ? { label: "Save the progress photos first", action: saveAllProgress } : null);
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
    Palettes.load(Store);
    Progress.init(Store).then(render);
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
      state.photoKey = typeof meta.photoKey === "string" ? meta.photoKey : null;
      progEven = !!meta.progEven;
      progRef = !!meta.progRef;
      if(meta.progSpeed !== undefined) progSpeedIdx = clamp(Math.round(Number(meta.progSpeed) || 0), 0, SPEEDS.length - 1);
      if(meta.shapes && typeof meta.shapes === "object"){
        var s = meta.shapes;
        state.shapes = {
          opacity: s.opacity === undefined ? 100 : clamp(Number(s.opacity) || 0, 0, 100),
          chroma: clamp(Number(s.chroma) || 100, 100, 300),
          enhancePhoto: !!s.enhancePhoto
        };
      }
      if(meta.blocks && typeof meta.blocks === "object"){
        var b = meta.blocks;
        var detail = b.detail === undefined ? 50 : clamp(Math.round((Number(b.detail) || 0)/10)*10, 0, 100);   // steps of 10
        // before v2.14 one slider set both: derive the colours it implied
        var colours = b.colours === undefined ? Math.round(6*Math.pow(40/6, detail/100)) : Number(b.colours);
        state.blocks = { colours: clamp(Math.round((colours || 12)/2)*2, 6, 40), detail: detail, outlines: !!b.outlines, fill: b.fill !== false };   // steps of 2
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
