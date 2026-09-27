// Service worker: keeps a copy of the app so it opens offline (e.g. in the
// studio without wifi). Same-origin requests go network-first so updates
// arrive as soon as there's a connection, falling back to the cache.
// Fonts are cached on first use.
importScripts("version.js");
var CACHE = "compart-" + self.APP_VERSION;
var SHELL = [
  "./", "index.html", "app.css", "app.js", "store.js", "warp.js", "warp-worker.js",
  "munsell.js", "munsell-data.js", "version.js", "apple-touch-icon.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
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

  e.respondWith(fetch(req).then(function(res){
    if(res && res.ok){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); });
    }
    return res;
  }).catch(function(){
    return caches.match(req).then(function(hit){ return hit || caches.match("./"); });
  }));
});
