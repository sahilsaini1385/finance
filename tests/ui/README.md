# Browser-level (Playwright) suites

These drive the **built** app in headless Chromium against a local static
server. They aren't part of `npm test` because they need a Chromium binary.

```sh
npm run build
mkdir -p /tmp/budgie-site && cp -r dist/* /tmp/budgie-site/ && cp tests/ui/seed.html /tmp/budgie-site/
(cd /tmp/budgie-site && python3 -m http.server 8471 &)
BUDGIE_CHROMIUM=/path/to/chromium node tests/ui/test-networth-ui.mjs   # or any suite
```

Environment:

- `BUDGIE_TEST_URL` — base URL of the served build (default `http://localhost:8471`)
- `BUDGIE_CHROMIUM` — Chromium executable path (default `/opt/pw-browsers/chromium`)

`seed.html` loads a fully synthetic demo household into localStorage and
redirects into the app — several suites start from it. `smoke.pdf` is a
crafted minimal PDF used by `test-csp.mjs` to prove the pdf.js worker runs
under the Content-Security-Policy.

`test-familysync-baked.mjs` expects a second build served with
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` baked in (see the suite header).
`test-ai-advisor.mjs` stubs the advisor transports; no real keys are used.
