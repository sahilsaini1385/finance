# Icon art

`budgie-icon.svg` is the single source for every Budgie icon — the beagle on a
sage ground with a faint glitter (thresholded noise at two scales, plus a soft
light source so the flecks have something to catch).

Regenerate after editing the SVG:

```sh
node art/render-icons.mjs            # writes public/apple-touch-icon.png, icon-192.png, icon-512.png
node art/render-icons.mjs --favicon  # also prints the data URI for index.html's <link rel="icon">
```

Rendering goes through headless Chromium (`BUDGIE_CHROMIUM`, default
`/opt/pw-browsers/chromium`) because home-screen icons must be flat PNGs — the
browser is what bakes the SVG filter into pixels. The favicon variant keeps the
filter inline and rounds its corners; anywhere the filter isn't honored it
degrades to the plain sage gradient.
