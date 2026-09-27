// Runs the perspective warp off the main thread so the page stays
// responsive while a full-resolution alignment is baked.
importScripts("warp.js");

self.onmessage = function(e){
  var m = e.data;
  var out = self.Warp.warpPerspective(new Uint8ClampedArray(m.src), m.sW, m.sH, m.corners, m.dstW, m.dstH);
  self.postMessage({ id: m.id, data: out.buffer, w: m.dstW, h: m.dstH }, [out.buffer]);
};
