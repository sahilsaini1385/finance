# Security

Budgie holds people's complete financial picture, so the threat model is worth
stating plainly.

## Where your data lives

Everything is in your browser's `localStorage` under one key
(`finance-app-v1`), plus uploaded documents in IndexedDB. There is no account,
no server-side database, and no telemetry. Clearing site data deletes
everything; `Settings → Export backup` is the only copy that leaves the
browser, and it goes to your own disk.

## Everything that can leave the device

There is no other outbound traffic. Each of these is **off until you turn it
on**, and each sends only what is listed:

| Feature | Goes to | Carries |
|---|---|---|
| Bank sync | SimpleFIN Bridge (your account), optionally via a CORS proxy you deploy | Your SimpleFIN access URL |
| AI advisor | Anthropic, with **your** key or subscription | A few KB of summarized figures — no transaction descriptions beyond top merchants, no document contents, no identifiers |
| Share-price lookup | A public quote endpoint, via this app's `/api/quote` | A ticker symbol. Nothing else |
| Family sync | **Your own** Supabase project | An AES-GCM encrypted blob. The key never leaves your devices |

The proxies in `api/` and `proxy/` are stateless: they forward a request and
return the response. They log nothing and store nothing.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability).

Include what you did, what happened, and what you expected. A proof of concept
against a **synthetic** dataset (`tests/ui/seed.html`) is ideal — please never
attach real financial data to a report.

This is a personal project, not a funded product: expect a best-effort reply
within a week or so, and no bug bounty.

## What counts

Especially interested in:

- Anything that causes data to leave the device that the table above doesn't
  list, or that widens what one of those calls carries.
- Anything that breaks the family-sync encryption boundary, or lets one device
  cause network calls from another.
- XSS or a Content-Security-Policy bypass. The CSP is enforced and tested
  (`tests/ui/test-csp.mjs`); a way around it is a real finding.
- A path where imported or synced data corrupts stored data — a wrong number
  in a finance tool is a security problem in the way that matters to users.

Out of scope: anything requiring physical access to an unlocked device (the
data is local by design), and the absence of authentication (there is no
account to authenticate against).

## Not a vulnerability, by design

- **No password on the app.** Your device's lock screen is the boundary. Adding
  a passphrase over `localStorage` would be theatre unless the data were
  encrypted at rest with a key derived from it — a real feature, but a
  different one.
- **Backups are plaintext JSON.** They're meant to be readable and restorable
  by you; encrypt the file yourself if you store it somewhere shared.
