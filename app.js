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
    cmpView: "compare", // which compare view the Compare tab opens: "compare" (overlay) or "side"
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
    // masses, then brush strokes from big to small; fill.
    blocks: { colours: 12, detail: 50, fill: true },
    shapesResult: null, // latest analysis (labels, average colours, outlines)
    shapesBusy: false,
    shapesPick: null,   // id of the tapped shape
    shapesPoint: null   // where it was tapped {u, v, pointerType}, for the photo's own colour there
  };

  // ---------------- element refs ----------------
  var $ = function(id){ return document.getElementById(id); };
  var tabs = $("tabs"), stepHint = $("stepHint");
  var grayBtn = $("grayBtn"), menuBtn = $("menuBtn");
  var projectBtn = $("projectBtn"), projectName = $("projectName");
  var projModal = $("projModal"), projList = $("projList"), projNewBtn = $("projNewBtn"), projDone = $("projDone");
  var nameModal = $("nameModal"), nameInput = $("nameInput"), nameOk = $("nameOk"), nameCancel = $("nameCancel"), nameTitle = $("nameTitle");
  var menuModal = $("menuModal"), menuProjects = $("menuProjects"), menuPalettes = $("menuPalettes"), menuSync = $("menuSync"), menuDone = $("menuDone");

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
  var leadInRow = $("leadInRow"), leadInSeg = $("leadInSeg"), leadInMin = 0;
  function setLeadIn(min){
    leadInMin = min;
    Array.prototype.forEach.call(leadInSeg.children, function(b){ b.classList.toggle("on", Number(b.dataset.min) === min); });
  }
  leadInSeg.addEventListener("click", function(e){
    var b = e.target.closest("button[data-min]");
    if(b) setLeadIn(Number(b.dataset.min));
  });

  var viewAlign = $("view-align"), viewCompare = $("view-compare"), viewSide = $("view-side");
  var compareFrame = $("compareFrame"), compareView = $("compareView"), compareRef = $("compareRef"), compareCur = $("compareCur");
  var opacitySlider = $("opacitySlider");
  var adjustSwitch = $("adjustSwitch"), resetPosBtn = $("resetPosBtn");
  var cmpBar = $("cmpBar"), cmpSeg = $("cmpSeg"), compareBarSlot = $("compareBarSlot"), sideBarSlot = $("sideBarSlot");
  var newPhotoBtn = $("newPhotoBtn"), adjustAlignBtn = $("adjustAlignBtn"), alignBackBtn = $("alignBackBtn");
  var blocksMoreBtn = $("blocksMoreBtn"), blocksMore = $("blocksMore");
  var exportModal = $("exportModal"), exportNote = $("exportNote"), exportDone = $("exportDone"), progExportBtn = $("progExportBtn");
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
  var fillSwitch = $("fillSwitch");
  var shapeSwatch = $("shapeSwatch"), shapeText = $("shapeText"), shapePrompt = $("shapePrompt"), shapeReadout = $("shapeReadout");
  var photoReadout = $("photoReadout"), photoSwatch = $("photoSwatch"), photoText = $("photoText"), photoMixBtn = $("photoMixBtn");
  var enhanceRow = $("enhanceRow"), enhanceSwitch = $("enhanceSwitch"), shapesPhoto = $("shapesPhoto"), shapesMarker = $("shapesMarker");

  var colorCard = $("colorCard"), compareCardSlot = $("compareCardSlot"), sideCardSlot = $("sideCardSlot");
  var fullBtn = $("fullBtn"), fullBar = $("fullBar"), shapeReadouts = $("shapeReadouts");
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

  // Display URL for an image object, made once: a high-quality JPEG of the
  // canvas, encoded without blocking the page (toBlob) and held as an object
  // URL. Colour readings come from the canvas itself.
  function imageUrl(im){
    if(im.url) return Promise.resolve(im.url);
    if(!im.urlPromise) im.urlPromise = canvasToBlob(im.canvas, "image/jpeg", 0.95).then(function(b){ im.url = URL.createObjectURL(b); return im.url; });
    return im.urlPromise;
  }
  function setSrc(img, im){
    if(img._im === im) return;     // already showing this image
    img._im = im;
    if(!im){ img.removeAttribute("src"); return; }
    imageUrl(im).then(function(u){ if(img._im === im) img.src = u; }).catch(function(){});
  }
  // an image object that's no longer shown: its URL goes
  function dropImage(im){
    if(im && im.url){ URL.revokeObjectURL(im.url); im.url = null; }
    if(im) im.urlPromise = null;
  }

  // ---------------- persistence (IndexedDB) ----------------
  // Original photo files are stored as-is; corners, offsets and settings as
  // a small record. The aligned painting isn't stored: it's made again from
  // the photo and corners when the project opens (the same pixels every
  // time), which saves a slow PNG encode, 10 MB or more of storage and the
  // same again in sync uploads. Failures never block the app.
  // PStore: the open project's data (Projects.scoped); palettes use Store.
  var PStore = null;
  var storeWarned = false;
  function storeFail(){
    if(!storeWarned) toast("Photos couldn't be saved on this device, but this session works fine.");
    storeWarned = true;
  }
  // The alignment (the photo's corners, the last Align, the position nudge)
  // is also kept as its own record, "align", which goes with the painting
  // photo: it's written only when the alignment changed here, so changing a
  // view setting on one device can't send that device's older alignment
  // over a newer one from another (sync takes the newest of each record).
  // alignLoaded: the alignment as the open project was loaded (null while
  // it loads, when nothing is written).
  var alignLoaded = null;
  function alignRecord(){
    return { corners: state.corners, lastCorners: state.lastCorners, offU: state.offU, offV: state.offV, photoKey: state.photoKey, aligned: !!state.aligned };
  }
  function persistMeta(){
    if(!PStore) return;
    Projects.touch(Projects.activeId());
    PStore.set("meta", { v: 2, corners: state.corners, lastCorners: state.lastCorners, offU: state.offU, offV: state.offV, shapes: state.shapes, blocks: state.blocks, photoKey: state.photoKey, aligned: !!state.aligned, cmpView: state.cmpView, progEven: progEven, progRef: progRef, progSpeed: progSpeedIdx, progHeader: progHeader, progStarts: progStarts }).catch(storeFail);
    var a = alignRecord(), sa = JSON.stringify(a);
    if(alignLoaded !== null && sa !== alignLoaded){ alignLoaded = sa; PStore.set("align", a).catch(storeFail); }
  }
  function persistBlob(key, blob){ return PStore ? PStore.set(key, blob).catch(storeFail) : Promise.resolve(); }

  // ---------------- render ----------------
  // Derives every visible thing from state. Safe to call often.
  function render(){
    var m = state.mode, hasRef = !!state.ref, hasPhoto = !!state.photo, hasAligned = !!state.aligned;

    // tabs and views
    Array.prototype.forEach.call(tabs.querySelectorAll("button"), function(b){
      var bm = b.dataset.mode;
      b.classList.toggle("active", bm === m || (bm === "compare" && (m === "side" || m === "align")));
      if(bm === "progress") b.disabled = !Progress.count();
      else b.disabled = !hasRef;      // Block-in needs only the reference; Compare starts with adding the painting
    });
    // the compare bar goes with whichever compare view is showing
    var barSlot = (m === "side") ? sideBarSlot : compareBarSlot;
    if(cmpBar.parentElement !== barSlot.parentElement || cmpBar.previousElementSibling !== barSlot) barSlot.parentNode.insertBefore(cmpBar, barSlot.nextSibling);
    Array.prototype.forEach.call(cmpSeg.children, function(b){
      var on = b.dataset.view === m;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    alignBackBtn.hidden = !hasAligned;
    show(viewAlign, m === "align");
    show(viewCompare, m === "compare");
    show(viewSide, m === "side");
    show(viewShapes, m === "blocks");
    show(viewProgress, m === "progress");
    grayBtn.hidden = (m === "align");
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
    // a new photo with the painting clock stopped: how long was painted before it
    var aligned = !!state.photoKey && Progress.items().some(function(it){ return it.key === state.photoKey; });
    var askLeadIn = m === "align" && hasRef && hasPhoto && !aligned && liveSinceMs() === null;
    if(!askLeadIn && leadInMin) setLeadIn(0);
    leadInRow.hidden = !askLeadIn;
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
    renderLiveTimer();

    // ---- shapes ----
    if(hasRef && m === "blocks") renderShapes();

    // full screen: the button in the picture's corner, and the controls kept on screen
    renderFull(m);

    // colour card: one card, shown in whichever view is active (floating, in full screen)
    var slot = (state.full && (m === "compare" || m === "side")) ? fullBar : (m === "side") ? sideCardSlot : compareCardSlot;
    if(colorCard.parentElement !== slot) slot.insertBefore(colorCard, slot.firstChild);
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
    var proj = Projects.active();
    if(proj && projectName.textContent !== proj.name) projectName.textContent = proj.name;
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

  // ---------------- full screen ----------------
  // The picture takes the whole screen: header, tabs and controls hide, and
  // the one control each view needs most floats over the picture (the
  // opacity in Compare, the stage slider in Progress; the colour reading in
  // Compare, Side by side and Block-in, once there is one). Everything done on the
  // picture itself (zoom, peek, readings) works as usual. In-memory only.
  var FULL_PICTURE = { compare: "compareFrame", side: "sideFit", blocks: "shapesFrame", progress: "progFrame" };
  // a control moves into the floating bar and back to where it was
  function park(el){
    if(el.parentElement === fullBar) return;
    if(!el._home){ el._home = document.createComment("home"); el.parentNode.insertBefore(el._home, el); }
    fullBar.appendChild(el);
  }
  function unpark(el){ if(el._home && el.parentElement === fullBar) el._home.parentNode.insertBefore(el, el._home); }
  function renderFull(m){
    var pic = FULL_PICTURE[m] ? $(FULL_PICTURE[m]) : null;
    if(state.full && !pic) state.full = false;             // align: always with its controls
    document.body.classList.toggle("full", !!state.full);
    fullBtn.hidden = !pic;
    var fit = pic && (pic.classList.contains("fit") ? pic : pic.closest(".fit"));
    if(fit && fullBtn.parentElement !== fit) fit.appendChild(fullBtn);
    fullBtn.title = state.full ? "Show the controls" : "Full screen";
    fullBtn.setAttribute("aria-label", fullBtn.title);
    var opacityRow = opacitySlider.closest(".ctrl-row"), scrub = progSlider.closest(".prog-scrub");
    if(state.full && m === "compare") park(opacityRow); else unpark(opacityRow);
    if(state.full && m === "progress") park(scrub); else unpark(scrub);
    if(state.full && m === "blocks") park(shapeReadouts); else unpark(shapeReadouts);
  }
  fullBtn.addEventListener("click", function(){ state.full = !state.full; render(); });

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
      // middle mouse button drags the zoomed picture
      if(e.pointerType === "mouse" && e.button === 1){
        ptrs = {}; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        begin(); frame.style.cursor = "grabbing";
        return;
      }
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
      frame.style.cursor = "";
      if(gesture){
        if(count() >= 1) begin(); else gesture = null; // remaining finger pans
      } else if(single.end){
        single.end(e);
      }
    }
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);
    // stop the browser's middle-click autoscroll
    frame.addEventListener("mousedown", function(e){ if(e.button === 1) e.preventDefault(); });

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
    // Compare before there's an aligned painting: the step that adds one
    if((m === "compare" || m === "side") && !state.aligned){ if(!state.ref) return; m = "align"; }
    if(m === "blocks" && !state.ref) return;
    if(m === "progress" && !Progress.count()) return;
    if(m === "progress" && m !== state.mode) progIndex = Progress.count() - 1;
    if(m === "compare" || m === "side") state.cmpView = m;
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
    setMode(b.dataset.mode === "compare" ? state.cmpView : b.dataset.mode);
  });
  cmpSeg.addEventListener("click", function(e){
    var b = e.target.closest("button[data-view]");
    if(b) setMode(b.dataset.view);
  });
  // Align is a step: a new photo of the painting, or adjusting the current one's corners
  newPhotoBtn.addEventListener("click", function(){ setMode("align"); curInput.click(); });
  adjustAlignBtn.addEventListener("click", function(){ setMode("align"); });
  alignBackBtn.addEventListener("click", function(){ if(state.aligned) setMode(state.cmpView); });
  grayBtn.addEventListener("click", function(){ state.grayscale = !state.grayscale; state.shapesPick = null; render(); });

  // ---------------- loading photos ----------------
  // forNew: the photo starts a new project, made only once a photo is picked
  // (cancelling the picker leaves no empty project behind)
  var refForNew = false;
  function pickReference(forNew){ refForNew = !!forNew; refInput.click(); }
  refInput.addEventListener("cancel", function(){ refForNew = false; });
  addRefBtn.addEventListener("click", function(){ pickReference(false); });
  changeRefBtn.addEventListener("click", function(){
    var n = Progress.count();
    if(!n){ pickReference(false); return; }
    // the progress photos belong to this reference: a different one is a new painting
    askConfirm("This project has " + n + " progress photo" + (n > 1 ? "s" : "") + " of its reference. Start a new project with a different reference? This one is kept.",
      "New project", function(){ pickReference(true); });
  });
  refInput.addEventListener("change", function(){
    var f = refInput.files && refInput.files[0], forNew = refForNew;
    refInput.value = ""; refForNew = false;
    if(!f) return;
    decodeToCanvas(f, WORK_DIM).then(function(im){
      if(!forNew){ useReference(f, im); return; }
      return openProject(Projects.create()).then(function(){ persistMeta(); useReference(f, im); });
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });
  function useReference(f, im){
      dropImage(state.ref); dropImage(state.photo); dropImage(state.aligned);
      state.ref = im;
      newShapesSource();
      clearProgress();
      state.aligned = null; state.photo = null; state.corners = null;
      state.offU = 0; state.offV = 0; state.reading = null;
      state.mode = "align";
      render();
      persistBlob("ref", f);
      PStore.remove("photo").catch(function(){});
      PStore.remove("aligned").catch(function(){});
      persistMeta();
      // the project's picture in the list, until it has progress photos
      thumbOf(f).then(function(t){ PStore.set("thumb", t); }).catch(function(){});
  }

  addCurBtn.addEventListener("click", function(){ curInput.click(); });
  retakeBtn.addEventListener("click", function(){ curInput.click(); });
  curInput.addEventListener("change", function(){
    var f = curInput.files && curInput.files[0];
    curInput.value = "";
    if(!f) return;
    decodeToCanvas(f, SRC_MAX).then(function(im){
      var reused = setPhoto(im, null);
      state.photoKey = Date.now().toString(36);    // a new painting photo: aligning it adds a stage
      dropImage(state.aligned);
      state.aligned = null; state.reading = null;
      state.mode = "align";
      render();
      // Find the canvas: snap the remembered corners on a retake (already
      // close, so also zoom in for fine-tuning), or guess from scratch.
      if(reused) requestAnimationFrame(zoomToPainting);
      detectCanvas(reused ? "snap" : "guess");
      persistBlob("photo", f);
      PStore.remove("aligned").catch(function(){});
      persistMeta();
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });

  // Installs a painting photo as the warp source. Corners: the given ones,
  // else the last alignment's if the photo has the same shape (same camera,
  // same setup), else the extreme corners of the photo.
  function setPhoto(im, corners){
    if(state.photo !== im) dropImage(state.photo);
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
    var leadIn = leadInRow.hidden ? 0 : leadInMin;
    state.busy = true;
    render();
    var cornersPx = cornersToPx(state.corners, state.photo.w, state.photo.h);
    warpAsync(state.photo, cornersPx, state.ref.w, state.ref.h).then(function(im){
      dropImage(state.aligned);
      state.aligned = im;
      state.offU = 0; state.offV = 0;
      state.adjusting = false; state.opacityBeforeAdjust = null;
      state.lastCorners = { ar: state.photo.w/state.photo.h, pts: state.corners.map(copyPt) };
      state.reading = null;
      compareZoom.reset(); sideZoom.reset();
      state.busy = false;
      state.mode = state.cmpView;
      setLeadIn(0);
      render();
      persistMeta();
      PStore.remove("aligned").catch(function(){});   // an older version's stored copy
      addStage(im, leadIn);
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
  // canvas texture), and otherwise as wide as the marker's centre dot on
  // screen (the point you aim with), so zooming in reads finer detail, down
  // to a single pixel.
  var RING_R = 3;            // css px: radius of the marker's centre dot
  function patchRadius(im){ return Math.max(1, Math.round(Math.max(im.w, im.h) / 300)); }
  // radius for an image shown `shownW` css px wide
  function patchFor(im, shownW){
    var side = 2*RING_R*im.w/Math.max(1, shownW);          // the dot's width in image pixels
    return clamp(Math.round((side - 1)/2), 0, patchRadius(im));   // the nearest odd square: 2r+1
  }
  function samplePatch(im, u, v, radius){
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    var cx = Math.floor(u*im.w), cy = Math.floor(v*im.h), r = radius == null ? patchRadius(im) : radius;
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
  // ---- the reading loupe ----
  // While a finger holds a picture, a loupe above it shows the spot at 2x
  // what's on screen: the left picture on the left half, the right one on
  // the right, with the averaged patch outlined at the centre. Touch only
  // (a mouse pointer hides nothing). left/right: {src, du, dv, under,
  // alpha}, where src is the shown <img> or <canvas>, du/dv shift where
  // it's sampled (the painting's position offset), and a layer shown over
  // another (the block-in over the reference) gives that one as under and
  // its own opacity as alpha.
  var readLoupe = $("readLoupe"), READ_D = 140, READ_MAG = 2;
  function showReadLoupe(e, view, frame, u, v, patch, left, right){
    if(e.pointerType !== "touch"){ hideReadLoupe(); return; }
    var dpr = window.devicePixelRatio || 1, D = READ_D, R = D/2;
    if(readLoupe.width !== D*dpr){ readLoupe.width = D*dpr; readLoupe.height = D*dpr; }
    var vr = view.getBoundingClientRect(), c = imageRect(frame);
    var sw = vr.width*c.w*READ_MAG, sh = vr.height*c.h*READ_MAG;  // loupe px per picture width/height
    var ctx = readLoupe.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, D, D);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI*2); ctx.clip();
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, D, D);
    ctx.imageSmoothingQuality = "high";
    // a picture placed so that (u, v) lands on the centre. Only the part
    // inside the loupe is drawn: zoomed in, the whole picture at loupe
    // scale is tens of thousands of pixels across, which Safari's canvas
    // is slow to resample even though nearly all of it is clipped away.
    function place(s, alpha){
      var el = s && s.src, w = el && (el.naturalWidth || el.width), h = el && (el.naturalHeight || el.height);
      if(!w || !h) return;
      var ox = R - (u - (s.du || 0))*sw, oy = R - (v - (s.dv || 0))*sh;   // where the picture's corner falls
      var x0 = clamp(-ox*w/sw, 0, w), x1 = clamp((D - ox)*w/sw, 0, w);
      var y0 = clamp(-oy*h/sh, 0, h), y1 = clamp((D - oy)*h/sh, 0, h);
      if(x1 <= x0 || y1 <= y0) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(el, x0, y0, x1 - x0, y1 - y0, ox + x0*sw/w, oy + y0*sh/h, (x1 - x0)*sw/w, (y1 - y0)*sh/h);
      ctx.globalAlpha = 1;
    }
    [left, right].forEach(function(s, i){
      if(!s) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(i ? R : 0, 0, R, D); ctx.clip();
      if(s.under) place(s.under, 1);
      place(s, s.alpha === undefined ? 1 : s.alpha);
      ctx.restore();
    });
    // the averaged patch, and the split above and below it
    var half = Math.max(3, (patch || 3)/state.ref.w*sw/2);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.strokeRect(R - half, R - half, 2*half, 2*half);
    ctx.beginPath(); ctx.moveTo(R, 0); ctx.lineTo(R, R - half - 6); ctx.moveTo(R, R + half + 6); ctx.lineTo(R, D); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.strokeRect(R - half, R - half, 2*half, 2*half);
    ctx.beginPath(); ctx.moveTo(R, 0); ctx.lineTo(R, R - half - 6); ctx.moveTo(R, R + half + 6); ctx.lineTo(R, D); ctx.stroke();
    ctx.restore();
    readLoupe.style.filter = state.grayscale ? "grayscale(1)" : "";
    // above the finger (below it near the top), kept on screen sideways
    var lift = 110, x = clamp(e.clientX, R + 6, window.innerWidth - R - 6), y = e.clientY - lift;
    if(y - R < 6) y = e.clientY + lift;
    readLoupe.style.left = x + "px";
    readLoupe.style.top = y + "px";
    readLoupe.hidden = false;
    document.body.classList.add("reading");
  }
  function hideReadLoupe(){
    if(readLoupe.hidden) return;
    readLoupe.hidden = true;
    document.body.classList.remove("reading");
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
    var cmp = view === compareView;
    showReadLoupe(e, view, frame, u, v, 2*rr + 1, { src: cmp ? compareRef : sideRef },
                  { src: cmp ? compareCur : sideCur, du: state.offU, dv: state.offV });
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
      hideReadLoupe();
      if(posDrag){ posDrag = null; persistMeta(); }
      if(state.peeking){ state.peeking = false; render(); }
    },
    cancel: function(){
      hideReadLoupe();
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
      move: function(e){ readAt(e, pair[0], pair[1]); },
      end: hideReadLoupe,
      cancel: hideReadLoupe
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
    // the shapes layer over the reference photo
    shapesCanvas.style.opacity = String(state.shapes.opacity/100);
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
    var shownRef = { src: shapesPhoto.hidden ? shapesRef : shapesPhoto };
    showReadLoupe(e, shapesView, shapesFrame, u, v, 2*state.shapesPoint.r + 1,
                  shownRef, { src: shapesCanvas, under: shownRef, alpha: state.shapes.opacity/100 });
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
    end: hideReadLoupe,
    cancel: hideReadLoupe,
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
  blocksMoreBtn.addEventListener("click", function(){
    var open = blocksMore.hidden;
    blocksMore.hidden = !open;
    blocksMoreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    try{ localStorage.setItem("compart.blocksMore", open ? "1" : ""); }catch(e){}
  });
  try{ if(localStorage.getItem("compart.blocksMore")){ blocksMore.hidden = false; blocksMoreBtn.setAttribute("aria-expanded", "true"); } }catch(e){}
  function toggleShapesOption(name){
    return function(){
      var o = name === "fill" ? state.blocks : state.shapes;
      o[name] = !o[name];
      render();
      persistMeta();
    };
  }
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
  var progStartBtn = $("progStartBtn"), progStartNote = $("progStartNote"), progLiveTimer = $("progLiveTimer");
  var progSheetBtn = $("progSheetBtn"), progSpeed = $("progSpeed"), progSpeedLabel = $("progSpeedLabel"), progRefSwitch = $("progRefSwitch");
  var sheetPreview = $("sheetPreview");
  var videoModal = $("videoModal"), videoTitle = $("videoTitle"), videoCanvas = $("videoCanvas"), videoPreview = $("videoPreview");
  var videoBar = $("videoBar"), videoNote = $("videoNote"), videoClose = $("videoClose"), videoSave = $("videoSave");

  var STAGE_DIM = 4000;         // stages and saved paintings: at most this on the long side
  var STAGE_MIN = 2000;         // ...and at least this (a painting small in its photo is enlarged a little)
  var THUMB_DIM = 240;          // the thumbnail strip
  var progIndex = -1, progTimer = null, progUrls = {}, progThumbs = {}, progStripKey = null, progEven = false;
  // video / contact sheet options: time per photo (steps) and whether the reference comes last
  var SPEEDS = [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3], progSpeedIdx = 4, progRef = false, progHeader = false;
  var progStarts = [];   // times "Start painting" was pressed
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
    var p = PStore.get("photo").then(function(b){
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
  // When a JPEG was taken, from its camera data (EXIF DateTimeOriginal, else
  // DateTime), as a time in ms; null if it has none. Without a time zone
  // offset in the file, the time is taken as local.
  function exifTime(blob){
    if(!blob || !blob.slice) return Promise.resolve(null);
    return blob.slice(0, 256*1024).arrayBuffer().then(function(buf){
      var d = new DataView(buf), n = d.byteLength;
      if(n < 4 || d.getUint16(0) !== 0xFFD8) return null;
      var p = 2;
      while(p + 4 <= n && d.getUint8(p) === 0xFF){
        var marker = d.getUint8(p + 1), len = d.getUint16(p + 2);
        if(marker === 0xE1 && p + 10 <= n && d.getUint32(p + 4) === 0x45786966) return readTiff(d, p + 10, Math.min(n, p + 2 + len));
        if(marker === 0xDA) break;          // the image data: no camera data before it
        p += 2 + len;
      }
      return null;
    }).catch(function(){ return null; });
  }
  function readTiff(d, base, end){
    var le = d.getUint16(base) === 0x4949;
    function u16(o){ return d.getUint16(base + o, le); }
    function u32(o){ return d.getUint32(base + o, le); }
    function ascii(entry){
      var count = u32(entry + 4), off = count > 4 ? u32(entry + 8) : entry + 8, s = "";
      for(var i = 0; i < count - 1 && base + off + i < end; i++) s += String.fromCharCode(d.getUint8(base + off + i));
      return s;
    }
    function tags(ifd){
      var out = {};
      if(base + ifd + 2 > end) return out;
      for(var i = 0, k = u16(ifd); i < k; i++){
        var e = ifd + 2 + i*12;
        if(base + e + 12 > end) break;
        out[u16(e)] = e;
      }
      return out;
    }
    var ifd0 = tags(u32(4)), exif = ifd0[0x8769] ? tags(u32(ifd0[0x8769] + 8)) : {};
    var when = exif[0x9003] ? ascii(exif[0x9003]) : (ifd0[0x0132] ? ascii(ifd0[0x0132]) : "");
    var zone = exif[0x9011] ? ascii(exif[0x9011]) : "";
    var m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(when);
    if(!m) return null;
    var z = /^([+-])(\d\d):(\d\d)$/.exec(zone), t;
    if(z) t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (z[1] === "-" ? -1 : 1)*(z[2]*60 + +z[3])*60000;
    else t = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return isFinite(t) ? t : null;
  }
  // a new stage: the full-detail painting (or, if that can't be made, the
  // aligned image as shown) and its thumbnail, at the time the photo was
  // taken where the photo says (else now). leadIn: minutes painted before it.
  function addStage(im, leadIn){
    var now = Date.now();
    var timeP = PStore.get("photo").then(exifTime).catch(function(){ return null; }).then(function(t){
      return (t && t > Date.UTC(2000, 0, 1) && t <= now + 5*60000) ? Math.min(t, now) : now;
    });
    fullPainting().then(function(r){ return r.blob; }).catch(function(){ return stageBlob(im); })
      .then(function(b){ return Promise.all([thumbOf(b).catch(function(){ return null; }), timeP]).then(function(r){
        var t = r[0];
        return Progress.add(b, state.photoKey, t, r[1]).then(function(res){
          // the project's picture: the latest stage
          var items = Progress.items();
          if(t && items[items.length - 1].id === res.item.id) PStore.set("thumb", t).catch(function(){});
          return res;
        });
      }); })
      .then(function(r){
        // painting before this photo, as answered: a session start that long before it
        if(leadIn && !r.replaced){
          progStarts.push(r.item.t - leadIn*60000);
          progStarts.sort(function(a, b){ return a - b; });
          persistMeta();
        }
        if(progThumbs[r.item.id]){ URL.revokeObjectURL(progThumbs[r.item.id]); delete progThumbs[r.item.id]; }
        if(progUrls[r.item.id]){ URL.revokeObjectURL(progUrls[r.item.id]); delete progUrls[r.item.id]; }
        progIndex = Progress.items().map(function(it){ return it.id; }).indexOf(r.item.id);   // an older photo goes in its place in time
        progStripKey = null; progGains = null;
        Projects.touch(Projects.activeId(), Progress.count());
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
  // Estimated painting time up to stage i: the gaps between photos added up,
  // leaving out any gap longer than WORK_GAP (taken to be time away).
  // A "Start painting" mark (progStarts) begins a session: the time from it
  // to the next photo counts, the time before it doesn't.
  // The session is the run of counted gaps that ends at stage i.
  var WORK_GAP = 3*60*60000;
  function workSpans(items, i){
    var end = items[i].t, marks = progStarts.filter(function(t){ return t < end; }).map(function(t){ return { t: t, start: true }; });
    var ev = items.slice(0, i + 1).concat(marks).sort(function(a, b){ return a.t - b.t; }), ms = 0, sess = 0;
    for(var k = 1; k < ev.length; k++){
      var gap = ev[k].t - ev[k-1].t;
      if(!ev[k].start && gap <= WORK_GAP){ ms += gap; sess += gap; } else sess = 0;
    }
    return { total: ms, session: sess };
  }
  function workMs(items, i){ return workSpans(items, i).total; }
  function minsText(ms){
    var mins = Math.round(ms/60000), h = Math.floor(mins/60), m = mins % 60;
    return mins < 1 ? "under a minute" : ((h ? h + " h " : "") + (m ? m + " min" : "")).trim();
  }
  function workTime(items, i){ return minsText(workMs(items, i)); }
  // The painting clock: running until WORK_GAP after the last photo or
  // "Start painting". Gives the time since then, or null once stopped.
  function liveSinceMs(){
    var items = Progress.items(), n = items.length;
    if(!n) return null;
    var lastPhoto = items[n - 1].t, lastStart = progStarts.length ? progStarts[progStarts.length - 1] : 0;
    var since = Date.now() - Math.max(lastPhoto, lastStart);
    return (since < 0 || since > WORK_GAP) ? null : since;
  }
  // Beside "Start painting": the running time since the last photo (or
  // start), and the total painting time, which runs with it.
  var liveTick = null;
  function renderLiveTimer(){
    var items = Progress.items(), on = state.mode === "progress" && !document.hidden && items.length > 0;
    var since = on ? liveSinceMs() : null;
    progLiveTimer.hidden = since === null;
    if(since !== null){
      var s = Math.floor(since/1000), h = Math.floor(s/3600), m = Math.floor(s/60) % 60;
      progLiveTimer.textContent = h + ":" + (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }
    if(on){
      var mins = Math.floor((workMs(items, items.length - 1) + (since || 0))/60000), th = Math.floor(mins/60), tm = mins % 60;
      progStartNote.textContent = "Total " + (th ? th + " h " : "") + tm + " min";
    }
    if(since !== null && !liveTick) liveTick = setInterval(renderLiveTimer, 1000);
    if(since === null && liveTick){ clearInterval(liveTick); liveTick = null; }
  }
  document.addEventListener("visibilitychange", renderLiveTimer);

  // the lighting gains for every stage (small copies compared: the stored
  // thumbnails, so no full-size stage has to be decoded), cached
  function ensureGains(){
    var items = Progress.items(), key = items.map(function(it){ return it.id; }).join(",");
    if(progGains && progGainsKey === key) return Promise.resolve(progGains);
    return Promise.all(items.map(function(it){
      return Progress.thumb(it.id).then(function(t){ return t ? smallPixels(t) : Progress.blob(it.id).then(smallPixels); });
    })).then(function(smalls){
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
    // how far into its painting session, and the painting time so far
    var spans = workSpans(items, progIndex), work = " · about " + minsText(spans.total) + " of painting so far";
    var sess = minsText(spans.session);
    var since = progIndex === 0 ? "The first photo" + (spans.total ? work : "")
      : (spans.session ? sess.charAt(0).toUpperCase() + sess.slice(1) + " into this session" : "First photo of a new session") + work;
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
  // a session's start; pressed again before a photo, it moves to now
  progStartBtn.addEventListener("click", function(){
    var items = Progress.items(), last = items.length ? items[items.length - 1].t : 0, now = Date.now();
    if(progStarts.length && progStarts[progStarts.length - 1] > last) progStarts[progStarts.length - 1] = now;
    else progStarts.push(now);
    persistMeta(); renderProgress(); renderLiveTimer();
  });
  progRefSwitch.addEventListener("click", function(){
    progRef = !progRef; persistMeta(); renderProgress();
    if(exportModal.classList.contains("show")) prepareStageFiles();
  });
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
      Projects.touch(Projects.activeId(), Progress.count());
      progStripKey = null; progGains = null; progShownKey = null;
      if(progIndex >= Progress.count()) progIndex = Progress.count() - 1;
      if(!Progress.count()) state.mode = state.aligned ? "compare" : "align";
      render();
    });
  });

  // the cached pictures of the stages go (a stage may have changed)
  function forgetStageCaches(){
    Object.keys(progUrls).forEach(function(k){ URL.revokeObjectURL(progUrls[k]); });
    Object.keys(progThumbs).forEach(function(k){ URL.revokeObjectURL(progThumbs[k]); });
    progUrls = {}; progThumbs = {}; progStripKey = null; progShownKey = null; progGains = null; progFilesReady = false;
  }

  // ---- saving: all the images, as photographed ----
  // The images have to be in hand before the tap (the share sheet only
  // opens straight from a tap), so they're loaded when Share & export opens.
  // With "Include the reference", the reference comes too (at its
  // intensity when that switch is on, else the original file).
  var progFilesReady = false, progRefFile = null;
  function prepareProgressFiles(){
    progFilesReady = false;
    return Promise.all([Progress.loadAll(), referenceFile()]).then(function(r){ progRefFile = r[1]; progFilesReady = true; }).catch(function(){});
  }
  function referenceFile(){
    if(!state.ref) return Promise.resolve(null);
    var name = "comp-art-reference-" + fileStamp();
    if(refIntensityOn()) return refForSaving().then(function(src){
      var c = document.createElement("canvas"); c.width = state.ref.w; c.height = state.ref.h;
      if(src.naturalWidth){ c.width = src.naturalWidth; c.height = src.naturalHeight; }
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      return canvasToBlob(c, "image/jpeg", 0.92);
    }).then(function(b){ return new File([b], name + ".jpg", { type: "image/jpeg" }); });
    return PStore.get("ref").then(function(b){
      if(!b) return null;
      var ext = /png/.test(b.type) ? "png" : /heic|heif/.test(b.type) ? "heic" : /webp/.test(b.type) ? "webp" : "jpg";
      return new File([b], name + "." + ext, { type: b.type || "image/jpeg" });
    });
  }
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
    if(progRef && progRefFile) files.push(progRefFile);
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
  function openExport(){
    stopPlay();
    prepareProgressFiles();
    var n = Progress.count();
    var how = (progEven && n > 1 ? ", with the lighting evened out" : "") + (state.grayscale ? ", in black & white" : "");
    exportNote.textContent = n + (n === 1 ? " stage" : " stages") + how + "." + (refNote() ? " " + refNote() : "");
    var p = Projects.active();
    progHeaderIn.value = p ? p.name : "";
    renderHeaderOption();
    renderProgress();
    exportModal.classList.add("show");
    prepareStageFiles();
  }
  function closeExport(){ stageSeq++; clearTimeout(stageTimer); exportModal.classList.remove("show"); }

  // ---- this stage: on its own or beside the reference, with the header ----
  // Made as the dialog opens (and again when a switch or the header
  // changes), so the share sheet can open straight from the tap that saves
  // it. As shown: lighting evened out, black & white, the reference's intensity.
  var progSaveStageBtn = $("progSaveStageBtn");
  var progHeaderSwitch = $("progHeaderSwitch"), progHeaderField = $("progHeaderField"), progHeaderIn = $("progHeaderIn");
  var stageFiles = null, stageSeq = 0, stageTimer = 0;
  function headerText(){ return progHeader ? progHeaderIn.value.trim() : ""; }
  function renderHeaderOption(){ progHeaderSwitch.classList.toggle("on", progHeader); progHeaderField.hidden = !progHeader; }
  function stageButtons(ready){
    var items = Progress.items(), it = items[progIndex];
    progSaveStageBtn.disabled = !ready;
    progSaveStageBtn.textContent = !ready ? "Preparing…" : "Save this stage" + (it ? " · " + (progIndex + 1) + " of " + items.length + ", " + new Date(it.t).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
  }
  function prepareStageFiles(){
    var seq = ++stageSeq, items = Progress.items(), i = progIndex, it = items[i];
    stageFiles = null; stageButtons(false);
    if(!it || !state.ref) return;
    var header = headerText(), withRef = progRef, gray = state.grayscale, stamp = fileStamp(), num = (i < 9 ? "0" : "") + (i + 1);
    // let the dialog draw before the work of making the images
    requestAnimationFrame(function(){ setTimeout(function(){
      if(seq !== stageSeq) return;
      Promise.all([progEven && items.length > 1 ? ensureGains() : null, Progress.blob(it.id), header ? headerFont() : null]).then(function(r){
        var G = r[0] ? r[0][i] : null, blob = r[1];
        if(!blob) throw new Error("missing");
        return decodeBlob(blob).then(function(img){
          if(seq !== stageSeq) throw new Error("closed");
          var w = img.naturalWidth, h = img.naturalHeight, src = img;
          if(G || gray){
            src = document.createElement("canvas"); src.width = w; src.height = h;
            src.getContext("2d").drawImage(img, 0, 0);
            Progress.adjust(src, G, gray);
          }
          if(withRef) return referenceForSaving(w, h).then(function(ref){
            if(seq !== stageSeq) throw new Error("closed");
            return canvasToBlob(sideBySideCanvas(ref, { src: src, w: w, h: h }, header), "image/jpeg", 0.92);
          });
          if(header) return canvasToBlob(headedCanvas(src, w, h, header), "image/jpeg", 0.92);
          // the stage's JPEG as is, unless it was changed
          return src === img ? blob : canvasToBlob(src, "image/jpeg", 0.92);
        });
      }).then(function(b){
        if(seq !== stageSeq) return;
        stageFiles = { stage: new File([b], "comp-art-stage-" + num + (withRef ? "-with-reference-" : "-") + stamp + ".jpg", { type: "image/jpeg" }) };
        stageButtons(true);
      }).catch(function(){
        if(seq !== stageSeq) return;
        progSaveStageBtn.textContent = "Couldn't be made";
      });
    }, 0); });
  }
  progSaveStageBtn.addEventListener("click", function(){ if(stageFiles) deliver(stageFiles.stage); });
  progHeaderSwitch.addEventListener("click", function(){
    progHeader = !progHeader; persistMeta(); renderHeaderOption();
    prepareStageFiles();
    if(progHeader) setTimeout(function(){ progHeaderIn.focus(); progHeaderIn.select(); }, 50);
  });
  // typing: the image with the reference is made again once typing pauses
  progHeaderIn.addEventListener("input", function(){
    stageSeq++; stageFiles = null; stageButtons(false);
    clearTimeout(stageTimer); stageTimer = setTimeout(prepareStageFiles, 500);
  });
  progHeaderIn.addEventListener("keydown", function(e){ if(e.key === "Enter") progHeaderIn.blur(); });

  // The header band across the top of a saved image: its height and text
  // size for an image W × H (sized by its area, so it reads the same on
  // side by side, stacked and contact sheet images); drawHeader writes the text, centred, in the
  // app's title font (smaller if it's too long for the width).
  function headerBand(W, H){ var f = Math.max(22, Math.round(0.04*Math.sqrt(W*H))); return { font: f, h: Math.round(f*2.2) }; }
  function drawHeader(ctx, W, band, text){
    var f = band.font, face = "px Fraunces, Georgia, serif";
    ctx.save();
    ctx.fillStyle = "#EDE6D9"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 " + f + face;
    while(ctx.measureText(text).width > W*0.92 && f > 10){ f = Math.round(f*0.9); ctx.font = "600 " + f + face; }
    ctx.fillText(text, W/2, band.h*0.54);
    ctx.restore();
  }
  // a stage on its own with the header above it
  function headedCanvas(src, w, h, header){
    var s = Math.min(1, Math.sqrt(CANVAS_MAX/(w*(h + headerBand(w, h).h))));
    w = Math.round(w*s); h = Math.round(h*s);
    var band = headerBand(w, h), c = document.createElement("canvas");
    c.width = w; c.height = h + band.h;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, c.width, c.height);
    drawHeader(ctx, w, band, header);
    ctx.drawImage(src, 0, band.h, w, h);
    return c;
  }
  // the title font, loaded before a header is drawn (a canvas doesn't wait for it)
  function headerFont(){
    return (document.fonts && document.fonts.load) ? document.fonts.load("600 40px Fraunces").catch(function(){}) : Promise.resolve();
  }
  progExportBtn.addEventListener("click", openExport);
  exportDone.addEventListener("click", closeExport);
  exportModal.addEventListener("click", function(e){ if(e.target === exportModal) closeExport(); });

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
    closeExport();
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
    closeExport();
    var items = Progress.items();
    if(!items.length || !state.ref) return;
    stopPlay();
    var run = ++sheetRun, withRef = progRef, gray = state.grayscale, count = items.length + (withRef ? 1 : 0), header = headerText();
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
    var band = header ? headerBand(W, H) : null, top = band ? band.h : 0;
    var sheet = document.createElement("canvas"); sheet.width = W; sheet.height = H + top;
    var ctx = sheet.getContext("2d");
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, W, H + top);
    ctx.textBaseline = "middle";
    var gainsP = progEven && items.length > 1 ? ensureGains() : Promise.resolve(null);
    function cell(i, img, G, label, sub){
      var col = i % cols, row = Math.floor(i/cols);
      var x = gap + col*(CW + gap), y = top + gap + row*(CH + cap + gap);
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
    Promise.all([gainsP, header ? headerFont() : null]).then(function(r){
      var G = r[0];
      if(header){ drawHeader(ctx, W, band, header); ctx.textAlign = "start"; ctx.textBaseline = "middle"; }
      // one stage at a time, so only one full-size photo is decoded at once
      var chain = Promise.resolve();
      items.forEach(function(it, i){
        chain = chain.then(function(){
          if(run !== sheetRun) throw new Error("cancelled");
          return Progress.blob(it.id).then(decodeBlob).then(function(img){
            var d = new Date(it.t);
            cell(i, img, G ? G[i] : null, "Stage " + (i + 1), d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + (i ? " · " + workTime(items, i) + " painting" : ""));
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
                 count + " pictures, " + W + " × " + (H + top) + " px.");
      sheetPreview.src = videoUrl; sheetPreview.hidden = false;
    }).catch(function(e){
      if(run !== sheetRun || (e && e.message === "cancelled")) return;
      closeVideo();
      toast("The contact sheet couldn't be made.");
    });
  });

  videoClose.addEventListener("click", closeVideo);
  videoSave.addEventListener("click", function(){ if(videoFile) deliver(videoFile); });

  // ---------------- dialogs ----------------
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
    if(state.full && !document.querySelector(".modal.show")){ state.full = false; render(); return; }
    if(confirmModal.classList.contains("show")) closeConfirm();
    if(PU.onEscape()) return;
    if(videoModal.classList.contains("show")) closeVideo();
    if(exportModal.classList.contains("show")) closeExport();
    if(nameModal.classList.contains("show")) closeName();
    if(!SU.closeIfOpen() && projModal.classList.contains("show")) closeProjects();
    if(menuModal.classList.contains("show")) closeMenu();
  });

  // ---------------- paint recipes and palettes: palettes-ui.js ----------------
  var PU = PalettesUI({
    $: $, toast: toast, askConfirm: askConfirm, show: show, state: state, storeFail: storeFail,
    decodeToCanvas: decodeToCanvas, deliver: deliver, fileStamp: fileStamp, attachGestures: attachGestures, makeZoom: makeZoom,
    linCss: linCss, toSrgb: toSrgb, patchFor: patchFor, samplePatch: samplePatch, photoLin: photoLin, shapeLin: shapeLin,
    mixModal: mixModal, mixTitle: mixTitle, mixTargetSw: mixTargetSw, mixResultSw: mixResultSw, mixClose: mixClose, mixList: mixList,
    mixAlt: mixAlt, mixAltTitle: mixAltTitle, mixAltList: mixAltList, mixNote: mixNote, mixDone: mixDone,
    mixTargetMun: mixTargetMun, mixResultMun: mixResultMun, ccMixBtn: ccMixBtn, shapeMixBtn: shapeMixBtn, photoMixBtn: photoMixBtn
  });

  // ---------------- saving images ----------------
  // (from Progress › Share & export: a stage on its own, or with the
  // reference; see prepareStageFiles)
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
  // the reference for saving at size w × h: the boosted one if the switch
  // is on, else the original file, decoded at that size
  function referenceForSaving(w, h){
    if(refIntensityOn()) return refForSaving();
    return PStore.get("ref").then(function(b){
      if(!b) return state.ref.canvas;
      return decodeToCanvas(b, Math.max(w, h)).then(function(im){ return im.canvas; });
    }).catch(function(){ return state.ref.canvas; });
  }
  // The reference and a stage in one image: side by side for an upright or
  // square reference, one above the other for a wide one, with the header
  // (if any) across the top. Scaled down if needed to stay within iOS's
  // largest canvas, 16.7 MP; the reference drawn at the stage's size.
  var CANVAS_MAX = 16000000;
  function sideBySideCanvas(refSrc, paint, header){
    var row = state.ref.w <= state.ref.h, pw = paint.w, ph = paint.h;
    var W0 = row ? 2.02*pw : pw, H0 = row ? ph : 2.02*ph;
    if(header) H0 += headerBand(W0, H0).h;
    var s = Math.min(1, Math.sqrt(CANVAS_MAX/(W0*H0)));
    var w = Math.round(pw*s), h = Math.round(ph*s), gap = Math.round(0.02*Math.max(w, h));
    var W = row ? 2*w + gap : w, H = row ? h : 2*h + gap, band = header ? headerBand(W, H) : null, top = band ? band.h : 0;
    var c = document.createElement("canvas");
    c.width = W; c.height = H + top;
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#181613"; ctx.fillRect(0, 0, c.width, c.height);
    if(header) drawHeader(ctx, W, band, header);
    ctx.drawImage(grayCopy({ w: w, h: h }, refSrc || state.ref.canvas), 0, top, w, h);
    ctx.drawImage(grayCopy({ w: w, h: h }, paint.src), row ? w + gap : 0, row ? top : top + h + gap, w, h);
    return c;
  }
  function fileStamp(){
    var d = new Date(), p = function(n){ return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
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

  // ---------------- projects ----------------
  // The open project's data is read and written through PStore; switching
  // projects clears what's in memory (nothing stored is touched) and loads
  // the other project. View settings (Block-in, intensity, export options)
  // carry over into a new project.
  function resetForProject(){
    alignLoaded = null;
    stopPlay();
    if(videoModal.classList.contains("show")) closeVideo();
    Object.keys(progUrls).forEach(function(id){ URL.revokeObjectURL(progUrls[id]); });
    Object.keys(progThumbs).forEach(function(id){ URL.revokeObjectURL(progThumbs[id]); });
    progUrls = {}; progThumbs = {}; progIndex = -1; progStripKey = null; progGains = null; progShownKey = null;
    progFilesReady = false; fullCache = null;
    dropImage(state.ref); dropImage(state.photo); dropImage(state.aligned);
    state.ref = null; state.photo = null; state.aligned = null; state.photoKey = null;
    newShapesSource();
    state.corners = null; state.cornerSure = null; state.lastCorners = null;
    state.offU = 0; state.offV = 0; state.adjusting = false; state.opacityBeforeAdjust = null;
    state.reading = null; state.peeking = false; state.mode = "align";
    pinZoom.reset(); compareZoom.reset(); sideZoom.reset();
  }
  // opens a project: what can be done at once is done at once (so a file
  // picker can still open from the same tap), the stored data follows
  var openId = null;                    // the project open now
  function openProject(id){
    openId = id;
    resetForProject();
    Projects.setActive(id);
    Projects.touch(id);                 // most recently used first in the list
    PStore = Projects.scoped(id);
    render();
    return loadProject(id);
  }
  // an empty project (when the last one was deleted); "New project" waits
  // for its reference instead (pickReference)
  function newProject(){
    var id = Projects.create();
    openProject(id).then(function(){ persistMeta(); });
  }
  function loadProject(id){
    var ps = PStore;
    return Progress.init(ps).then(function(){
      return Promise.all([ps.get("meta"), ps.get("ref"), ps.get("photo"), ps.get("aligned"), ps.get("align")]);
    }).then(function(res){
      if(PStore !== ps) return;                         // another project was opened meanwhile
      var meta = res[0] || {}, refBlob = res[1], photoBlob = res[2], alignedBlob = res[3], align = res[4];
      progStarts = [];                                  // a project's own, never carried over
      // the alignment record, where there is one, over the copy in the settings
      if(align && typeof align === "object"){
        meta = Object.assign({}, meta);
        ["corners", "lastCorners", "offU", "offV", "photoKey", "aligned"].forEach(function(k){ meta[k] = align[k]; });
      }
      // a project without a reference yet keeps its own settings if it has
      // any, else the current ones (a new project carries them over)
      if(!refBlob){ if(res[0]) applyMeta(meta); return; }
      return loadProjectData(ps, meta, refBlob, photoBlob, alignedBlob);
    }).catch(function(){}).then(function(){
      if(PStore !== ps) return;
      alignLoaded = JSON.stringify(alignRecord());     // from here on, a change to the alignment is saved
      render();
    });
  }

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

  function applyMeta(meta){
      state.lastCorners = (meta.lastCorners && validCorners(meta.lastCorners.pts)) ? meta.lastCorners : null;
      state.offU = Number(meta.offU) || 0; state.offV = Number(meta.offV) || 0;
      state.photoKey = typeof meta.photoKey === "string" ? meta.photoKey : null;
      state.cmpView = meta.cmpView === "side" ? "side" : "compare";
      progEven = !!meta.progEven;
      progRef = !!meta.progRef;
      progHeader = !!meta.progHeader;
      progStarts = Array.isArray(meta.progStarts) ? meta.progStarts.filter(function(t){ return typeof t === "number" && isFinite(t); }) : [];
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
        state.blocks = { colours: clamp(Math.round((colours || 12)/2)*2, 6, 40), detail: detail, fill: b.fill !== false };   // steps of 2
      }
  }

  // (loadProject, continued)
  function loadProjectData(ps, meta, refBlob, photoBlob, alignedBlob){
      applyMeta(meta);
      return decodeToCanvas(refBlob, WORK_DIM).then(function(ref){
        if(PStore !== ps) return;
        state.ref = ref;
        newShapesSource();
        var jobs = [];
        var corners = validCorners(meta.corners) ? meta.corners : null, wasAligned = !!(meta.aligned || alignedBlob);
        var confirmed = meta.lastCorners && validCorners(meta.lastCorners.pts) ? meta.lastCorners : null;
        if(photoBlob) jobs.push(decodeToCanvas(photoBlob, SRC_MAX).then(function(im){
          if(PStore !== ps) return;
          setPhoto(im, corners);
          state.photoKey = typeof meta.photoKey === "string" ? meta.photoKey : state.photoKey;
          // the aligned painting, made again from the photo and the corners it
          // was aligned with (the last Align: corners dragged since then
          // without aligning again don't count; older projects: the corners)
          if(!corners || !wasAligned) return;
          var at = (confirmed && Math.abs(confirmed.ar - im.w/im.h) < 0.01) ? confirmed.pts : corners;
          return warpAsync(im, cornersToPx(at, im.w, im.h), ref.w, ref.h).then(function(al){
            if(PStore === ps){ dropImage(state.aligned); state.aligned = al; }
          });
        }).catch(function(){}));
        // a project from before v2.37 without a usable photo: its stored copy
        if(alignedBlob && !(photoBlob && corners)) jobs.push(decodeToCanvas(alignedBlob, WORK_DIM).then(function(im){
          if(PStore === ps) state.aligned = im;
        }).catch(function(){}));
        return Promise.all(jobs);
      }).then(function(){
        if(PStore !== ps) return;
        if(state.aligned) state.mode = state.cmpView;
        // a project copied from the single painting has opened: the old copy can go
        if(state.ref) Projects.cleanupLegacy();
      });
  }

  function boot(){
    render();
    var syncReady = Sync.init(SU.syncHooks());          // first, so every change from here on is noted
    Palettes.load(Store);
    // Ask for durable storage so the browser doesn't clear the saved photos
    // after a spell of non-use.
    if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(function(){}); }
    migrateLegacy().then(function(){ return Projects.init(Store); })
      .then(function(){ return openProject(Projects.activeId()); })
      .catch(function(){}).then(render)
      .then(function(){ return syncReady; }).then(function(){ SU.renderSync(); if(Sync.on()) Sync.run(); });
  }

  // ---- the Projects screen ----
  function fmtDay(t){ return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  var projThumbUrls = {};
  function projectThumb(id){
    if(projThumbUrls[id]) return Promise.resolve(projThumbUrls[id]);
    var ps = Projects.scoped(id);
    return ps.get("thumb").then(function(t){
      if(t) return t;
      return ps.get("ref").then(function(r){ return r ? thumbOf(r).then(function(nt){ ps.set("thumb", nt); return nt; }) : null; });
    }).then(function(t){
      if(!t) return "";
      if(projThumbUrls[id]) URL.revokeObjectURL(projThumbUrls[id]);
      return (projThumbUrls[id] = URL.createObjectURL(t));
    }).catch(function(){ return ""; });
  }
  function renderProjects(){
    projList.innerHTML = "";
    Projects.list().forEach(function(p){
      var li = document.createElement("li"), row = document.createElement("div");
      row.className = "proj-row" + (p.id === Projects.activeId() ? " on" : "");
      var img = document.createElement("img"); img.className = "proj-thumb"; img.alt = "";
      // refresh the open project's picture (it may have just changed)
      if(p.id === Projects.activeId() && projThumbUrls[p.id]){ URL.revokeObjectURL(projThumbUrls[p.id]); delete projThumbUrls[p.id]; }
      projectThumb(p.id).then(function(u){ if(u) img.src = u; });
      var main = document.createElement("div"); main.className = "proj-main";
      var nm = document.createElement("span"); nm.className = "proj-name"; nm.textContent = p.name;
      var sub = document.createElement("span"); sub.className = "proj-sub";
      var photos = p.id === Projects.activeId() ? Progress.count() : (p.photos || 0);
      sub.textContent = (photos ? photos + (photos === 1 ? " progress photo" : " progress photos") : "No progress photos yet") + " · " + fmtDay(p.updated);
      main.appendChild(nm); main.appendChild(sub);
      var btns = document.createElement("div"); btns.className = "proj-btns";
      var rn = document.createElement("button"); rn.className = "btn small"; rn.textContent = "Rename";
      rn.addEventListener("click", function(e){ e.stopPropagation(); askName(p); });
      var del = document.createElement("button"); del.className = "btn small ghost"; del.textContent = "Delete";
      del.addEventListener("click", function(e){ e.stopPropagation(); askDelete(p); });
      btns.appendChild(rn); btns.appendChild(del);
      row.addEventListener("click", function(){
        closeProjects();
        if(p.id !== Projects.activeId()) openProject(p.id);
      });
      row.appendChild(img); row.appendChild(main); row.appendChild(btns);
      li.appendChild(row); projList.appendChild(li);
    });
  }
  function openProjects(){ closeMenu(); renderProjects(); projModal.classList.add("show"); }
  function closeProjects(){ projModal.classList.remove("show"); }
  projectBtn.addEventListener("click", openProjects);
  projDone.addEventListener("click", closeProjects);
  projModal.addEventListener("click", function(e){ if(e.target === projModal) closeProjects(); });
  // a new project starts with choosing its reference, and is made once one is picked
  projNewBtn.addEventListener("click", function(){ closeProjects(); pickReference(true); });

  var renaming = null;
  function askName(p){
    renaming = p;
    nameTitle.textContent = "Rename project";
    nameInput.value = p.name;
    nameModal.classList.add("show");
    setTimeout(function(){ nameInput.focus(); nameInput.select(); }, 50);
  }
  function closeName(){ nameModal.classList.remove("show"); renaming = null; }
  nameOk.addEventListener("click", function(){
    if(renaming){ Projects.rename(renaming.id, nameInput.value); }
    closeName(); renderProjects(); render();
  });
  nameInput.addEventListener("keydown", function(e){ if(e.key === "Enter") nameOk.click(); });
  nameCancel.addEventListener("click", closeName);
  nameModal.addEventListener("click", function(e){ if(e.target === nameModal) closeName(); });

  // A project's progress photos as files, for "save its photos first".
  // Loaded when the question is asked, so the share sheet can open from the tap.
  var delFiles = null;
  function projectFiles(id){
    var ps = Projects.scoped(id);
    return ps.get("progress").then(function(r){
      var items = Array.isArray(r) ? r : (r && r.items) || [];
      return Promise.all(items.map(function(it){ return ps.get("prog-" + it.id); })).then(function(bs){
        var stamp = fileStamp(), files = [];
        bs.forEach(function(b, i){ if(b) files.push(new File([b], "comp-art-stage-" + (i < 9 ? "0" : "") + (i + 1) + "-" + stamp + ".jpg", { type: "image/jpeg" })); });
        return files;
      });
    });
  }
  function askDelete(p){
    var photos = p.id === Projects.activeId() ? Progress.count() : (p.photos || 0);
    delFiles = null;
    if(photos) projectFiles(p.id).then(function(f){ delFiles = f; }).catch(function(){});
    askConfirm("Delete “" + p.name + "”? Its reference" + (photos ? ", painting photos and " + photos + " progress photo" + (photos > 1 ? "s" : "") : " and painting photos") + " are removed from this device. Palettes stay.",
      "Delete", function(){ deleteProject(p.id); },
      photos ? { label: "Save its progress photos first", action: function(){
        if(delFiles && delFiles.length) deliverMany(delFiles);
        else toast("Getting the photos ready. Tap again in a moment.");
      } } : null);
  }
  function deleteProject(id){
    var wasOpen = id === Projects.activeId();
    if(projThumbUrls[id]){ URL.revokeObjectURL(projThumbUrls[id]); delete projThumbUrls[id]; }
    Projects.remove(id).then(function(){
      if(!Projects.list().length){ newProject(); }
      else if(wasOpen){ openProject(Projects.activeId()); }
      if(projModal.classList.contains("show")) renderProjects();
      render();
    }).catch(function(){ toast("The project couldn't be deleted. Try again."); });
  }

  // ---- the ⋯ menu ----
  function closeMenu(){ menuModal.classList.remove("show"); }
  menuBtn.addEventListener("click", function(){ menuModal.classList.add("show"); });
  menuDone.addEventListener("click", closeMenu);
  menuModal.addEventListener("click", function(e){ if(e.target === menuModal) closeMenu(); });
  menuProjects.addEventListener("click", openProjects);
  menuPalettes.addEventListener("click", function(){ closeMenu(); PU.openPalettesFromMenu(); });
  menuSync.addEventListener("click", function(){ closeMenu(); SU.openSync(); });

  // ---- the Sync and Admin screens: sync-ui.js ----
  var SU = SyncUI({
    $: $, toast: toast, askConfirm: askConfirm, fmtDay: fmtDay, show: show, state: state, render: render,
    openProject: openProject, newProject: newProject, renderProjects: renderProjects, projThumbUrls: projThumbUrls, projModal: projModal,
    openId: function(){ return openId; }, forgetStageCaches: forgetStageCaches,
    fillPaletteSelect: PU.fillPaletteSelect, renderPalList: PU.renderPalList, palModal: PU.palModal, palListView: PU.palListView,
    menuSync: menuSync, confirmModal: confirmModal, exportModal: exportModal, mixModal: mixModal, videoModal: videoModal
  });

  boot();

  // Offline support: cache the app files so the home-screen app opens
  // without a network connection.
  // The app opens from the cache (fast, and offline). A new version is
  // fetched in the background and takes over at a quiet moment: when the
  // app is put away or comes back, and nothing is in progress.
  if("serviceWorker" in navigator){
    var updateReady = false;
    // A photo being picked or taken: the camera can hide the app, and a
    // reload then would lose the photo. From the tap on a file input until
    // its choice (or cancel) has had a few seconds to be stored.
    var pickerOpen = 0, pickerQuietUntil = 0;
    document.addEventListener("click", function(e){ if(e.target && e.target.type === "file") pickerOpen = Date.now(); }, true);
    ["change", "cancel"].forEach(function(ev){
      document.addEventListener(ev, function(e){
        if(e.target && e.target.type === "file"){ pickerOpen = 0; pickerQuietUntil = Date.now() + 8000; }
      }, true);
    });
    function picking(){
      var now = Date.now();
      return (pickerOpen && now - pickerOpen < 10*60*1000) || now < pickerQuietUntil;
    }
    function busyNow(){
      return state.busy || state.adjusting || state.detecting || !!document.querySelector(".modal.show");
    }
    function applyUpdate(){
      if(!updateReady || picking()) return;
      if(document.hidden || !busyNow()){ updateReady = false; location.reload(); }
    }
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function(reg){
        // a long-open home-screen app checks for a new version when it comes back
        document.addEventListener("visibilitychange", function(){ if(!document.hidden) reg.update().catch(function(){}); });
      }).catch(function(){});
      var had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", function(){
        if(had){ updateReady = true; if(document.hidden) applyUpdate(); }   // a new version has taken over
        had = true;
      });
      document.addEventListener("visibilitychange", applyUpdate);
    });
  }
})();
