// Runs canvas detection off the main thread (it takes around a second on
// a full-size photo).
importScripts("detect.js");

self.onmessage = function(e){
  var m = e.data;
  var small = { data: new Uint8ClampedArray(m.small.buf), w: m.small.w, h: m.small.h };
  var medium = { data: new Uint8ClampedArray(m.medium.buf), w: m.medium.w, h: m.medium.h };
  var result = m.mode === "snap"
    ? self.Detect.snap(small, medium, m.corners, m.refAspect)
    : self.Detect.guess(small, medium, m.refAspect);
  self.postMessage({ id: m.id, result: result });
};
