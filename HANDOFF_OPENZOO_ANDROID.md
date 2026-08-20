# Handoff — OpenZoo Android (Play Store / Play Billing)

This tree is the **generic Play Store / any Android 14+** app.

It is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Those are separate products. Do not mix their widget
ids, branding, or feature sets into this repo.

The product is **grokui on a phone**: threads, chat, attach → abstract
bind. First-run is **Google Play Billing**, not Stripe webview and not
Phantom/MWA/x402. Keep the Cordova shell (FreeSolDev/CordovaSeeker lineage).
Do **not** rewrite to Capacitor, SwiftUI, or iOS deeplinks. Do **not**
push to FreeSolDev — this product lives on `staccDOTsol/openzoo-android` only.

---

## Identity (must)

| Field | Value |
|---|---|
| App name | **OpenZoo** |
| Widget id | **`fun.openzoo.android`** (MUST — do not reuse another OpenZoo id) |
| Store | Google Play / any Android 14+ phone |
| First-run | Google Play Billing paywall **before** wallet connect |
| Play SKUs | `fun.openzoo.android.sub.basic` / `.pro` / `.ultra` (monthly) |
| Plans source | `GET https://zoo.openzoo.fun/api/billing/tiers` |
| Wallet | Phantom via MWA — Settings only, off by default |
| Push target | this repo: `staccDOTsol/openzoo-android` |

## Product scope

Ship the grokui client on this Cordova shell: **threads / chat / attach**.
Bind is abstract — never show context ids, `/v1/bind`, bind hashes, or
wrap-twin homework.

Do **not** port RUN / WRITE / READ / SERVE. Those stay off this app.

Do **not** open Chrome/Stripe as the primary path. Do **not** lead with
Phantom/MWA/x402. Crypto wrap can live behind Settings later.

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

## Optional x402 (Settings)

- Gateway: `https://x402-tokens.fly.dev`
- Rails: live `GET https://x402.accrue.fund/supported`
- 402 pay: `POST /v1/pay/build` then **`MWA.signTransaction` only**
- Wrap / top-up: wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE`,
  **`MWA.signAndSendTransaction` allowed**
- Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**
  (not wTOKENx). Hide drained `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`.
- `walletPayEnabled` defaults **false** so a 402 does not wrap/pay.
- Never call `:8402`.

## What this tree is

```
www/index.html                      Play paywall shell — purchase / restore, then iframe
www/js/billing.js                   tiers, product IDs, Play token → key exchange stub
www/app/index.html                  grokui threads + composer + attach + Settings
www/app/js/rails.js                 live /supported + subscription Bearer key
www/app/js/wrap.js                  nine-account wrap-nav builder (bump 254 for wTOKENx2)
www/app/js/bind.js                  abstract attach → corpus
www/app/js/pay.js                   subscription-first paidFetch; optional 402
www/app/js/solana-lite.js           ATA / PDA / legacy tx (no @solana/web3.js)
cordova-plugin-play-billing/        BillingClient 6.2.1: query / purchase / restore / ack
cordova-plugin-openzoo-clipboard/   Android ClipboardManager (not navigator.clipboard)
cordova-plugin-mwa/                 Java: authorize, signMessage, signTransaction,
                                    signAndSendTransaction (Settings later)
config.xml                          widget id fun.openzoo.android
```

`MWA.signTransaction(txB64, ok, err)` returns `{ signedTransaction }` (base64)
and is the only MWA sign API for 402 payment.

`MWA.signAndSendTransaction` is wrap / top-up only.

Keep the existing split: the shell owns Play + wallet; the UI never sees a key.

Address copy is select-to-copy / tap-to-copy with a **copied** toast (burner
copy says **copied local burner**). The clipboard path is Android
`ClipboardManager` (`cordova-plugin-openzoo-clipboard`), not
`navigator.clipboard`.

x402 must not surface WebView **Load failed** / `net::ERR_*`. Persist the 402
across the MWA backgrounding round-trip and retry on `resume`. CSP
`connect-src` must list the gateway and RPCs actually called.

Never open the HTTPS Phantom `/ul/` browse link. Custom scheme, if used, is
`phantom://v1/<method>`. MWA stays the Play/Phantom payment path.
