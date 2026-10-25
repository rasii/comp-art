// Perspective warp: maps a quadrilateral of the source image onto a
// destination rectangle (4-point homography, bilinear sampling).
// Plain functions on raw pixel buffers so the same code runs on the main
// thread and inside warp-worker.js.
(function(root){
  "use strict";

  function solveLinear8(A, b){
    var n = 8;
    for(var i=0;i<n;i++) A[i].push(b[i]);
    for(var col=0; col<n; col++){
      var maxRow = col;
      for(var r=col+1;r<n;r++){ if(Math.abs(A[r][col]) > Math.abs(A[maxRow][col])) maxRow = r; }
      var tmp = A[col]; A[col] = A[maxRow]; A[maxRow] = tmp;
      var pivot = A[col][col]; if(Math.abs(pivot) < 1e-12) pivot = 1e-12;
      for(var c=col;c<=n;c++) A[col][c] /= pivot;
      for(var r2=0;r2<n;r2++){
        if(r2 === col) continue;
        var factor = A[r2][col];
        for(var c2=col;c2<=n;c2++) A[r2][c2] -= factor*A[col][c2];
      }
    }
    var x = [];
    for(var i2=0;i2<n;i2++) x.push(A[i2][n]);
    return x;
  }

  // 3x3 homography (row-major, h[8] = 1) taking src[i] → dst[i] for 4 points.
  function computeHomography(src, dst){
    var A = [], b = [];
    for(var i=0;i<4;i++){
      var sx=src[i].x, sy=src[i].y, dx=dst[i].x, dy=dst[i].y;
      A.push([sx, sy, 1, 0,0,0, -sx*dx, -sy*dx]); b.push(dx);
      A.push([0,0,0, sx, sy, 1, -sx*dy, -sy*dy]); b.push(dy);
    }
    var h = solveLinear8(A, b);
    return [h[0],h[1],h[2], h[3],h[4],h[5], h[6],h[7],1];
  }

  function invert3x3(m){
    var a=m[0],b=m[1],c=m[2], d=m[3],e=m[4],f=m[5], g=m[6],h=m[7],i=m[8];
    var A = e*i-f*h, B = -(d*i-f*g), C = d*h-e*g;
    var D = -(b*i-c*h), E = a*i-c*g, F = -(a*h-b*g);
    var G = b*f-c*e, H = -(a*f-c*d), I = a*e-b*d;
    var det = a*A + b*B + c*C; if(Math.abs(det) < 1e-12) det = 1e-12;
    var k = 1/det;
    return [A*k,D*k,G*k, B*k,E*k,H*k, C*k,F*k,I*k];
  }

  // sData: RGBA bytes of the sW x sH source. srcCornersPx: TL,TR,BR,BL in
  // source pixels. Returns RGBA bytes of a dstW x dstH image in which that
  // quad fills the whole rectangle. Pixels that map outside the source are
  // left transparent.
  function warpPerspective(sData, sW, sH, srcCornersPx, dstW, dstH){
    var dstCorners = [ {x:0,y:0}, {x:dstW,y:0}, {x:dstW,y:dstH}, {x:0,y:dstH} ];
    var Hinv = invert3x3(computeHomography(srcCornersPx, dstCorners));
    var oData = new Uint8ClampedArray(dstW*dstH*4);

    var h0=Hinv[0], h1=Hinv[1], h2=Hinv[2], h3=Hinv[3], h4=Hinv[4], h5=Hinv[5], h6=Hinv[6], h7=Hinv[7], h8=Hinv[8];
    var maxX = sW-1, maxY = sH-1, row = sW*4;
    for(var j=0;j<dstH;j++){
      // the parts that only change per row
      var Y = j + 0.5, ay = h1*Y + h2, by = h4*Y + h5, wy = h7*Y + h8, idx = j*dstW*4;
      for(var i=0;i<dstW;i++, idx+=4){
        var X = i + 0.5, iw = 1/(h6*X + wy);
        var sx = (h0*X + ay)*iw, sy = (h3*X + by)*iw;
        if(sx >= 0 && sx < maxX && sy >= 0 && sy < maxY){
          var x0 = sx|0, y0 = sy|0, fx = sx-x0, fy = sy-y0;
          var w11 = fx*fy, w10 = fx-w11, w01 = fy-w11, w00 = 1-fx-fy+w11;
          var i00=(y0*sW+x0)*4, i10=i00+4, i01=i00+row, i11=i01+4;
          // the photo is opaque: the three colour channels, alpha set once
          oData[idx]   = sData[i00]*w00   + sData[i10]*w10   + sData[i01]*w01   + sData[i11]*w11;
          oData[idx+1] = sData[i00+1]*w00 + sData[i10+1]*w10 + sData[i01+1]*w01 + sData[i11+1]*w11;
          oData[idx+2] = sData[i00+2]*w00 + sData[i10+2]*w10 + sData[i01+2]*w01 + sData[i11+2]*w11;
          oData[idx+3] = 255;
        }
      }
    }
    return oData;
  }

  root.Warp = { computeHomography: computeHomography, invert3x3: invert3x3, warpPerspective: warpPerspective };
})(typeof self !== "undefined" ? self : this);
