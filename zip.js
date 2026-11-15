// Zip: the archive file for a project (see "Archive…" in Projects).
// Writes plain .zip files with the entries stored as they are (photos are
// JPEGs already, so compressing them gains nothing), which any computer
// can open. Reads those back, and also zips re-made by another program
// (deflated entries, through DecompressionStream where the browser has it).
window.Zip = (function(){
  "use strict";

  var CRC = (function(){
    var t = new Uint32Array(256);
    for(var n = 0; n < 256; n++){
      var c = n;
      for(var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes){
    var c = 0xFFFFFFFF;
    for(var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function bytesOf(data){
    if(typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
    return data.arrayBuffer().then(function(b){ return new Uint8Array(b); });
  }
  function dosTime(d){ return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); }
  function dosDate(d){ return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(); }

  // files: [{name, data: Blob | string}] → a Blob (application/zip)
  function make(files){
    var now = new Date(), time = dosTime(now), date = dosDate(now);
    var parts = [], central = [], offset = 0;
    return files.reduce(function(chain, f){
      return chain.then(function(){ return bytesOf(f.data); }).then(function(bytes){
        var name = new TextEncoder().encode(f.name), crc = crc32(bytes), size = bytes.length;
        var h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);   // UTF-8 names
        h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
        h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
        h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        parts.push(h.buffer, name, bytes);
        var c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
        c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
        central.push(c.buffer, name);
        offset += 30 + name.length + size;
      });
    }, Promise.resolve()).then(function(){
      var cdSize = central.reduce(function(s, p){ return s + p.byteLength; }, 0);
      var e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
      e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [e.buffer]), { type: "application/zip" });
    });
  }

  // a zip Blob → Promise of {name: Blob}
  function read(blob){
    var tailLen = Math.min(blob.size, 65557);
    return blob.slice(blob.size - tailLen).arrayBuffer().then(function(tb){
      var t = new DataView(tb), at = -1;
      for(var i = tb.byteLength - 22; i >= 0; i--) if(t.getUint32(i, true) === 0x06054b50){ at = i; break; }
      if(at < 0) throw new Error("not a zip");
      var count = t.getUint16(at + 10, true), cdSize = t.getUint32(at + 12, true), cdOff = t.getUint32(at + 16, true);
      return blob.slice(cdOff, cdOff + cdSize).arrayBuffer().then(function(cb){
        var c = new DataView(cb), p = 0, entries = [];
        for(var n = 0; n < count; n++){
          if(c.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip");
          var method = c.getUint16(p + 10, true), csize = c.getUint32(p + 20, true);
          var nameLen = c.getUint16(p + 28, true), extraLen = c.getUint16(p + 30, true), commentLen = c.getUint16(p + 32, true);
          var local = c.getUint32(p + 42, true);
          var name = new TextDecoder().decode(new Uint8Array(cb, p + 46, nameLen));
          entries.push({ name: name, method: method, csize: csize, local: local });
          p += 46 + nameLen + extraLen + commentLen;
        }
        var out = {};
        return Promise.all(entries.map(function(en){
          if(/\/$/.test(en.name)) return null;                          // a folder
          return blob.slice(en.local, en.local + 30).arrayBuffer().then(function(lb){
            var l = new DataView(lb), start = en.local + 30 + l.getUint16(26, true) + l.getUint16(28, true);
            var data = blob.slice(start, start + en.csize);
            if(en.method === 0) return data;
            if(en.method === 8 && window.DecompressionStream)
              return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
            throw new Error("unsupported zip");
          }).then(function(b){ out[en.name] = b; });
        })).then(function(){ return out; });
      });
    });
  }

  return { make: make, read: read };
})();
