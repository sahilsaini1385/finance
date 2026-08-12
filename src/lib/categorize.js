export const CATEGORIES = [
  'Income',
  'Housing',
  'Utilities',
  'Groceries',
  'Dining',
  'Transport',
  'Health',
  'Insurance',
  'Shopping',
  'Amazon',
  'Entertainment',
  'Travel',
  'Subscriptions',
  'Investments',
  'Transfers',
  'Fees',
  'Education',
  'Giving',
  'Work expenses',
  'Other',
]

const RULES = [
  ['Income', /payroll|direct dep|salary|paycheck|dividend|interest paid|int pymt/i],
  ['Housing', /mortgage|rent |rental|hoa |property tax/i],
  ['Utilities', /electric|con ed|coned|pg&e|duke energy|water|gas co|utility|verizon|t-mobile|\batt\b|comcast|xfinity|spectrum|internet/i],
  // Amazon's grocery arms stay Groceries — they're food, not shopping.
  ['Groceries', /grocery|wegmans|kroger|safeway|aldi|trader joe|whole foods|costco|walmart|target|wal-mart|h mart|food lion|publix|stop & shop|amazon fresh|amzn fresh|amazon groc/i],
  ['Dining', /restaurant|doordash|grubhub|ubereats|uber eats|chipotle|mcdonald|starbucks|dunkin|pizza|cafe|coffee|sushi|taco|deli|bar & grill/i],
  ['Transport', /uber|lyft|shell|exxon|chevron|bp |sunoco|gas station|mta |transit|parking|toll|amtrak|metro/i],
  ['Health', /pharmacy|cvs|walgreens|rite aid|doctor|dental|clinic|hospital|labcorp|quest diag/i],
  ['Insurance', /geico|state farm|progressive|allstate|liberty mutual|insurance|aetna|cigna|united health|metlife|prudential/i],
  ['Subscriptions', /netflix|spotify|hulu|disney|hbo|max\.com|apple\.com\/bill|icloud|youtube|prime video|audible|patreon|substack|amazon prime|amzn prime|prime membership/i],
  // Everything else Amazon lands in its own bucket. Must stay BELOW the
  // Groceries and Subscriptions rules so Fresh/Whole Foods and Prime keep
  // their real categories.
  ['Amazon', /amazon|amzn/i],
  ['Entertainment', /cinema|amc |theatre|theater|steam|playstation|nintendo|xbox|ticketmaster|stubhub/i],
  ['Travel', /airline|delta air|united air|american air|jetblue|southwest|hotel|marriott|hilton|airbnb|expedia|booking\.com/i],
  ['Investments', /fidelity|vanguard|schwab|brokerage|buy |bought |reinvest|contribution/i],
  ['Transfers', /transfer|zelle|venmo|paypal|cash app|wire |ach pmt|payment thank you|autopay|online payment/i],
  ['Fees', /fee|service charge|overdraft|atm /i],
  ['Education', /tuition|university|college|udemy|coursera/i],
  ['Giving', /donat|church|tithe|goodwill|red cross|unicef|salvation army|st jude|gofundme|charity|world vision|habitat for humanity/i],
]

import { normalizeMerchant } from './savings.js'
import { TRANSFER_RE } from './transfers.js'

// One-time sweep for existing data when the Amazon category ships: move
// generic Amazon transactions into it. Conservative on purpose — only rows
// sitting in Shopping/Other (the buckets Amazon used to land in), never
// splits, never grocery/Prime charges, and never merchants the user has an
// explicit rule for.
const AMAZON_RE = /amazon|amzn/i
const AMAZON_KEEP_RE = /amazon fresh|amzn fresh|amazon groc|whole foods|amazon prime|amzn prime|prime membership|prime video/i
export function migrateAmazonCategory(transactions, userRules = []) {
  const ruled = new Set((userRules || []).map(r => r.match))
  let changed = 0
  const out = (transactions || []).map(t => {
    if (!t || t.splits || (t.category !== 'Shopping' && t.category !== 'Other')) return t
    const desc = t.description || ''
    if (!AMAZON_RE.test(desc) || AMAZON_KEEP_RE.test(desc)) return t
    if (ruled.has(normalizeMerchant(desc))) return t
    changed++
    return { ...t, category: 'Amazon' }
  })
  return { transactions: out, changed }
}

// User-defined rules (matched on normalized merchant) always win over the
// built-in keyword heuristics below.
export function categorize(description, bankCategory, amount, userRules = []) {
  if (userRules.length > 0) {
    const merchant = normalizeMerchant(description)
    const hit = userRules.find(r => r.match === merchant)
    if (hit) return hit.category
  }
  // Card-payment phrasing is distinctive enough to outrank merchant keywords —
  // "CHASE CREDIT CARD PAYMENT" must never land in a spending category.
  if (TRANSFER_RE.test(description)) return 'Transfers'
  for (const [cat, re] of RULES) {
    if (re.test(description)) return cat
  }
  if (bankCategory) {
    const bc = bankCategory.toLowerCase()
    const map = {
      'food & drink': 'Dining',
      groceries: 'Groceries',
      gas: 'Transport',
      travel: 'Travel',
      shopping: 'Shopping',
      'health & wellness': 'Health',
      entertainment: 'Entertainment',
      'bills & utilities': 'Utilities',
      education: 'Education',
      fees: 'Fees',
    }
    for (const [k, v] of Object.entries(map)) {
      if (bc.includes(k)) return v
    }
  }
  if (amount > 0) return 'Income'
  return 'Other'
}
