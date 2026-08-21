# Handoff — OpenZoo Android (Play Store / Play Billing)

This tree is the **generic Play Store / any Android 14+** app.

It is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Those are separate products. Do not mix their widget
ids, branding, or feature sets into this repo.

The product is **grokui on a phone**: threads, chat, attach → abstract
bind. First-run is **Google Play Billing**. Keep the Cordova shell
(FreeSolDev/CordovaSeeker lineage). Do **not** rewrite to Capacitor,
SwiftUI, or iOS deeplinks. Do **not** push to FreeSolDev — this product
lives on `staccDOTsol/openzoo-android` only.

There is **no** in-app wallet, Phantom/MWA connect, local burner, wrap, or
x402 pay path. Store Android stays Play Billing only.

---

## Identity (must)

| Field | Value |
|---|---|
| App name | **OpenZoo** |
| Widget id | **`fun.openzoo.android`** (MUST — do not reuse another OpenZoo id) |
| Store | Google Play / any Android 14+ phone |
| First-run | Google Play Billing paywall |
| Play SKUs | `fun.openzoo.android.sub.basic` / `.pro` / `.ultra` (monthly) |
| Plans source | `GET https://zoo.openzoo.fun/api/billing/tiers` |
| Push target | this repo: `staccDOTsol/openzoo-android` |

## Product scope

Ship the grokui client on this Cordova shell: **threads / chat / attach /
race / Agent**. Bind is abstract — never show context ids, `/v1/bind`, or
bind hashes.

**Chat** stays completions + race + abstract bind on the gateway.

**Agent** is cloud code-server + Cline (not hosted OCC, not local node-pty).
`POST`/`GET` `/ide/session` with the Play subscription Bearer returns
`{ url, password?, id }`. Load `url` full-bleed in `#agentFrame` (or
Cordova InAppBrowser on device). `viewport-fit=cover`. No nested scroll
trapping. Do not overlay a second composer on the IDE. No subscription
key → no Agent. Never `ANTHROPIC_API_KEY`. Never an open IDE URL. 401 →
subscribe / restore Play. Hosted OCC routes may remain unused.

Do **not** port RUN / WRITE / READ / SERVE onto Chat. Those stay off this
phone chat path. Agent is a remote code-server + Cline session, not those
directives.

Do **not** open Chrome/Stripe as the primary path. Do **not** add Phantom,
MWA, a local burner, wrap, or x402.

A desktop GUI reference is in-repo at `www/app/gui.desktop.html` (layout/UX
only). The shipped UI is `www/app/index.html`.

## Billing (Play first)

Source of truth: https://zoo.openzoo.fun/subscriptions

Live copy (do not invent prices):

- **basic** — Basic $9/mo, 40% share, rpm 60, maxBind 32MB, top-k 32
- **pro** — Pro $29/mo, highlight "Most teams want this", 20% share, rpm 300, maxBind 512MB, top-k 128
- **ultra** — Ultra $99/mo, 10% share, rpm 2000, maxBind ~8GB, top-k 256

`trialDays` is 0. Usage invoiced at $1.00. Page tagline:
**Subscription keys · no x402**.

Web Stripe path (do **not** use from Android primary):

- `POST /api/billing/checkout` `{tier}` → Stripe Checkout URL
- `GET /api/billing/key?session=` → mints the subscription API key

Android path:

1. Play Billing Library purchase / restore (`cordova-plugin-play-billing`)
2. `POST /api/billing/play` `{ packageName, productId, purchaseToken, orderId, tier }`
3. Expected response: same `{ key }` / `{ pending }` shape as `/api/billing/key`

`POST /api/billing/play` is **not deployed** (404 HTML / 500 "Only HTML
requests are supported here"). The client stubs the exchange and stores
the Play token locally. Backend TODO: verify the token with the Google
Play Developer API and mint the **same** key Stripe already mints.
Do not invent a second key system.

That same Play-minted key is the **only** auth for Agent. Every
`/ide/session` call sends `Authorization: Bearer <subscription key>`.
Store Android stays **Play Billing / IAP only** — no x402, no MWA pay
bypass. This change does not sideload or flash a build.

## Cloud IDE door (`/ide/session`)

Door lives on `staccDOTsol/openzoo` / openzoo.fun. This app uses the same
API origin it already uses for billing: **`https://zoo.openzoo.fun`**.

Do not invent a second API. These routes were **not live** when this
client shipped (HTML 500 "Only HTML requests are supported here", same
class of gap as `POST /api/billing/play`):

| Method | Path | Body |
|---|---|---|
| `POST` | `/ide/session` | optional `{ threadId, name }` → `{ url, password?, id }` |
| `GET` | `/ide/session` | resume — same `{ url, password?, id }` (`?id=` if we already have one) |

Every row above: `Authorization: Bearer <OpenZoo subscription key>`.
No key → the Agent chip stays locked and Chat still works. A 401/402/403
is subscribe/restore Play, never an x402 or Stripe prompt. HTML 404/501
is "cloud Agent is not live yet." Load only the returned `url` in the
Agent webview — never a hardcoded open IDE.

Hosted OCC (`/occ/sessions`, messages, files, stop) may remain in-tree
unused.

Do not point Agent at localhost, a sidecar, or an unauthenticated URL.

## What this tree is

Cordova `<content src="index.html">` is the **Play paywall**, not a wallet
landing (that iOS pattern does not apply here). After purchase / restore /
a stored entitlement it iframes `www/app/index.html` (chat). Do not retarget
`content src` at the chat page — that would skip first-run Play Billing.

```
www/index.html                      Play paywall shell — purchase / restore, then iframe
www/js/billing.js                   tiers, product IDs, Play token → key exchange stub
www/app/index.html                  grokui threads + Chat/Agent + attach + Settings
www/app/js/rails.js                 gateway + zoo origin + subscription Bearer key
www/app/js/bind.js                  abstract attach → corpus (Chat)
www/app/js/spill.js                 chat-history prefix bind + short tail (Claude CLI)
www/app/js/race.js                  first-X-of-Y race (default 2 of 4) + cheap judge
www/app/js/ide.js                   cloud code-server + Cline: POST/GET /ide/session
www/js/agent-host.js                full-bleed #agentFrame / InAppBrowser (no second composer)
www/app/js/occ.js                   unused hosted OCC client (door may stay dark)
www/app/js/pay.js                   subscription-key paidFetch (402 → restore Play)
cordova-plugin-play-billing/        BillingClient 6.2.1: query / purchase / restore / ack
cordova-plugin-openzoo-clipboard/   Android ClipboardManager (not navigator.clipboard)
config.xml                          widget id fun.openzoo.android
```

Keep the existing split: the shell owns Play; the UI never sees a key.

**New chat** is a labeled button on the MAIN header (one tap) and a
labeled sidebar row — not a tiny `+` hidden in the drawer.

Chat / bind talk to `https://x402-tokens.fly.dev`. That hostname is the
gateway, not an in-app x402 pay UI. Agent talks to
`https://zoo.openzoo.fun/ide/session` with the Play subscription Bearer,
then loads the returned URL in the Agent webview.

Long threads use the same spill as `npx openzoo claude`: bind the transcript
prefix to a per-thread context id, then POST system + last few turns with
`x-hrr-context`. Never send that header together with the full messages
array. HUD savings is `directUsd / spentUsd` — do not sum `savesVsDirect`.

Race (not spill, not desktop podagent / SPAWN / worktrees): first X countable
back of Y, default first 2 of 4, from the selected band (cheap / medium /
expensive / grok4.6). Cheap classifier among those X; if none clear, last of
those X. Empty / HTTP / pay / fetch-failed are not countable. All-fail never
ships a single model's fetch-failed as the winner. Do not wait on the slowest.
Live status is `racing k/n back…`. Play Billing only — no x402, no wallet.
