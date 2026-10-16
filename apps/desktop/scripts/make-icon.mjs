// Draws build-resources/icon.png (1024x1024) with the same shapes as icon.svg, in plain Node:
//   node scripts/make-icon.mjs
// No rasterizer is needed (distance fields with 4x4 supersampling). electron-builder derives
// the .ico and .icns from this PNG. Run it again when the geometry changes, and keep icon.svg
// in step: it is the readable description of the same drawing.
import { writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SS = 4
const BG = [0x55, 0x52, 0xd9]
const FG = [0xff, 0xff, 0xff]

const roundedRect = (x, y, left, top, w, h, r) => {
  const dx = Math.abs(x - (left + w / 2)) - (w / 2 - r)
  const dy = Math.abs(y - (top + h / 2)) - (h / 2 - r)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
}
const segment = (x, y, ax, ay, bx, by) => {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)))
  return Math.hypot(x - (ax + t * abx), y - (ay + t * aby))
}

const inBackground = (x, y) => roundedRect(x, y, 0, 0, SIZE, SIZE, 224) <= 0
const inForeground = (x, y) =>
  segment(x, y, 296, 360, 520, 512) <= 36 ||
  segment(x, y, 520, 512, 296, 664) <= 36 ||
  roundedRect(x, y, 560, 636, 200, 72, 36) <= 0

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1)
  raw[row] = 0 // filter: none
  for (let px = 0; px < SIZE; px++) {
    let bg = 0
    let fg = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS
        const y = py + (sy + 0.5) / SS
        if (inBackground(x, y)) {
          bg += 1
          if (inForeground(x, y)) fg += 1
        }
      }
    const total = SS * SS
    const alpha = bg / total
    const mix = bg === 0 ? 0 : fg / bg
    const o = row + 1 + px * 4
    raw[o] = Math.round(BG[0] + (FG[0] - BG[0]) * mix)
    raw[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * mix)
    raw[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * mix)
    raw[o + 3] = Math.round(alpha * 255)
  }
}

const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(fileURLToPath(new URL('../build-resources/icon.png', import.meta.url)), png)
console.log(`icon.png ${png.length} bytes`)
