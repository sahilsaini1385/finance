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
  'Entertainment',
  'Travel',
  'Subscriptions',
  'Investments',
  'Transfers',
  'Fees',
  'Education',
  'Other',
]

const RULES = [
  ['Income', /payroll|direct dep|salary|paycheck|dividend|interest paid|int pymt/i],
  ['Housing', /mortgage|rent |rental|hoa |property tax/i],
  ['Utilities', /electric|con ed|coned|pg&e|duke energy|water|gas co|utility|verizon|t-mobile|att\b|comcast|xfinity|spectrum|internet/i],
  ['Groceries', /grocery|wegmans|kroger|safeway|aldi|trader joe|whole foods|costco|walmart|target|wal-mart|h mart|food lion|publix|stop & shop/i],
  ['Dining', /restaurant|doordash|grubhub|ubereats|uber eats|chipotle|mcdonald|starbucks|dunkin|pizza|cafe|coffee|sushi|taco|deli|bar & grill/i],
  ['Transport', /uber|lyft|shell|exxon|chevron|bp |sunoco|gas station|mta |transit|parking|toll|amtrak|metro/i],
  ['Health', /pharmacy|cvs|walgreens|rite aid|doctor|dental|clinic|hospital|labcorp|quest diag/i],
  ['Insurance', /geico|state farm|progressive|allstate|liberty mutual|insurance|aetna|cigna|united health|metlife|prudential/i],
  ['Subscriptions', /netflix|spotify|hulu|disney|hbo|max\.com|apple\.com\/bill|icloud|youtube|prime video|audible|patreon|substack/i],
  ['Entertainment', /cinema|amc |theatre|theater|steam|playstation|nintendo|xbox|ticketmaster|stubhub/i],
  ['Travel', /airline|delta air|united air|american air|jetblue|southwest|hotel|marriott|hilton|airbnb|expedia|booking\.com/i],
  ['Investments', /fidelity|vanguard|schwab|brokerage|buy |bought |reinvest|contribution/i],
  ['Transfers', /transfer|zelle|venmo|paypal|cash app|wire |ach pmt|payment thank you|autopay|online payment/i],
  ['Fees', /fee|service charge|overdraft|atm /i],
  ['Education', /tuition|university|college|udemy|coursera/i],
]

export function categorize(description, bankCategory, amount) {
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
