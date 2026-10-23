// Runs the block-in analysis and the photo colour enhancement off the main
// thread. Images are sent once per reference (tagged with a token); later
// requests (colours, detail, values/colour, intensity) reuse them.
importScripts("shapes.js");

var analyzer = null, token = null;     // analysis copy of the reference
var photo = null, photoToken = null;   // display-size copy, for enhancement

self.onmessage = function(e){
  var m = e.data;
  if(m.kind === "enhance"){
    if(m.pixels){ photo = { data: new Uint8ClampedArray(m.pixels.buf), w: m.pixels.w, h: m.pixels.h }; photoToken = m.token; }
    if(!photo || photoToken !== m.token){ self.postMessage({ id: m.id, needPixels: true }); return; }
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
