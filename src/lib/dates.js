// Local-time date keys. new Date().toISOString() is UTC — for any user west
// of UTC, evenings near month/day boundaries put "today" in tomorrow (or next
// month), which corrupted budgets, snapshots, archiving, and bill windows.
// Every "current day/month" in the app must come from these.

export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function localMonth(d = new Date()) {
  return localToday(d).slice(0, 7)
}
