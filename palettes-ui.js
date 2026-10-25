// The paint-recipe (Mix) and Palettes screens: which of your paints make a
// colour, your palettes and your own paints (by the pigment codes on the
// tube, or a tube colour from a photo), export and import. The data and
// the mixing are palettes.js, pigments.js and mix.js. app.js installs this
// with the pieces of the app it uses (A) and gets back what it calls. The
// code is app.js's own, moved here as it was.
window.PalettesUI = function(A){
  "use strict";
  Object.keys(A).forEach(function(k){ if(A[k] === undefined) throw new Error("PalettesUI: missing " + k); });
  var $ = A.$, toast = A.toast, askConfirm = A.askConfirm, show = A.show, state = A.state, storeFail = A.storeFail;
  var decodeToCanvas = A.decodeToCanvas, deliver = A.deliver, fileStamp = A.fileStamp, attachGestures = A.attachGestures, makeZoom = A.makeZoom;
  var linCss = A.linCss, toSrgb = A.toSrgb, patchFor = A.patchFor, samplePatch = A.samplePatch, photoLin = A.photoLin, shapeLin = A.shapeLin;
  var mixModal = A.mixModal, mixTitle = A.mixTitle, mixTargetSw = A.mixTargetSw, mixResultSw = A.mixResultSw, mixClose = A.mixClose, mixList = A.mixList;
  var mixAlt = A.mixAlt, mixAltTitle = A.mixAltTitle, mixAltList = A.mixAltList, mixNote = A.mixNote, mixDone = A.mixDone;
  var mixTargetMun = A.mixTargetMun, mixResultMun = A.mixResultMun, ccMixBtn = A.ccMixBtn, shapeMixBtn = A.shapeMixBtn, photoMixBtn = A.photoMixBtn;

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

  function persistPalettes(){ Palettes.save(Store).catch(storeFail); Sync.palettesChanged(); }
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

  // from the ⋯ menu: the palettes, with no recipe to come back to
  function openPalettesFromMenu(){ lastRecipe = null; openPalettes(); }
  // the Escape key, from app.js: true when the palettes screen took it
  function onEscape(){
    if(palModal.classList.contains("show")){ if(!palListView.hidden) closePalettes(); return true; }
    if(mixModal.classList.contains("show")) closeMix();
    return false;
  }

  return { fillPaletteSelect: fillPaletteSelect, renderPalList: renderPalList, openPalettesFromMenu: openPalettesFromMenu,
           onEscape: onEscape, palModal: palModal, palListView: palListView };
};
