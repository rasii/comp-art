// Tiny promise-based key/value store on IndexedDB. Values can be Blobs,
// so the original photo files are kept as-is (no re-encoding, no base64,
// no 5 MB localStorage squeeze), and writes never block the UI.
window.Store = (function(){
  "use strict";

  var DB_NAME = "compart", STORE = "kv", VERSION = 1;
  var dbPromise = null;

  function open(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error("no indexedDB")); return; }
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function(){ req.result.createObjectStore(STORE); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
      req.onblocked = function(){ reject(new Error("blocked")); };
    });
    dbPromise.catch(function(){ dbPromise = null; });
    return dbPromise;
  }

  function run(mode, fn){
    return open().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE, mode);
        var result = fn(tx.objectStore(STORE));
        tx.oncomplete = function(){ resolve(result && result.result !== undefined ? result.result : undefined); };
        tx.onerror = function(){ reject(tx.error); };
        tx.onabort = function(){ reject(tx.error); };
      });
    });
  }

  return {
    get: function(key){ return run("readonly", function(s){ return s.get(key); }); },
    set: function(key, value){ return run("readwrite", function(s){ s.put(value, key); }); },
    remove: function(key){ return run("readwrite", function(s){ s.delete(key); }); },
    clear: function(){ return run("readwrite", function(s){ s.clear(); }); }
  };
})();
