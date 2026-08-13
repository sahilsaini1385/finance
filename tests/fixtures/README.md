# Test fixtures

## `private/` — never committed

Several suites are driven by **real financial documents**: an ADP earnings
statement, a W-2, and an Amazon A-to-Z benefits statement, captured as the
text layout the in-app PDF extractor produces. They contain names, addresses,
and real compensation figures, so `private/` is git-ignored and those suites
skip themselves cleanly when it's empty (`npm test` still passes).

To run the full battery, place these files in `tests/fixtures/private/`:

| File | What it is | How to regenerate |
| --- | --- | --- |
| `paystub-layout.txt` | ADP earnings statement, layout-extracted text | Upload the paystub PDF on the Income page with the console open — or run `extractPdfTextLayout(file)` from `src/lib/extract.js` and save the string |
| `paystub-pdfjs.txt` | Same statement, raw pdf.js text order | Same, via `extractPdfText` |
| `w2-layout.txt` / `w2-pdfjs.txt` | W-2, both extraction modes | Same, from the W-2 PDF |
| `benefits-statement.txt` / `benefits-pdfjs.txt` | Amazon A-to-Z benefits confirmation text | Copy the statement text from the portal / extract the PDF |

Anyone's real documents in these formats work — the suites assert structural
invariants (to-the-penny reconciliation, YTD parsing, entity mapping) plus a
handful of exact values near the top of each suite that you'd update once for
your own documents.

If you ever intend to commit a fixture, sanitize it first: strip names,
addresses, and file/clock numbers, and scale every dollar amount — then
re-derive the stated totals so the statement still reconciles to the penny,
because that self-check is exactly what the parser tests verify.
