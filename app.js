(function(){
  "use strict";

  var STORE_KEY = "sightsize_v1";
  var WORK_DIM = 1100;      // long-edge working resolution for reference + final aligned output
  var CUR_SRC_MAX = 1800;   // working resolution kept for the raw painting photo (perspective source)

  // ---------------- state ----------------
  var state = {
    refDataUrl: null, refW: 0, refH: 0,
    alignedDataUrl: null,
    curSourceCanvas: null, curW: 0, curH: 0,   // working-res painting photo, corner-pin source
    corners: null,              // 4 {u,v} normalized points, order TL,TR,BR,BL
    lastCorners: null,          // corners from the last alignment, reused for the next photo of the same shape
    pinZoom: 1, pinPanX: 0, pinPanY: 0, // view-only zoom/pan on the align stage
    offU: 0, offV: 0,           // aligned painting shifted against the reference (compare), fraction of its size
    adjusting: false,           // compare view: drag moves the painting instead of peeking
    opacityBeforeAdjust: null,  // opacity to restore when adjust mode is switched off
    mode: "align",
    grayscale: false,
    opacity: 100
  };

  // ---------------- element refs ----------------
  var $ = function(id){ return document.getElementById(id); };
  var tabs = $("tabs");
  var stepHint = $("stepHint");

  var emptyStage = $("emptyStage");
  var setupPanel = $("setupPanel");
  var refRow = $("refRow"), curRow = $("curRow"), changeRefRow = $("changeRefRow");
  var addRefBtn = $("addRefBtn"), addCurBtn = $("addCurBtn"), changeRefBtn = $("changeRefBtn");
  var refInput = $("refInput"), curInput = $("curInput");

  var alignStageWrap = $("alignStageWrap");
  var pinStage = $("pinStage"), pinView = $("pinView"), pinInner = $("pinInner"), pinRefImg = $("pinRefImg"), pinImg = $("pinImg"), pinPoly = $("pinPoly");
  var handles = [$("handle0"), $("handle1"), $("handle2"), $("handle3")];
  var pinOpacitySlider = $("pinOpacitySlider");
  var resetAlignBtn = $("resetAlignBtn"), retakeBtn = $("retakeBtn");
  var confirmAlignBtn = $("confirmAlignBtn");
  var confirmAlignHTML = confirmAlignBtn.innerHTML;

  var viewAlign = $("view-align"), viewCompare = $("view-compare"), viewSide = $("view-side");
  var compareRef = $("compareRef"), compareCur = $("compareCur"), compareFrame = $("compareFrame");
  var opacitySlider = $("opacitySlider");
  var grayBtn = $("grayBtn");
  var retakeFromCompareBtn = $("retakeFromCompareBtn");
  var adjustSwitch = $("adjustSwitch"), resetPosBtn = $("resetPosBtn");
  var pickMarker = $("pickMarker"), ccEmpty = $("ccEmpty"), ccBody = $("ccBody");
  var colorCard = $("colorCard"), compareCardSlot = $("compareCardSlot"), sideCardSlot = $("sideCardSlot");
  var sideRefFrame = $("sideRefFrame"), sideCurFrame = $("sideCurFrame");
  var sideRefMarker = $("sideRefMarker"), sideCurMarker = $("sideCurMarker");
  var ccRefMun = $("ccRefMun"), ccPaintMun = $("ccPaintMun");
  var ccRefSw = $("ccRefSw"), ccPaintSw = $("ccPaintSw"), ccDiff = $("ccDiff"), ccNote = $("ccNote");

  var sideRef = $("sideRef"), sideCur = $("sideCur");

  var restartBtn = $("restartBtn");
  var toastEl = $("toast");

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

  // setPointerCapture throws if the pointer has already gone (e.g. a touch
  // cancelled by the system mid-gesture); capture is a nicety, not required.
  function capturePointer(el, e){ try{ el.setPointerCapture(e.pointerId); }catch(err){} }

  function fileToResizedDataUrl(file, maxDim){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onerror = function(){ reject(new Error("read failed")); };
      reader.onload = function(){
        var img = new Image();
        img.onerror = function(){ reject(new Error("decode failed")); };
        img.onload = function(){
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w,h));
          var outW = Math.round(w*scale), outH = Math.round(h*scale);
          var c = document.createElement("canvas");
          c.width = outW; c.height = outH;
          var cctx = c.getContext("2d");
          cctx.drawImage(img, 0, 0, outW, outH);
          resolve({ dataUrl: c.toDataURL("image/jpeg", 0.9), width: outW, height: outH, img: img });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function saveStore(){
    try{
      var payload = JSON.stringify({
        ref: state.refDataUrl, refW: state.refW, refH: state.refH,
        aligned: state.alignedDataUrl,
        offU: state.offU, offV: state.offV,
        lastCorners: state.lastCorners
      });
      localStorage.setItem(STORE_KEY, payload);
    }catch(e){
      if(!saveStore.warned) toast("Your photos are too large to keep saved between visits, but this session works fine.");
      saveStore.warned = true;
    }
  }

  function loadStore(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }

  function clearStore(){
    try{ localStorage.removeItem(STORE_KEY); }catch(e){}
  }

  // ---------------- tab / mode switching ----------------
  function setMode(m){
    if(m === "compare" && !state.alignedDataUrl) return;
    if(m === "side" && !state.alignedDataUrl) return;
    state.mode = m;
    Array.prototype.forEach.call(tabs.querySelectorAll("button"), function(b){
      b.classList.toggle("active", b.dataset.mode === m);
    });
    viewAlign.style.display = (m === "align") ? "" : "none";
    viewCompare.style.display = (m === "compare") ? "" : "none";
    viewSide.style.display = (m === "side") ? "" : "none";
    grayBtn.hidden = (m === "align"); // black & white applies to the compare / side views

    if(m === "align") stepHint.textContent = state.refDataUrl ? (state.curSourceCanvas ? "drag the points to the canvas corners · pinch to zoom" : "photograph your painting") : "reference → painting → compare";
    if(m === "compare") { stepHint.textContent = "hold the painting to peek and read colour"; renderCompare(); }
    if(m === "side") { stepHint.textContent = "touch either image to read colours"; renderSide(); }
  }

  tabs.addEventListener("click", function(e){
    var b = e.target.closest("button[data-mode]");
    if(!b || b.disabled) return;
    setMode(b.dataset.mode);
  });

  function enableCompareTabs(on){
    Array.prototype.forEach.call(tabs.querySelectorAll("button"), function(b){
      if(b.dataset.mode !== "align") b.disabled = !on;
    });
  }

  // ---------------- reference loading ----------------
  addRefBtn.addEventListener("click", function(){ refInput.click(); });
  changeRefBtn.addEventListener("click", function(){ refInput.click(); });
  refInput.addEventListener("change", function(){
    var f = refInput.files && refInput.files[0];
    refInput.value = "";
    if(!f) return;
    fileToResizedDataUrl(f, WORK_DIM).then(function(res){
      state.refDataUrl = res.dataUrl;
      state.refW = res.width; state.refH = res.height;
      state.alignedDataUrl = null;
      state.curSourceCanvas = null; state.corners = null;
      enableCompareTabs(false);
      saveStore();
      refreshSetupUI();
      setMode("align");
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });

  addCurBtn.addEventListener("click", function(){ curInput.click(); });
  retakeBtn.addEventListener("click", function(){ curInput.click(); });
  retakeFromCompareBtn.addEventListener("click", function(){ setMode("align"); curInput.click(); });

  curInput.addEventListener("change", function(){
    var f = curInput.files && curInput.files[0];
    curInput.value = "";
    if(!f) return;
    loadCurrentPhoto(f).then(function(){
      state.alignedDataUrl = null;
      enableCompareTabs(false);
      setMode("align");
      refreshSetupUI();
      startPinning();
    }).catch(function(){ toast("That photo couldn't be opened. Try another one."); });
  });

  function loadCurrentPhoto(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onerror = function(){ reject(new Error("read failed")); };
      reader.onload = function(){
        var img = new Image();
        img.onerror = function(){ reject(new Error("decode failed")); };
        img.onload = function(){
          var w = img.naturalWidth, h = img.naturalHeight;
          var srcScale = Math.min(1, CUR_SRC_MAX / Math.max(w,h));
          var sW = Math.round(w*srcScale), sH = Math.round(h*srcScale);
          var srcCanvas = document.createElement("canvas");
          srcCanvas.width = sW; srcCanvas.height = sH;
          srcCanvas.getContext("2d").drawImage(img, 0, 0, sW, sH);

          setupSource(srcCanvas);
          resolve();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function refreshSetupUI(){
    var hasRef = !!state.refDataUrl;
    var hasRaw = !!state.curSourceCanvas;
    var onPin  = hasRef && hasRaw;

    emptyStage.style.display = (hasRef) ? "none" : "flex";
    setupPanel.style.display = (hasRef && hasRaw) ? "none" : "";
    refRow.style.display = hasRef ? "none" : "";
    curRow.style.display = hasRef ? "" : "none";
    changeRefRow.style.display = hasRef ? "" : "none";

    alignStageWrap.style.display = onPin ? "" : "none";

    if(!hasRef){
      stepHint.textContent = "reference → painting → compare";
    } else if(!hasRaw){
      stepHint.textContent = "now photograph your painting";
    } else {
      stepHint.textContent = "drag the points to the canvas corners · pinch to zoom";
    }
  }

  // Prepares the painting photo as the corner-pin source and resets the
  // pan/zoom. The corners start where the last alignment left them when the
  // new photo has the same shape (same camera, same setup), else in the
  // extreme corners.
  function setupSource(c){
    state.curSourceCanvas = c; state.curW = c.width; state.curH = c.height;
    var last = state.lastCorners;
    var sameShape = last && last.ar && Math.abs(last.ar - c.width/c.height) < 0.01;
    state.corners = sameShape ? last.pts.map(function(p){ return { u:p.u, v:p.v }; }) : defaultCorners();
    state.pinZoom = 1; state.pinPanX = 0; state.pinPanY = 0;
  }

  // ================== corner-pin perspective engine ==================
  // Four normalized points (0..1), order TL, TR, BR, BL, describing where
  // the edges of the canvas fall inside the photo. Warping maps
  // these onto the reference's rectangle, automatically resizing and
  // correcting perspective in one step.

  function defaultCorners(){
    var m = 0; // start in the extreme corners of the photo
    return [
      { u: m,     v: m     },
      { u: 1 - m, v: m     },
      { u: 1 - m, v: 1 - m },
      { u: m,     v: 1 - m }
    ];
  }

  function startPinning(){
    pinImg.src = state.curSourceCanvas.toDataURL("image/jpeg", 0.9);
    pinRefImg.src = state.refDataUrl;
    pinRefImg.style.opacity = "1";
    pinStage.style.setProperty("--ar", state.curW + " / " + state.curH);
    pinImg.style.opacity = "1";
    pinOpacitySlider.value = 100;
    applyPinTransform();
  }

  // Layers: pin-view is zoomed/panned as a whole (a viewing aid only). Inside
  // it, pin-inner holds the photo and, beneath it, the reference warped into
  // the four-point quad — so fading the photo shows the reference at the
  // painting's size and perspective. Handles are siblings of pin-view so
  // their on-screen size stays constant regardless of zoom; their position
  // is derived from pin-inner's rect.
  function layoutHandles(){
    var pts = state.corners.map(function(p){ return (p.u*100) + "," + (p.v*100); }).join(" ");
    pinPoly.setAttribute("points", pts);
    layoutRefOverlay();
    var stageRect = pinStage.getBoundingClientRect();
    var innerRect = pinInner.getBoundingClientRect();
    handles.forEach(function(h, i){
      var u = state.corners[i].u, v = state.corners[i].v;
      var xPx = (innerRect.left - stageRect.left) + u*innerRect.width;
      var yPx = (innerRect.top  - stageRect.top)  + v*innerRect.height;
      h.style.left = xPx + "px";
      h.style.top  = yPx + "px";
    });
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
      var u = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      var v = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      state.corners[i] = { u: u, v: v };
      layoutHandles();
    });
    function release(){ if(activeHandle === i) activeHandle = null; }
    h.addEventListener("pointerup", release);
    h.addEventListener("pointercancel", release);
  });

  // Maps the reference image (refW x refH box) onto the corner quad with a
  // CSS matrix3d built from the same homography used for the final warp.
  function layoutRefOverlay(){
    if(!state.refW || !state.corners) return;
    var w = pinInner.offsetWidth, h = pinInner.offsetHeight;
    if(!w || !h) return;
    var src = [ {x:0,y:0}, {x:state.refW,y:0}, {x:state.refW,y:state.refH}, {x:0,y:state.refH} ];
    var dst = cornersToPx(state.corners, w, h);
    var m = computeHomography(src, dst);
    pinRefImg.style.width = state.refW + "px";
    pinRefImg.style.height = state.refH + "px";
    pinRefImg.style.transform = "matrix3d(" + [
      m[0], m[3], 0, m[6],
      m[1], m[4], 0, m[7],
      0,    0,    1, 0,
      m[2], m[5], 0, m[8]
    ].join(",") + ")";
  }

  resetAlignBtn.addEventListener("click", function(){
    if(!state.curSourceCanvas) return;
    state.corners = defaultCorners();
    state.pinZoom = 1; state.pinPanX = 0; state.pinPanY = 0;
    applyPinTransform();
  });

  pinOpacitySlider.addEventListener("input", function(){
    pinImg.style.opacity = String(Number(pinOpacitySlider.value) / 100);
  });

  // -------- pinch-zoom / pan of the align view, for placing corners precisely --------
  var PIN_MAX_ZOOM = 5;
  var bgPointers = {};
  var bgGesture = null;

  function clampPinTransform(){
    var rect = pinStage.getBoundingClientRect();
    state.pinZoom = clamp(state.pinZoom, 1, PIN_MAX_ZOOM);
    // the zoomed view always covers the stage
    state.pinPanX = clamp(state.pinPanX, (1-state.pinZoom)*rect.width, 0);
    state.pinPanY = clamp(state.pinPanY, (1-state.pinZoom)*rect.height, 0);
  }
  function applyPinTransform(){
    pinView.style.transform = "translate(" + state.pinPanX + "px," + state.pinPanY + "px) scale(" + state.pinZoom + ")";
    layoutHandles();
  }
  function bgLocalMid(){
    var ids = Object.keys(bgPointers);
    if(!ids.length) return null;
    var sx=0, sy=0;
    ids.forEach(function(id){ sx += bgPointers[id].x; sy += bgPointers[id].y; });
    var rect = pinStage.getBoundingClientRect();
    return { x: (sx/ids.length) - rect.left, y: (sy/ids.length) - rect.top };
  }
  function bgDist(){
    var ids = Object.keys(bgPointers);
    if(ids.length < 2) return 0;
    var a = bgPointers[ids[0]], b = bgPointers[ids[1]];
    return Math.hypot(a.x-b.x, a.y-b.y);
  }
  function beginBgGesture(){
    var mid = bgLocalMid();
    bgGesture = mid ? { midLocal: mid, zoom0: state.pinZoom, pan0: {x:state.pinPanX,y:state.pinPanY}, dist0: bgDist() } : null;
  }

  pinStage.addEventListener("pointerdown", function(e){
    if(e.target.closest(".handle")) return;
    if(!state.curSourceCanvas) return;
    capturePointer(pinStage, e);
    bgPointers[e.pointerId] = { x:e.clientX, y:e.clientY };
    beginBgGesture();
  });
  pinStage.addEventListener("pointermove", function(e){
    if(!bgPointers[e.pointerId] || !bgGesture) return;
    bgPointers[e.pointerId] = { x:e.clientX, y:e.clientY };
    var mid = bgLocalMid(); if(!mid) return;
    var newDist = bgDist();
    var newZoom = state.pinZoom;
    if(newDist > 0 && bgGesture.dist0 > 0){
      newZoom = clamp(bgGesture.zoom0 * (newDist/bgGesture.dist0), 1, PIN_MAX_ZOOM);
    }
    var contentX = (bgGesture.midLocal.x - bgGesture.pan0.x) / bgGesture.zoom0;
    var contentY = (bgGesture.midLocal.y - bgGesture.pan0.y) / bgGesture.zoom0;
    state.pinZoom = newZoom;
    state.pinPanX = mid.x - contentX*newZoom;
    state.pinPanY = mid.y - contentY*newZoom;
    clampPinTransform();
    applyPinTransform();
  });
  function endBgPointer(e){ delete bgPointers[e.pointerId]; beginBgGesture(); }
  pinStage.addEventListener("pointerup", endBgPointer);
  pinStage.addEventListener("pointercancel", endBgPointer);

  pinStage.addEventListener("wheel", function(e){
    if(!state.curSourceCanvas) return;
    e.preventDefault();
    var rect = pinStage.getBoundingClientRect();
    var mx = e.clientX-rect.left, my = e.clientY-rect.top;
    var factor = 1 - clamp(e.deltaY,-80,80)*0.0025;
    var newZoom = clamp(state.pinZoom*factor, 1, PIN_MAX_ZOOM);
    var contentX = (mx-state.pinPanX)/state.pinZoom, contentY = (my-state.pinPanY)/state.pinZoom;
    state.pinZoom = newZoom;
    state.pinPanX = mx-contentX*newZoom;
    state.pinPanY = my-contentY*newZoom;
    clampPinTransform();
    applyPinTransform();
  }, { passive:false });

  // The stage resizes with the window / rotation (it's fitted to the screen),
  // so keep the pan in bounds and the handles on their corners.
  function relayoutPin(){
    if(state.mode !== "align" || !state.corners) return;
    clampPinTransform();
    applyPinTransform();
  }
  if(window.ResizeObserver) new ResizeObserver(relayoutPin).observe(pinStage);
  window.addEventListener("resize", relayoutPin);

  // -------- linear algebra: 4-point homography + inverse --------
  function solveLinear8(A, b){
    var n = 8;
    for(var i=0;i<n;i++) A[i].push(b[i]);
    for(var col=0; col<n; col++){
      var maxRow = col;
      for(var r=col+1;r<n;r++){ if(Math.abs(A[r][col]) > Math.abs(A[maxRow][col])) maxRow = r; }
      var tmp = A[col]; A[col] = A[maxRow]; A[maxRow] = tmp;
      var pivot = A[col][col]; if(Math.abs(pivot) < 1e-12) pivot = 1e-12;
      for(var c=col;c<=n;c++) A[col][c] /= pivot;
      for(var r2=0;r2<n;r2++){
        if(r2 === col) continue;
        var factor = A[r2][col];
        for(var c2=col;c2<=n;c2++) A[r2][c2] -= factor*A[col][c2];
      }
    }
    var x = [];
    for(var i2=0;i2<n;i2++) x.push(A[i2][n]);
    return x;
  }

  function computeHomography(src, dst){
    var A = [], b = [];
    for(var i=0;i<4;i++){
      var sx=src[i].x, sy=src[i].y, dx=dst[i].x, dy=dst[i].y;
      A.push([sx, sy, 1, 0,0,0, -sx*dx, -sy*dx]); b.push(dx);
      A.push([0,0,0, sx, sy, 1, -sx*dy, -sy*dy]); b.push(dy);
    }
    var h = solveLinear8(A, b);
    return [h[0],h[1],h[2], h[3],h[4],h[5], h[6],h[7],1];
  }

  function invert3x3(m){
    var a=m[0],b=m[1],c=m[2], d=m[3],e=m[4],f=m[5], g=m[6],h=m[7],i=m[8];
    var A = e*i-f*h, B = -(d*i-f*g), C = d*h-e*g;
    var D = -(b*i-c*h), E = a*i-c*g, F = -(a*h-b*g);
    var G = b*f-c*e, H = -(a*f-c*d), I = a*e-b*d;
    var det = a*A + b*B + c*C; if(Math.abs(det) < 1e-12) det = 1e-12;
    var k = 1/det;
    return [A*k,D*k,G*k, B*k,E*k,H*k, C*k,F*k,I*k];
  }

  // Warps srcCanvas into a new dstW x dstH canvas so that the quadrilateral
  // defined by srcCornersPx maps onto the full destination rectangle.
  function warpPerspective(srcCanvas, srcCornersPx, dstW, dstH){
    var dstCorners = [ {x:0,y:0}, {x:dstW,y:0}, {x:dstW,y:dstH}, {x:0,y:dstH} ];
    var H = computeHomography(srcCornersPx, dstCorners);
    var Hinv = invert3x3(H);

    var sW = srcCanvas.width, sH = srcCanvas.height;
    var sData = srcCanvas.getContext("2d").getImageData(0,0,sW,sH).data;

    var out = document.createElement("canvas");
    out.width = dstW; out.height = dstH;
    var octx = out.getContext("2d");
    var outImg = octx.createImageData(dstW, dstH);
    var oData = outImg.data;

    for(var j=0;j<dstH;j++){
      var Y = j + 0.5;
      for(var i=0;i<dstW;i++){
        var X = i + 0.5;
        var w = Hinv[6]*X + Hinv[7]*Y + Hinv[8];
        var sx = (Hinv[0]*X + Hinv[1]*Y + Hinv[2]) / w;
        var sy = (Hinv[3]*X + Hinv[4]*Y + Hinv[5]) / w;
        var idx = (j*dstW + i) * 4;
        if(sx >= 0 && sx < sW-1 && sy >= 0 && sy < sH-1){
          var x0 = sx|0, y0 = sy|0, x1 = x0+1, y1 = y0+1;
          var fx = sx-x0, fy = sy-y0;
          var i00=(y0*sW+x0)*4, i10=(y0*sW+x1)*4, i01=(y1*sW+x0)*4, i11=(y1*sW+x1)*4;
          for(var c=0;c<4;c++){
            var top = sData[i00+c] + (sData[i10+c]-sData[i00+c])*fx;
            var bot = sData[i01+c] + (sData[i11+c]-sData[i01+c])*fx;
            oData[idx+c] = top + (bot-top)*fy;
          }
        } else {
          oData[idx]=oData[idx+1]=oData[idx+2]=oData[idx+3]=0;
        }
      }
    }
    octx.putImageData(outImg, 0, 0);
    return out;
  }

  function cornersToPx(corners, w, h){
    return corners.map(function(p){ return { x: p.u*w, y: p.v*h }; });
  }

  // -------- confirm alignment (full-resolution bake) --------
  confirmAlignBtn.addEventListener("click", function(){
    if(!state.curSourceCanvas || !state.refW) return;
    confirmAlignBtn.disabled = true;
    confirmAlignBtn.textContent = "Aligning…";
    setTimeout(function(){
      var srcPx = cornersToPx(state.corners, state.curW, state.curH);
      var baked = warpPerspective(state.curSourceCanvas, srcPx, state.refW, state.refH);
      state.offU = 0; state.offV = 0;
      state.adjusting = false; state.opacityBeforeAdjust = null;
      state.lastCorners = { ar: state.curW/state.curH, pts: state.corners.map(function(p){ return { u:p.u, v:p.v }; }) };
      state.alignedDataUrl = baked.toDataURL("image/jpeg", 0.92);
      saveStore();
      enableCompareTabs(true);
      confirmAlignBtn.disabled = false;
      confirmAlignBtn.innerHTML = confirmAlignHTML;
      setMode("compare");
    }, 30);
  });

  // ---------------- compare view ----------------
  function renderCompare(){
    if(!state.refDataUrl || !state.alignedDataUrl) return;
    compareFrame.style.setProperty("--ar", state.refW + "/" + state.refH);
    compareRef.src = state.refDataUrl;
    compareCur.src = state.alignedDataUrl;
    compareCur.style.opacity = String(state.opacity / 100);
    applyGrayscale();
    applyOffset();
    applyAdjusting();
    clearReading("compare");
  }

  function setOpacity(v){
    state.opacity = v;
    opacitySlider.value = v;
    compareCur.style.opacity = String(v/100);
  }
  opacitySlider.addEventListener("input", function(){ setOpacity(Number(opacitySlider.value)); });

  // -------- position adjustment: shift the aligned painting over the reference --------
  // The offset is a fraction of the frame, applied as a CSS translate to the
  // painting in both compare and side-by-side views (the aligned image and
  // the reference share the same aspect ratio, so % of the image = % of frame).
  var OFF_MAX = 0.5;
  function applyOffset(){
    var t = (state.offU || state.offV) ? "translate(" + (state.offU*100) + "%," + (state.offV*100) + "%)" : "";
    compareCur.style.transform = t;
    sideCur.style.transform = t;
    resetPosBtn.style.display = (state.adjusting || state.offU || state.offV) ? "" : "none";
  }
  function applyAdjusting(){
    adjustSwitch.classList.toggle("on", state.adjusting);
    compareFrame.classList.toggle("adjusting", state.adjusting);
    if(state.mode === "compare"){
      stepHint.textContent = state.adjusting
        ? "drag the painting to line it up"
        : "hold the painting to peek and read colour";
    }
    applyOffset();
    if(state.adjusting) clearReading(); // moving the painting makes the reading stale
  }
  adjustSwitch.addEventListener("click", function(){
    state.adjusting = !state.adjusting;
    if(state.adjusting){
      // the reference has to show through to line things up
      if(state.opacity > 70){ state.opacityBeforeAdjust = state.opacity; setOpacity(50); }
    } else if(state.opacityBeforeAdjust !== null){
      if(state.opacity === 50) setOpacity(state.opacityBeforeAdjust);
      state.opacityBeforeAdjust = null;
    }
    applyAdjusting();
  });
  resetPosBtn.addEventListener("click", function(){
    state.offU = 0; state.offV = 0;
    applyOffset();
    saveStore();
  });

  var peeking = false, posDrag = null;
  function peekStart(e){
    if(peeking || !state.alignedDataUrl) return;
    peeking = true;
    capturePointer(compareFrame, e);
    compareCur.style.opacity = "0";
  }
  function peekEnd(){
    if(!peeking) return;
    peeking = false;
    compareCur.style.opacity = String(state.opacity/100);
  }
  // -------- colour reading (runs alongside touch-and-hold peek) --------
  // Pixels of the reference and aligned painting are read from offscreen
  // copies (unaffected by the CSS opacity / grayscale / offset on screen).
  function pixelsOf(img){
    if(!img.complete || !img.naturalWidth) return null;
    if(img._px && img._pxSrc === img.src) return img._px;
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    img._px = { data: cx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    img._pxSrc = img.src;
    return img._px;
  }
  function toLin(c){ c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function toSrgb(l){ var c = l <= 0.0031308 ? 12.92*l : 1.055*Math.pow(l, 1/2.4) - 0.055; return Math.round(clamp(c, 0, 1)*255); }

  // Average a small patch (in linear light) centred on normalized (u,v).
  function patchRadius(px){ return Math.max(1, Math.round(Math.max(px.w, px.h) / 300)); }
  function samplePatch(px, u, v){
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    var cx = Math.floor(u*px.w), cy = Math.floor(v*px.h);
    var r = patchRadius(px);
    var sr=0, sg=0, sb=0, n=0;
    for(var y=Math.max(0,cy-r); y<=Math.min(px.h-1,cy+r); y++){
      for(var x=Math.max(0,cx-r); x<=Math.min(px.w-1,cx+r); x++){
        var i = (y*px.w + x)*4;
        sr += toLin(px.data[i]); sg += toLin(px.data[i+1]); sb += toLin(px.data[i+2]); n++;
      }
    }
    return { r: sr/n, g: sg/n, b: sb/n };
  }
  function readColour(lin){
    var m = Munsell.fromLinearRGB(lin.r, lin.g, lin.b);
    m.css = "rgb(" + toSrgb(lin.r) + "," + toSrgb(lin.g) + "," + toSrgb(lin.b) + ")";
    return m;
  }

  // One colour card, moved into whichever view (compare / side by side) is showing.
  function clearReading(where){
    [pickMarker, sideRefMarker, sideCurMarker].forEach(function(mk){ mk.hidden = true; });
    if(where === "side"){
      sideCardSlot.appendChild(colorCard);
      ccEmpty.textContent = "Touch either image to read colours";
    } else if(where === "compare"){
      compareCardSlot.appendChild(colorCard);
      ccEmpty.textContent = "Touch and hold the painting to read colours";
    }
    ccBody.hidden = true;
    ccEmpty.hidden = false;
  }
  function placeMarker(mk, u, v, pointerType, frameH){
    mk.hidden = false;
    mk.classList.toggle("touch", pointerType === "touch");
    mk.classList.toggle("below", pointerType === "touch" && v*frameH < 96);
    mk.style.left = (u*100) + "%";
    mk.style.top = (v*100) + "%";
  }

  // Reads both images at frame-normalized (u,v) — the same spot in each,
  // with the painting's position offset taken into account.
  // frameEl: the frame touched; refImg/curImg: that view's images;
  // markers: [{el, fill}] to show at the spot, where fill is "ref", "cur"
  // or "split" (left half reference, right half painting).
  function pickAt(e, frameEl, refImg, curImg, markers){
    var refPx = pixelsOf(refImg), curPx = pixelsOf(curImg);
    if(!refPx) return;
    var rect = frameEl.getBoundingClientRect();
    var u = (e.clientX - rect.left) / rect.width, v = (e.clientY - rect.top) / rect.height;
    if(u < 0 || u >= 1 || v < 0 || v >= 1) return;


    var refLin = samplePatch(refPx, u, v);
    // the painting is drawn shifted by the position offset
    var curLin = curPx ? samplePatch(curPx, u - state.offU, v - state.offV) : null;
    var r = readColour(refLin), p = curLin ? readColour(curLin) : null;

    var pCss = p ? p.css : "transparent";
    markers.forEach(function(mk){
      placeMarker(mk.el, u, v, e.pointerType, rect.height);
      mk.el.querySelector(".pm-ring").style.background =
        mk.fill === "ref" ? r.css :
        mk.fill === "cur" ? pCss :
        "linear-gradient(90deg, " + r.css + " 50%, " + pCss + " 50%)";
    });

    ccEmpty.hidden = true; ccBody.hidden = false;
    ccRefMun.textContent = r.notation;
    ccRefSw.style.background = r.css;
    if(p){
      ccPaintMun.textContent = p.notation;
      ccPaintSw.style.background = p.css;
      ccDiff.textContent = Munsell.describe(r, p);
    } else {
      ccPaintMun.textContent = "—";
      ccPaintSw.style.background = "transparent";
      ccDiff.textContent = "No painting at this spot.";
    }
    var side = 2*patchRadius(refPx) + 1;
    ccNote.textContent = "Hue and chroma are the nearest Munsell chip; value is measured. Each reading averages a " + side + "×" + side + " pixel patch.";
  }

  function pickCompare(e){ pickAt(e, compareFrame, compareRef, compareCur, [{el: pickMarker, fill: "split"}]); }

  // Side by side: touching either image reads the same spot in both.
  var sidePick = null;
  [sideRefFrame, sideCurFrame].forEach(function(frame){
    function pick(e){ pickAt(e, frame, sideRef, sideCur, [{el: sideRefMarker, fill: "ref"}, {el: sideCurMarker, fill: "cur"}]); }
    frame.addEventListener("pointerdown", function(e){
      e.preventDefault();
      if(!state.alignedDataUrl) return;
      capturePointer(frame, e);
      sidePick = e.pointerId;
      pick(e);
    });
    frame.addEventListener("pointermove", function(e){ if(sidePick === e.pointerId) pick(e); });
    function end(e){ if(sidePick === e.pointerId) sidePick = null; }
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);
  });

  compareFrame.addEventListener("pointerdown", function(e){
    e.preventDefault();
    if(!state.adjusting){ peekStart(e); pickCompare(e); return; }
    if(posDrag || !state.alignedDataUrl) return;
    capturePointer(compareFrame, e);
    posDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, u0: state.offU, v0: state.offV };
  });
  compareFrame.addEventListener("pointermove", function(e){
    if(peeking){ pickCompare(e); return; }
    if(!posDrag || e.pointerId !== posDrag.id) return;
    var rect = compareFrame.getBoundingClientRect();
    state.offU = clamp(posDrag.u0 + (e.clientX - posDrag.x) / rect.width, -OFF_MAX, OFF_MAX);
    state.offV = clamp(posDrag.v0 + (e.clientY - posDrag.y) / rect.height, -OFF_MAX, OFF_MAX);
    applyOffset();
  });
  function endPointer(e){
    if(posDrag && e.pointerId === posDrag.id){ posDrag = null; saveStore(); }
    peekEnd();
  }
  compareFrame.addEventListener("pointerup", endPointer);
  compareFrame.addEventListener("pointercancel", endPointer);
  compareFrame.addEventListener("pointerleave", function(){ peekEnd(); });

  function applyGrayscale(){
    var on = state.grayscale;
    grayBtn.classList.toggle("on", on);
    grayBtn.setAttribute("aria-pressed", on ? "true" : "false");
    [compareRef, compareCur, sideRef, sideCur].forEach(function(img){
      img.classList.toggle("gray", on);
    });
  }
  function toggleGray(){ state.grayscale = !state.grayscale; applyGrayscale(); }
  grayBtn.addEventListener("click", toggleGray);

  // ---------------- side-by-side view ----------------
  function renderSide(){
    if(!state.refDataUrl || !state.alignedDataUrl) return;
    var ar = state.refW + "/" + state.refH;
    sideRef.closest(".frame").style.setProperty("--ar", ar);
    sideCur.closest(".frame").style.setProperty("--ar", ar);
    sideRef.src = state.refDataUrl;
    sideCur.src = state.alignedDataUrl;
    applyGrayscale();
    applyOffset();
    clearReading("side");
  }

  // ---------------- restart ----------------
  // Clears the saved photos, resets the screen immediately, then reloads the
  // page so every bit of state (inputs, pan/zoom, sliders) starts fresh.
  function restart(){
    clearStore();
    state.refDataUrl = null; state.refW = 0; state.refH = 0;
    state.alignedDataUrl = null;
    state.curSourceCanvas = null; state.corners = null; state.lastCorners = null;
    state.pinZoom = 1; state.pinPanX = 0; state.pinPanY = 0;
    state.offU = 0; state.offV = 0;
    enableCompareTabs(false);
    refreshSetupUI();
    setMode("align");
    try{ location.reload(); }catch(e){}
  }
  // In-page replacement for confirm(), which some embedded browsers and
  // home-screen web apps silently block (it returns false without showing).
  var confirmModal = $("confirmModal"), confirmMsg = $("confirmMsg");
  var confirmOk = $("confirmOk"), confirmCancel = $("confirmCancel");
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

  function askRestart(){
    askConfirm("Start a new painting? This clears your reference and painting photos.", "Start new", restart);
  }
  restartBtn.addEventListener("click", askRestart);

  // ---------------- boot ----------------
  (function boot(){
    var saved = loadStore();
    if(saved && saved.ref){
      state.refDataUrl = saved.ref;
      state.refW = saved.refW; state.refH = saved.refH;
      state.alignedDataUrl = saved.aligned || null;
      state.offU = Number(saved.offU) || 0; state.offV = Number(saved.offV) || 0;
      state.lastCorners = (saved.lastCorners && saved.lastCorners.pts && saved.lastCorners.pts.length === 4) ? saved.lastCorners : null;
      if(state.alignedDataUrl){
        enableCompareTabs(true);
        refreshSetupUI();
        setMode("compare");
        return;
      }
    }
    refreshSetupUI();
    setMode("align");
  })();

})();
