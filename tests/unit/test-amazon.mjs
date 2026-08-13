// Amazon category: rule ordering, carve-outs, and the one-time migration.
import { categorize, CATEGORIES, migrateAmazonCategory } from '../../src/lib/categorize.js'
import { allCategories, budgetableCategories, flexibleCategories } from '../../src/lib/budget.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('Categorization rules')
{
  ok(CATEGORIES.includes('Amazon'), 'Amazon is a base category')
  ok(categorize('AMZN Mktp US*1A2B3C', '', -45) === 'Amazon', 'AMZN Mktp → Amazon')
  ok(categorize('AMAZON.COM*ZX9 SEATTLE', 'shopping', -89) === 'Amazon', 'Amazon.com → Amazon even with bank shopping hint')
  ok(categorize('AMZN Digital*Kindle', '', -12) === 'Amazon', 'digital purchases → Amazon')
  ok(categorize('AMAZON FRESH*5F6', '', -120) === 'Groceries', 'Amazon Fresh → Groceries')
  ok(categorize('WHOLE FOODS MKT #10245', '', -84) === 'Groceries', 'Whole Foods → Groceries')
  ok(categorize('AMAZON PRIME*2V4BZ', '', -14.99) === 'Subscriptions', 'Prime membership → Subscriptions')
  ok(categorize('AMZN PRIME MEMBERSHIP', '', -139) === 'Subscriptions', 'annual Prime → Subscriptions')
  ok(categorize('Prime Video*HG12', '', -5.99) === 'Subscriptions', 'Prime Video → Subscriptions')
  ok(categorize('AMAZON.COM SVCS DES:PAYROLL', '', 9000) === 'Income', 'employer payroll deposit never becomes Amazon spending')
  // user rule still wins over everything
  ok(categorize('AMZN Mktp US*BOOKS', '', -20, [{ match: 'AMZN MKTP US', category: 'Education' }]) === 'Education', 'explicit user rule outranks the Amazon rule')
}

console.log('Budget integration')
{
  const state = { customCategories: [] }
  ok(allCategories(state).includes('Amazon'), 'appears in category lists')
  ok(budgetableCategories(state).includes('Amazon'), 'budgetable')
  ok(flexibleCategories(state).includes('Amazon'), 'a flexible envelope, not a fixed bill')
}

console.log('One-time migration')
{
  const txs = [
    { id: '1', description: 'AMZN Mktp US*1A', category: 'Shopping', amount: -50 },
    { id: '2', description: 'AMAZON.COM*B2', category: 'Other', amount: -30 },
    { id: '3', description: 'AMAZON.COM*RET', category: 'Shopping', amount: 25 }, // refund follows too
    { id: '4', description: 'WHOLE FOODS MKT', category: 'Groceries', amount: -80 },
    { id: '5', description: 'AMAZON PRIME*XY', category: 'Subscriptions', amount: -14.99 },
    { id: '6', description: 'AMAZON FRESH*Q1', category: 'Shopping', amount: -60 }, // grocery carve-out even if mis-filed
    { id: '7', description: 'AMZN Mktp US*TV', category: 'Entertainment', amount: -400 }, // manual choice preserved
    { id: '8', description: 'AMZN Mktp US*SPLIT', category: 'Shopping', amount: -100,
      splits: [{ id: 'p', category: 'Shopping', amount: -100 }] }, // splits untouched
    { id: '9', description: 'TARGET 123', category: 'Shopping', amount: -40 },
  ]
  const rules = [{ match: 'AMAZON COM RET', category: 'Shopping' }] // user rule — hands off... (normalizeMerchant form)
  const { transactions: out, changed } = migrateAmazonCategory(txs, [])
  ok(out[0].category === 'Amazon' && out[1].category === 'Amazon', 'Shopping/Other Amazon rows migrate')
  ok(out[2].category === 'Amazon', 'Amazon refunds migrate with their purchases')
  ok(out[3].category === 'Groceries' && out[4].category === 'Subscriptions', 'grocery/Prime untouched')
  ok(out[5].category === 'Shopping', 'mis-filed Fresh row left alone (grocery carve-out)')
  ok(out[6].category === 'Entertainment', 'manually categorized row preserved')
  ok(out[7].category === 'Shopping' && out[7].splits, 'split transaction untouched')
  ok(out[8].category === 'Shopping', 'non-Amazon Shopping untouched')
  ok(changed === 3, `exactly 3 rows changed (got ${changed})`)
  // idempotent: second run changes nothing
  ok(migrateAmazonCategory(out, []).changed === 0, 'second run is a no-op')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
