// Runs the big-shape analysis off the main thread. The reference's pixels
// are sent once per reference (tagged with a token); later requests (a new
// number of shapes, values/colour, background) reuse the analysis.
importScripts("shapes.js");

var analyzer = null, token = null;
self.onmessage = function(e){
  var m = e.data;
  if(m.pixels){
    analyzer = new self.Shapes.Analyzer(new Uint8ClampedArray(m.pixels.buf), m.pixels.w, m.pixels.h);
    token = m.token;
  }
  if(!analyzer || token !== m.token){ self.postMessage({ id: m.id, needPixels: true }); return; }
  var r = analyzer.compute(m.values, m.count, m.bgOne);
  self.postMessage({ id: m.id, result: r });
};
