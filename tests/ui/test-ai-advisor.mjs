// End-to-end test of the AI advisor: two transports.
//  1. Claude-subscription bridge (localhost:8765, mocked) — the free path.
//  2. Direct API key to api.anthropic.com (mocked SSE).
// Claude Code tokens (sk-ant-oat…) must still be refused at connect time.
import { chromium } from 'playwright-core'

const BASE = process.env.BUDGIE_TEST_URL || 'http://localhost:8471'
const CHROMIUM = process.env.BUDGIE_CHROMIUM || '/opt/pw-browsers/chromium'

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)) }

const captured = []
const sse = text => {
  const evs = []
  const push = (event, data) => evs.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  push('message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 0 } } })
  push('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/[\s\S]{1,20}/g) || []) {
    push('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })
  }
  push('content_block_stop', { type: 'content_block_stop', index: 0 })
  push('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 60 } })
  push('message_stop', { type: 'message_stop' })
  return evs.join('')
}

const ANSWER = 'You are in **good shape** this month.\n- Safe to spend is healthy\n- Groceries are on pace\nKeep the 401(k) match going.'

await page.route('https://api.anthropic.com/**', async route => {
  const req = route.request()
  captured.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') })
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'access-control-allow-origin': '*' },
    body: sse(ANSWER),
  })
})

console.log('Setup offers subscription bridge (primary) and API key')
await page.goto(BASE + '/seed.html#advisor', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
ok(await page.getByText('Ask Budgie about your finances').count() === 1, 'setup teaser renders on Advisor page')
await page.getByRole('button', { name: 'Set up' }).click()
await page.waitForTimeout(200)
ok(await page.getByText('Use your Claude subscription (Pro/Max) — no extra cost.').count() === 1, 'subscription option documented first')
ok(await page.locator('a[href="/budgie-bridge.py"][download]').count() === 1, 'bridge script download link')
ok(await page.getByText('platform.claude.com/settings/keys').count() >= 1, 'API-key fallback documented')

console.log('Claude Code tokens are refused at connect')
await page.getByLabel('Anthropic API key').fill('sk-ant-oat01-FAKE-TEST-TOKEN')
await page.getByRole('button', { name: 'Connect key' }).click()
await page.waitForTimeout(300)
ok(await page.getByText('Claude Code token').count() >= 1, 'oat token rejected with explanation')
let store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(!store.connections?.claude, 'oat token never stored')

console.log('Bridge down → helpful error; bridge up → connects')
await page.route('http://127.0.0.1:8765/**', route => route.fulfill({ status: 500, body: 'down' }))
await page.getByRole('button', { name: 'Use my Claude subscription' }).click()
await page.waitForTimeout(600)
ok(await page.getByText('Couldn’t reach the bridge from this page.').count() === 1, 'bridge-down diagnosis shown')
ok(await page.locator('a[href="http://127.0.0.1:8765/health"]').count() === 1, 'self-test health link offered')
ok(await page.getByText('access devices on your local network').count() >= 1, 'local-network permission prompt explained')
await page.unroute('http://127.0.0.1:8765/**')
const bridgeReqs = []
await page.route('http://127.0.0.1:8765/**', async route => {
  const req = route.request()
  if (req.url().endsWith('/health')) {
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, bridge: 'budgie', version: 1 }) })
  }
  bridgeReqs.push(JSON.parse(req.postData() || '{}'))
  const nd = [
    JSON.stringify({ text: 'Your bridge answer: ' }),
    JSON.stringify({ text: '**all good** here.' }),
    JSON.stringify({ done: true }),
  ].join('\n') + '\n'
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/x-ndjson', body: nd })
})
await page.getByRole('button', { name: 'Use my Claude subscription' }).click()
await page.waitForTimeout(600)
ok(await page.getByText('your Claude plan').count() >= 1, 'badge shows subscription billing')
store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.connections?.claude?.token === 'bridge', 'bridge connection stored (no secret)')

console.log('Ask through the bridge')
await page.getByRole('button', { name: 'How is our budget looking this month?' }).click()
await page.waitForTimeout(1200)
ok(await page.locator('.chat-bubble.assistant strong', { hasText: 'all good' }).count() === 1, 'bridge answer streamed and rendered')
const b1 = bridgeReqs[0]
ok(Boolean(b1), 'bridge request captured')
ok(b1 && typeof b1.system === 'string' && b1.system.includes('FINANCIAL_SNAPSHOT'), 'system prompt flattened to text with snapshot')
ok(b1 && b1.system.includes('SCOPE — money topics only'), 'scope guard included')
ok(b1 && b1.messages.length === 1 && b1.messages[0].role === 'user', 'messages carried')
ok(b1 && b1.model === 'claude-opus-5', 'model carried')
ok(b1 && b1.provider === 'claude', 'provider field sent to bridge')

console.log('API-key path uses x-api-key')
await page.getByRole('button', { name: 'Disconnect' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Anthropic API key').fill('sk-ant-api03-FAKE-KEY')
await page.getByRole('button', { name: 'Connect key' }).click()
await page.waitForTimeout(400)
ok(await page.getByText('API credits').count() >= 1, 'badge shows API credits')
await page.getByLabel('Ask the advisor').fill('How are the goals doing?')
await page.getByRole('button', { name: 'Ask', exact: true }).click()
await page.waitForTimeout(1500)
ok(await page.locator('.chat-bubble.assistant strong', { hasText: 'good shape' }).count() === 1, 'direct answer streamed and markdown-rendered')
const r1 = captured[0]
ok(Boolean(r1), 'request intercepted')
ok(r1 && r1.headers['x-api-key'] === 'sk-ant-api03-FAKE-KEY', 'API key sent as x-api-key')
ok(r1 && !r1.headers['authorization'], 'no Authorization header for API keys')
ok(r1 && r1.body.model === 'claude-opus-5', 'defaults to claude-opus-5')
ok(r1 && r1.body.stream === true, 'streaming request')
ok(r1 && JSON.stringify(r1.body.system).includes('FINANCIAL_SNAPSHOT'), 'system prompt carries the snapshot')
ok(r1 && JSON.stringify(r1.body.system).includes('marginalFedRatePct'), 'tax snapshot (marginal bracket) sent')
ok(r1 && (r1.body.tools || []).some(t => t.name === 'web_search'), 'web search tool offered')
ok(r1 && r1.body.messages.length === 3, 'chat history carried across transports')
store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(store.aiChat.length === 4, 'chat thread persisted (2 questions + 2 answers)')

console.log('Legacy stored oat connection → reconnect banner, not a dead chat')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('finance-app-v1'))
  s.connections.claude = { token: 'sk-ant-oat01-LEGACY-SAVED', model: 'claude-opus-5' }
  localStorage.setItem('finance-app-v1', JSON.stringify(s))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
ok(await page.getByText('rejects those outside Claude Code itself').count() === 1, 'legacy oat connection explained')
ok(await page.getByRole('button', { name: 'Use my Claude subscription' }).count() === 1, 'subscription path offered for reconnect')
await page.getByRole('button', { name: 'Disconnect' }).click()
await page.waitForTimeout(300)
store = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-app-v1')))
ok(!store.connections?.claude, 'legacy oat connection cleared on disconnect')
ok(store.aiChat.length === 4, 'chat history kept after disconnect')

await page.screenshot({ path: 'ai-advisor.png', fullPage: false })
ok(errors.length === 0, errors.length ? `page errors: ${errors.slice(0, 3).join(' | ')}` : 'no page errors')
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
