// The Sync and Admin screens: turning sync on and off, the sync code and
// the account's status; and, for whoever runs the sync server, every
// account with its projects and photos. The syncing itself is sync.js.
// app.js installs this with the pieces of the app it uses (A) and gets
// back what it calls. The code is app.js's own, moved here as it was.
window.SyncUI = function(A){
  "use strict";
  Object.keys(A).forEach(function(k){ if(A[k] === undefined) throw new Error("SyncUI: missing " + k); });
  var $ = A.$, toast = A.toast, askConfirm = A.askConfirm, fmtDay = A.fmtDay, show = A.show, state = A.state, render = A.render;
  var openProject = A.openProject, newProject = A.newProject, renderProjects = A.renderProjects, projThumbUrls = A.projThumbUrls, projModal = A.projModal;
  var fillPaletteSelect = A.fillPaletteSelect, renderPalList = A.renderPalList, palModal = A.palModal, palListView = A.palListView;
  var menuSync = A.menuSync, confirmModal = A.confirmModal, exportModal = A.exportModal, mixModal = A.mixModal, videoModal = A.videoModal;

  // ---- sync (sync.js): the same projects and palettes on all your devices ----
  // What another device changed arrives through these.
  function syncHooks(){
    return {
      changed: function(id, what){
        dropProjThumb(id);
        if(id === A.openId()){
          if(what.reload) reloadOpenProject();
          else if(what.stages){
            A.forgetStageCaches();          // a stage may have been replaced (same stage, new image)
            render();
          }
        }
        if(projModal.classList.contains("show")) renderProjects();
      },
      projects: function(out){
        out.removed.concat(out.renamed).forEach(dropProjThumb);
        if(out.removed.length) toast(out.removed.length === 1 ? "A project was deleted on another device, so it's gone here too." : out.removed.length + " projects were deleted on another device, so they're gone here too.");
        if(!Projects.list().length) newProject();
        else if(!Projects.get(A.openId())) openProject(Projects.activeId());
        if(projModal.classList.contains("show")) renderProjects();
        render();
      },
      palettes: function(){
        Palettes.load(Store).then(function(){
          fillPaletteSelect();
          if(palModal.classList.contains("show") && !palListView.hidden) renderPalList();
        });
      },
      status: function(){ renderSync(); }
    };
  }
  function dropProjThumb(id){ if(projThumbUrls[id]){ URL.revokeObjectURL(projThumbUrls[id]); delete projThumbUrls[id]; } }
  // the open project changed on another device: open it again, in the same
  // view, once nothing is in progress here
  var reloadWaiting = false;
  function reloadOpenProject(){
    if(reloadWaiting) return;
    var busy = state.adjusting || videoModal.classList.contains("show") || exportModal.classList.contains("show") ||
               mixModal.classList.contains("show") || confirmModal.classList.contains("show");
    if(busy){ reloadWaiting = true; setTimeout(function(){ reloadWaiting = false; reloadOpenProject(); }, 4000); return; }
    var mode = state.mode;
    openProject(A.openId()).then(function(){
      if(mode === "blocks" && state.ref) state.mode = "blocks";
      else if(mode === "progress" && Progress.count()) state.mode = "progress";
      else if((mode === "compare" || mode === "side") && state.aligned) state.mode = mode;
      render();
    });
  }

  var syncModal = $("syncModal"), syncOff = $("syncOff"), syncOn = $("syncOn"), syncSeg = $("syncSeg");
  var syncJoinForm = $("syncJoinForm"), syncNewForm = $("syncNewForm"), syncCodeIn = $("syncCodeIn"), syncNameIn = $("syncNameIn");
  var syncInviteIn = $("syncInviteIn"), syncUrlField = $("syncUrlField"), syncUrlIn = $("syncUrlIn"), syncErr = $("syncErr");
  var syncStatus = $("syncStatus"), syncCodeShow = $("syncCodeShow"), syncCodeBtn = $("syncCodeBtn");
  var menuSyncSub = $("menuSyncSub"), menuWhere = $("menuWhere");
  var syncCodeShown = false, syncBusy = false;

  function ago(t){
    var s = (Date.now() - t)/1000;
    if(s < 60) return "just now";
    if(s < 3600) return Math.round(s/60) + " min ago";
    if(s < 86400) return Math.round(s/3600) + " h ago";
    return fmtDay(t);
  }
  var SYNC_ERRORS = {
    offline: "Can't reach the sync server just now. Everything is safe on this device; it will try again.",
    code: "This sync code no longer works: it was changed on another device, or the account was removed. Turn off sync here and join again with the current code.",
    disabled: "Sync has been turned off for this account by whoever runs the sync server. Everything is still on this device.",
    server: "The sync server had a problem. It will try again."
  };
  function syncLine(s){
    if(s.state === "syncing") return s.done ? "Syncing… " + s.done + (s.done === 1 ? " image" : " images") : "Syncing…";
    if(s.state === "error") return s.error === "offline" ? "Offline, will try again" : s.error === "disabled" ? "Turned off by the server" : s.error === "code" ? "Sync code no longer works" : "Problem, will try again";
    if(s.limited && s.limited.length) return "Project limit reached";
    if(s.full) return "Storage full";
    return s.last ? "Up to date · " + ago(s.last) : "On";
  }
  function esc(t){ return String(t).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function renderSync(){
    var s = Sync.status(), on = Sync.on(), acct = Sync.account();
    menuSyncSub.textContent = on ? syncLine(s) : "";
    menuSync.classList.toggle("attn", on && (s.state === "error" || s.full || (s.limited && s.limited.length > 0)));
    menuWhere.textContent = on ? "synced with your sync account." : "your photos stay on this device.";
    if(!syncModal.classList.contains("show")) return;
    syncOff.hidden = on; syncOn.hidden = !on;
    syncUrlField.hidden = on || !!Sync.defaultUrl();
    if(!on) return;
    var html = "<b>" + esc(syncLine(s)) + "</b>";
    if(s.info) html += "<br><span class='mix-note'>" + esc(acct.name || s.info.name || "") + " · " + s.info.projects + " of " + s.info.limit + " projects" + (s.info.cap ? " · " + mb(s.info.bytes || 0) + " of " + mb(s.info.cap) : "") + " on the server</span>";
    syncStatus.innerHTML = html;
    var msg = s.state === "error" ? (SYNC_ERRORS[s.error] || SYNC_ERRORS.server) : "";
    if(s.limited && s.limited.length) msg = (msg ? msg + " " : "") + "Only " + ((s.info && s.info.limit) || 10) + " projects can sync, so " + s.limited.map(function(n){ return "“" + n + "”"; }).join(", ") + (s.limited.length > 1 ? " aren't" : " isn't") + " synced. Delete a project you no longer need to make room.";
    if(s.full) msg = (msg ? msg + " " : "") + "Your account's storage on the server is full" + (s.info && s.info.cap ? " (" + mb(s.info.cap) + ")" : "") + ", so some photos aren't synced. Delete a project or some stages you no longer need to make room.";
    syncErr.textContent = msg; syncErr.hidden = !msg;
    syncCodeShow.textContent = syncCodeShown ? acct.code : "••••-••••-••••-••••-••••";
    syncCodeBtn.textContent = syncCodeShown ? "Hide" : "Show";
    $("syncNowBtn").disabled = s.state === "syncing";
  }
  function openSync(){
    syncCodeShown = false; syncErr.hidden = true;
    if(!syncUrlIn.value) syncUrlIn.value = Sync.defaultUrl();
    syncModal.classList.add("show");
    renderSync();
  }
  function closeSync(){ syncModal.classList.remove("show"); }
  function showSyncForm(v){
    Array.prototype.forEach.call(syncSeg.children, function(b){ b.classList.toggle("on", b.dataset.v === v); });
    syncJoinForm.hidden = v !== "join"; syncNewForm.hidden = v !== "new";
    syncErr.hidden = true;
  }
  syncSeg.addEventListener("click", function(e){ var b = e.target.closest("button"); if(b) showSyncForm(b.dataset.v); });
  var JOIN_ERRORS = {
    invite: "That invite code isn't right.", code: "That sync code isn't right. Check it on your other device (⋯ › Sync › Show).",
    closed: "This sync server isn't taking new accounts.", disabled: "That account has been turned off.",
    offline: "Couldn't reach the sync server. Check the address and your connection.", "no-server": "Enter the sync server's address."
  };
  function syncAttempt(p, label){
    if(syncBusy) return;
    syncBusy = true; syncErr.hidden = true;
    p().then(function(){
      syncBusy = false; toast(label);
      renderSync();
    }, function(e){
      syncBusy = false;
      syncErr.textContent = JOIN_ERRORS[e && e.code] || "That didn't work (" + ((e && e.code) || "error") + "). Try again.";
      syncErr.hidden = false;
    });
  }
  $("syncJoinBtn").addEventListener("click", function(){
    var code = syncCodeIn.value.trim();
    if(!code){ syncCodeIn.focus(); return; }
    syncAttempt(function(){ return Sync.join(syncUrlIn.value, code); }, "Sync is on. Your projects are being synced.");
  });
  $("syncNewBtn").addEventListener("click", function(){
    var name = syncNameIn.value.trim(), invite = syncInviteIn.value.trim();
    if(!name){ syncNameIn.focus(); return; }
    if(!invite){ syncInviteIn.focus(); return; }
    syncAttempt(function(){ return Sync.signup(syncUrlIn.value, invite, name).then(function(){ syncCodeShown = true; }); }, "Sync is on. Note your sync code for your other devices.");
  });
  $("syncNowBtn").addEventListener("click", function(){ Sync.run(); });
  syncCodeBtn.addEventListener("click", function(){ syncCodeShown = !syncCodeShown; renderSync(); });
  $("syncCopyBtn").addEventListener("click", function(){
    var code = (Sync.account() || {}).code || "";
    function shown(){ syncCodeShown = true; renderSync(); toast("Couldn't copy: the code is showing, select it to copy."); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(function(){ toast("Sync code copied."); }, shown);
    else shown();
  });
  $("syncRotateBtn").addEventListener("click", function(){
    askConfirm("Change your sync code? The old one stops working at once, so your other devices will need the new code (⋯ › Sync there: turn off, then join with the new code).",
      "Change code", function(){
        Sync.rotate().then(function(){ syncCodeShown = true; renderSync(); toast("Your sync code has changed."); },
                           function(e){ toast(e && e.code === "offline" ? "Couldn't reach the sync server. Try again." : "The code couldn't be changed. Try again."); });
      });
  });
  $("syncLeaveBtn").addEventListener("click", function(){
    askConfirm("Turn off sync on this device? Your projects stay here and on the server, and other devices keep syncing. You can join again with your sync code, so make sure you have it.",
      "Turn off", function(){ Sync.leave().then(function(){ showSyncForm("join"); renderSync(); }); });
  });
  $("syncDone").addEventListener("click", closeSync);
  syncModal.addEventListener("click", function(e){ if(e.target === syncModal) closeSync(); });
  $("syncAdminBtn").addEventListener("click", function(){ closeSync(); openAdmin(); });
  setInterval(function(){ if(Sync.on()) renderSync(); }, 30000);     // "… min ago"

  // ---- admin: the accounts on the sync server, for whoever runs it ----
  var adminModal = $("adminModal"), adminBody = $("adminBody"), adminNote = $("adminNote"), adminBack = $("adminBack");
  var adminKeyView = $("adminKeyView"), adminKeyIn = $("adminKeyIn"), adminUrlIn = $("adminUrlIn"), adminForget = $("adminForget");
  var adminCfg = null, adminViews = [], adminUrls = [];
  function adminFail(e){
    adminNote.textContent = e && e.code === "admin" ? "That admin key isn't right." : e && e.code === "offline" ? "Couldn't reach the sync server." : "That didn't work (" + ((e && e.code) || "error") + ").";
  }
  function adminImg(img, acct, key){
    if(!key) return;
    Sync.admin(adminCfg, "GET", "/f/" + acct + "/" + key, null, "blob").then(function(b){
      if(!b) return;
      var u = URL.createObjectURL(b); adminUrls.push(u); img.src = u;
    }).catch(function(){});
  }
  function adminClear(){ adminUrls.forEach(function(u){ URL.revokeObjectURL(u); }); adminUrls = []; adminBody.innerHTML = ""; adminNote.textContent = ""; }
  function adminShow(view, push){
    if(push !== false) adminViews.push(view);
    adminClear();
    adminBack.hidden = adminViews.length < 2;
    view();
  }
  function openAdmin(){
    adminViews = []; adminClear();
    $("adminTitle").textContent = "Admin";
    adminBack.hidden = true;
    adminModal.classList.add("show");
    Store.get("syncAdmin").then(function(a){
      adminCfg = a && a.key ? a : null;
      adminUrlIn.value = (a && a.url) || (Sync.account() || {}).url || Sync.defaultUrl();
      adminKeyView.hidden = !!adminCfg; adminForget.hidden = !adminCfg;
      if(adminCfg) adminShow(adminAccounts);
    }).catch(function(){ adminKeyView.hidden = false; });
  }
  function closeAdmin(){ adminModal.classList.remove("show"); adminClear(); adminViews = []; }
  $("adminOpenBtn").addEventListener("click", function(){
    var a = { url: adminUrlIn.value.trim(), key: adminKeyIn.value };
    if(!a.key){ adminKeyIn.focus(); return; }
    Sync.admin(a, "GET", "/accounts").then(function(){
      adminCfg = a; adminKeyIn.value = "";
      Store.set("syncAdmin", a).catch(function(){});
      adminKeyView.hidden = true; adminForget.hidden = false;
      adminShow(adminAccounts);
    }, adminFail);
  });
  adminForget.addEventListener("click", function(){
    Store.remove("syncAdmin").catch(function(){});
    adminCfg = null; adminViews = []; adminClear();
    $("adminTitle").textContent = "Admin";
    adminKeyView.hidden = false; adminForget.hidden = true; adminBack.hidden = true;
  });
  adminBack.addEventListener("click", function(){ adminViews.pop(); adminShow(adminViews[adminViews.length - 1], false); });
  $("adminDone").addEventListener("click", closeAdmin);
  adminModal.addEventListener("click", function(e){ if(e.target === adminModal) closeAdmin(); });
  // sizes in the units Cloudflare counts in (1 GB = 1024³ bytes)
  function mb(b){
    var gb = b/1073741824, m = b/1048576;
    if(gb >= 1) return (Math.round(gb*100)/100).toString().replace(/\.?0+$/, "") + " GB";
    return (m < 10 && m > 0 ? (Math.round(m*10)/10) : Math.round(m)) + " MB";
  }
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }

  function adminAccounts(){
    $("adminTitle").textContent = "Accounts";
    adminNote.textContent = "Loading…";
    Sync.admin(adminCfg, "GET", "/accounts").then(function(r){
      adminNote.textContent = r.accounts.length ? "" : "No accounts yet.";
      adminBody.appendChild(el("p", "adm-total", mb(r.total) + " stored in all · the free tier is 10 GB · " + r.limit + " projects and " + mb(r.cap || 0) + " per account"));
      var ul = el("ul", "adm-list");
      r.accounts.sort(function(a, b){ return (b.seen || 0) - (a.seen || 0); }).forEach(function(a){
        var li = el("li"), row = el("div", "adm-row" + (a.disabled ? " off" : ""));
        var main = el("div", "proj-main");
        main.appendChild(el("span", "proj-name", a.name + (a.disabled ? " · turned off" : "")));
        main.appendChild(el("span", "proj-sub", a.projects + (a.projects === 1 ? " project · " : " projects · ") + mb(a.bytes) + " · last synced " + (a.seen ? ago(a.seen) : "never") + " · since " + fmtDay(a.created)));
        var btns = el("div", "proj-btns");
        var tog = el("button", "btn small", a.disabled ? "Turn on" : "Turn off");
        tog.addEventListener("click", function(e){
          e.stopPropagation();
          Sync.admin(adminCfg, "POST", "/accounts/" + a.id, { disabled: !a.disabled }).then(function(){ adminShow(adminAccounts, false); }, adminFail);
        });
        var del = el("button", "btn small ghost", "Delete");
        del.addEventListener("click", function(e){
          e.stopPropagation();
          askConfirm("Delete " + a.name + "’s account and everything it has on the sync server (" + mb(a.bytes) + ")? Their devices keep their own copies, but can't sync any more.",
            "Delete", function(){ Sync.admin(adminCfg, "DELETE", "/accounts/" + a.id).then(function(){ toast("Account deleted."); adminShow(adminAccounts, false); }, adminFail); });
        });
        btns.appendChild(tog); btns.appendChild(del);
        row.appendChild(main); row.appendChild(btns);
        row.addEventListener("click", function(){ adminShow(function(){ adminAccount(a); }); });
        li.appendChild(row); ul.appendChild(li);
      });
      adminBody.appendChild(ul);
    }, adminFail);
  }
  function adminAccount(a){
    $("adminTitle").textContent = a.name;
    adminNote.textContent = "Loading…";
    Sync.admin(adminCfg, "GET", "/f/" + a.id + "/index.json").then(function(idx){
      var ids = Object.keys((idx && idx.projects) || {});
      adminNote.textContent = ids.length ? "" : "No projects synced yet.";
      var ul = el("ul", "adm-list");
      ids.sort(function(x, y){ return (idx.projects[y].updated || 0) - (idx.projects[x].updated || 0); }).forEach(function(pid){
        var p = idx.projects[pid], li = el("li"), row = el("div", "adm-row");
        var img = el("img", "proj-thumb"); img.alt = "";
        var main = el("div", "proj-main");
        main.appendChild(el("span", "proj-name", p.name));
        main.appendChild(el("span", "proj-sub", (p.photos || 0) + ((p.photos || 0) === 1 ? " progress photo · " : " progress photos · ") + fmtDay(p.updated || p.created)));
        row.appendChild(img); row.appendChild(main);
        Sync.admin(adminCfg, "GET", "/f/" + a.id + "/p/" + pid + "/doc.json").then(function(doc){
          if(!doc) return;
          var f = doc.files || {};
          adminImg(img, a.id, "p/" + pid + "/" + ((f.thumb && f.thumb.k) || (f.ref && f.ref.k) || ""));
          row.addEventListener("click", function(){ adminShow(function(){ adminProject(a, p, pid, doc); }); });
        }).catch(function(){});
        li.appendChild(row); ul.appendChild(li);
      });
      adminBody.appendChild(ul);
    }, adminFail);
  }
  function adminProject(a, p, pid, doc){
    $("adminTitle").textContent = p.name;
    var P = "p/" + pid + "/", f = doc.files || {}, grid = el("div", "adm-grid"), items = doc.items || [];
    function tile(label, key, full){
      var img = el("img"); img.alt = label; img.title = label;
      adminImg(img, a.id, P + key);
      img.addEventListener("click", function(){ adminShow(function(){ adminPhoto(a, label, P + full); }); });
      grid.appendChild(img);
    }
    if(f.ref && f.ref.k) tile("Reference", f.ref.k, f.ref.k);
    if(f.photo && f.photo.k) tile("Latest painting photo", f.photo.k, f.photo.k);
    items.forEach(function(it, i){ tile("Stage " + (i + 1) + " · " + fmtDay(it.t), it.tk || it.k, it.k); });
    adminBody.appendChild(el("p", "adm-total", "The reference, the latest painting photo, then " + items.length + (items.length === 1 ? " progress photo" : " progress photos") + ". Tap one to see it full size."));
    adminBody.appendChild(grid);
  }
  function adminPhoto(a, label, key){
    $("adminTitle").textContent = label;
    var img = el("img", "adm-full"); img.alt = label;
    adminNote.textContent = "Loading…";
    Sync.admin(adminCfg, "GET", "/f/" + a.id + "/" + key, null, "blob").then(function(b){
      adminNote.textContent = "";
      if(!b) return;
      var u = URL.createObjectURL(b); adminUrls.push(u); img.src = u;
    }, adminFail);
    adminBody.appendChild(img);
  }

  // the Escape key, from app.js: true when it closed the admin screen
  function closeIfOpen(){
    if(syncModal.classList.contains("show")) closeSync();
    if(!adminModal.classList.contains("show")) return false;
    closeAdmin();
    return true;
  }

  return { syncHooks: syncHooks, renderSync: renderSync, openSync: openSync, closeIfOpen: closeIfOpen };
};
