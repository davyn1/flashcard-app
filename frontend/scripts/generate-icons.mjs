// Generates placeholder PNG icons (no dependencies). Replace the files in
// public/icons/ with your own artwork any time; keep the same names and sizes.
//
//   npm run icons
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = [79, 70, 229] // indigo-600
const CARD_BACK = [165, 180, 252] // indigo-300
const CARD_FRONT = [255, 255, 255]
const ACCENT = [79, 70, 229]

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size)
      const o = y * (size * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// Two stacked flashcards. `pad` shrinks the artwork (maskable icons need a safe zone).
function design(pad) {
  const s = 1 - 2 * pad
  const t = (v) => pad + v * s
  return (x, y) => {
    if (inRoundRect(x, y, t(0.3), t(0.36), t(0.82), t(0.74), 0.05 * s)) {
      // front card with two "text" lines
      if (inRoundRect(x, y, t(0.4), t(0.47), t(0.72), t(0.52), 0.02 * s)) return ACCENT
      if (inRoundRect(x, y, t(0.4), t(0.58), t(0.62), t(0.63), 0.02 * s)) return CARD_BACK
      return CARD_FRONT
    }
    if (inRoundRect(x, y, t(0.18), t(0.24), t(0.7), t(0.62), 0.05 * s)) return CARD_BACK
    return BG
  }
}

const icons = [
  ['icon-192.png', 192, 0.04],
  ['icon-512.png', 512, 0.04],
  ['icon-maskable-512.png', 512, 0.12],
  ['apple-touch-icon.png', 180, 0.06],
]
for (const [name, size, pad] of icons) {
  writeFileSync(join(outDir, name), encodePng(size, design(pad)))
  console.log('wrote', name)
}

writeFileSync(
  join(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5"/><text x="32" y="45" font-size="36" text-anchor="middle" fill="#fff" font-family="'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif" font-weight="700">한</text></svg>\n`,
)
console.log('wrote favicon.svg')
