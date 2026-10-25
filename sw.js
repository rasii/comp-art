// Service worker: keeps a copy of the app so it opens at once, and offline
// (e.g. in the studio without wifi). The app's files are served from the
// cache; a new version (a new version.js makes this a new worker) is
// fetched whole in the background and takes over at a quiet moment (the
// page reloads itself when put away or brought back). Fonts are cached on
// first use.
importScripts("version.js");
var CACHE = "compart-" + self.APP_VERSION;
var SHELL = [
  "./", "index.html", "app.css", "app.js", "store.js", "warp.js", "warp-worker.js",
  "munsell.js", "munsell-data.js", "detect.js", "detect-worker.js", "shapes.js", "shapes-worker.js", "mixbox.js", "mix.js", "pigments.js", "palettes.js", "progress.js", "projects.js", "sync.js", "version.js", "apple-touch-icon.png"
];

self.addEventListener("install", function(e){
  // every file fresh from the network, so a new version can't mix in old files from the browser's cache
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL.map(function(u){ return new Request(u, { cache: "reload" }); })); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  var isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if(url.origin !== self.location.origin && !isFont) return;

  if(isFont){
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      });
    }));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function(hit){
    if(hit) return hit;
    return fetch(req).catch(function(){ return req.mode === "navigate" ? caches.match("./") : Response.error(); });
  }));
});
