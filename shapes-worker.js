// Runs the block-in analysis and the photo colour enhancement off the main
// thread. Images are sent once per reference (tagged with a token); later
// requests (colours, detail, values/colour, intensity) reuse them.
importScripts("shapes.js");

var analyzer = null, token = null;     // analysis copy of the reference
// copies of the reference for enhancement, by slot: "view" (Block-in,
// display size) and "full" (Compare / Side by side, full size)
var photos = {};

self.onmessage = function(e){
  var m = e.data;
  if(m.kind === "enhance"){
    var slot = m.slot || "view";
    if(m.pixels) photos[slot] = { data: new Uint8ClampedArray(m.pixels.buf), w: m.pixels.w, h: m.pixels.h, token: m.token };
    var photo = photos[slot];
    if(!photo || photo.token !== m.token){ self.postMessage({ id: m.id, needPixels: true }); return; }
    var out = self.Shapes.enhance(photo.data, photo.w, photo.h, m.factor);
    self.postMessage({ id: m.id, result: { buf: out.buffer, w: photo.w, h: photo.h } }, [out.buffer]);
    return;
  }
  if(m.pixels){
    analyzer = new self.Shapes.Analyzer(new Uint8ClampedArray(m.pixels.buf), m.pixels.w, m.pixels.h);
    token = m.token;
  }
  if(!analyzer || token !== m.token){ self.postMessage({ id: m.id, needPixels: true }); return; }
  var r = analyzer.blocks(m.values, m.colours, m.detail/100);
  self.postMessage({ id: m.id, result: r });
};
