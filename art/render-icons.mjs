#!/usr/bin/env node
// Renders every Budgie icon from the single SVG source, and prints the
// favicon data URI to paste into index.html.
//
//   node art/render-icons.mjs            # write PNGs
//   node art/render-icons.mjs --favicon  # also print the data URI
//
// Needs a Chromium (BUDGIE_CHROMIUM, default /opt/pw-browsers/chromium) —
// rendering through a real browser is what bakes the SVG filter (the glitter)
// into flat pixels, which iOS and Android home screens require.
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'

const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'
const root = new URL('..', import.meta.url).pathname
const svg = readFileSync(`${root}art/budgie-icon.svg`, 'utf8')

const SIZES = [
  [180, 'public/apple-touch-icon.png'],
  [192, 'public/icon-192.png'],
  [512, 'public/icon-512.png'],
]

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
for (const [size, out] of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><style>*{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: root + out, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  console.log('wrote', out)
}
await browser.close()

if (process.argv.includes('--favicon')) {
  // Rounded corners for the browser tab; filters degrade gracefully to the
  // plain gradient anywhere the data URI's filter isn't honored.
  const rounded = svg
    .replace(/<!--.*?-->/gs, '')     // comments first: one of them mentions rx="0"
    .replaceAll('rx="0"', 'rx="14"') // both full-bleed rects, not just the first
    .replace(/\s+/g, ' ')
    .trim()
  console.log('\nFavicon data URI:\n')
  console.log(`data:image/svg+xml,${encodeURIComponent(rounded)}`)
}
