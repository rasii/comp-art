# Comp-Art

A small web app for painters: photograph your painting, line it up with the
reference photo, then compare the two — overlay with peek and opacity, side by
side, black & white for values, and a Munsell colour readout at any spot.

Runs entirely in the browser; photos never leave the device. Made for an iPad
saved to the home screen, but works on any modern browser.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup |
| `app.css` | Styles (dark, fit-to-screen layout) |
| `app.js` | The app: state, `render()`, gestures, alignment, compare, colour reading |
| `warp.js` | Perspective warp (4-point homography), shared with the worker |
| `warp-worker.js` | Runs the warp off the main thread |
| `detect.js` | Finds the canvas in the painting photo (whole-photo guess, and snapping rough points to the edges) |
| `detect-worker.js` | Runs detection off the main thread |
| `munsell.js` | sRGB → Munsell (nearest renotation chip + measured value) and plain-words comparison |
| `munsell-data.js` | Munsell renotation chip data (RIT MCSL `real.dat`) |
| `store.js` | IndexedDB key/value store for the photos, corners and offsets |
| `sw.js` | Service worker so the app opens offline |
| `version.js` | Version string shown in the header; bump it on every release (it also names the offline cache) |
| `apple-touch-icon.png` | Home-screen icon |

## Developing

Serve the folder over HTTP (the worker, IndexedDB and the service worker
don't work from `file://`), for example:

```bash
python -m http.server 8765
```

then open <http://localhost:8765/>.
