// One-off: make the app-icon corners transparent. The source icons are square
// with opaque BLACK corners outside the rounded badge, so on the taskbar/window
// they render as a black square. This applies a rounded-rect alpha mask, with
// the corner radius auto-detected from the black corner extent of each image.
import { readFileSync, writeFileSync } from 'fs'
import { PNG } from 'pngjs'

const NEAR_BLACK = 40 // r,g,b all below this = background/corner fill

const isBlack = (png, x, y) => {
  const i = (png.width * y + x) << 2
  return png.data[i] < NEAR_BLACK && png.data[i + 1] < NEAR_BLACK && png.data[i + 2] < NEAR_BLACK
}

/** Diagonal run of near-black pixels from the top-left corner inward. */
function cornerBlackRun(png) {
  let d = 0
  const max = Math.min(png.width, png.height)
  while (d < max && isBlack(png, d, d)) d++
  return d
}

function roundCorners(path) {
  const png = PNG.sync.read(readFileSync(path))
  const { width: w, height: h } = png
  // For a rounded rect (inset 0) with radius R, the diagonal black run at a
  // corner equals R·(1 − 1/√2). Invert to recover R; clamp to a sane range.
  const run = cornerBlackRun(png)
  let R = run > 1 ? run / (1 - 1 / Math.SQRT2) : Math.round(w * 0.225)
  R = Math.max(Math.round(w * 0.12), Math.min(R, Math.round(w * 0.28)))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance into the nearest corner's RxR box
      const cx = x < R ? R - x : x >= w - R ? x - (w - R - 1) : 0
      const cy = y < R ? R - y : y >= h - R ? y - (h - R - 1) : 0
      if (cx > 0 && cy > 0 && Math.hypot(cx, cy) > R) {
        png.data[((w * y + x) << 2) + 3] = 0 // outside the rounded corner → transparent
      }
    }
  }
  writeFileSync(path, PNG.sync.write(png))
  console.log(`rounded ${path} (${w}x${h}) radius=${R} (black run=${run})`)
}

for (const p of process.argv.slice(2)) roundCorners(p)
