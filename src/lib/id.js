// Local id generator. Lives in lib/ rather than store.jsx so pure modules —
// and their tests, which run in plain Node — can use it without pulling in a
// .jsx file Node can't load.
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
