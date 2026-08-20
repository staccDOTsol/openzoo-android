# Handoff — OpenZoo Android (Play Store / Play Billing)

This tree is the **generic Play Store / any Android 14+** app.

It is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Those are separate products. Do not mix their widget
ids, branding, or feature sets into this repo.

The product is **grokui on a phone**: threads, chat, attach → abstract
bind. **CREDIT CARD is first foremost option to pay OR x402.** First-run
leads with Google Play Billing (Basic / Pro / Ultra). x402 / wallet
(Phantom MWA + local burner) sits directly under it and must work when
Play is missing (sideload, no products, error). Never hard-block the rest
of the app behind a successful Play purchase. Keep the Cordova shell
(FreeSolDev/CordovaSeeker lineage). Do **not** rewrite to Capacitor,
SwiftUI, or iOS deeplinks. Do **not** push to FreeSolDev — this product
lives on `staccDOTsol/openzoo-android` only.

---

## Identity (must)

| Field | Value |
|---|---|
| App name | **OpenZoo** |
| Widget id | **`fun.openzoo.android`** (MUST — do not reuse another OpenZoo id) |
| Store | Google Play / any Android 14+ phone |
| First-run | Play Billing plans **first**, x402 / wallet directly under them |
| Play SKUs | `fun.openzoo.android.sub.basic` / `.pro` / `.ultra` (monthly) |
| Plans source | `GET https://zoo.openzoo.fun/api/billing/tiers` |
| Wallet | Phantom via MWA + local burner — working x402 path |
| Push target | this repo: `staccDOTsol/openzoo-android` |

## Product scope

Ship the grokui client on this Cordova shell: **threads / chat / attach**.
Bind is abstract — never show context ids, `/v1/bind`, bind hashes, or
wrap-twin homework.

Do **not** port RUN / WRITE / READ / SERVE. Those stay off this app.

Do **not** open Chrome/Stripe as the primary path. Do **not** lead with
Phantom/MWA/x402 — card / Play is visually first. Do **not** hide x402
behind a Subscribe wall that has no escape.

A desktop GUI reference is in-repo at `www/app/gui.desktop.html` (layout/UX
only). The shipped UI is `www/app/index.html`.

## Billing (card / Play first, x402 also works)

Source of truth: https://zoo.openzoo.fun/subscriptions

Live copy (do not invent prices):

- **basic** — Basic $9/mo, 40% share, rpm 60, maxBind 32MB, top-k 32
- **pro** — Pro $29/mo, highlight "Most teams want this", 20% share, rpm 300, maxBind 512MB, top-k 128
- **ultra** — Ultra $99/mo, 10% share, rpm 2000, maxBind ~8GB, top-k 256

`trialDays` is 0. Usage invoiced at $1.00. Page tagline:
**Card first · x402 also works**.

Web Stripe path (do **not** use from Android primary):

- `POST /api/billing/checkout` `{tier}` → Stripe Checkout URL
- `GET /api/billing/key?session=` → mints the subscription API key

Android card path:

1. Play Billing Library purchase / restore (`cordova-plugin-play-billing`)
2. `POST /api/billing/play` `{ packageName, productId, purchaseToken, orderId, tier }`
3. Expected response: same `{ key }` / `{ pending }` shape as `/api/billing/key`

`POST /api/billing/play` is **not deployed** (404 HTML / 500 "Only HTML
requests are supported here"). The client stubs the exchange and stores
the Play token locally. Backend TODO: verify the token with the Google
Play Developer API and mint the **same** key Stripe already mints.
Do not invent a second key system.

If Play Billing is unavailable, **Continue with x402** / Connect Phantom /
Use local burner must still enter the app. `canEnterApp` is true when
there is a Play entitlement **or** an x402 session (`chosen` / address).

## x402 / wallet (the other working option)

- Gateway: `https://x402-tokens.fly.dev`
- Rails: live `GET https://x402.accrue.fund/supported`
- 402 pay: `POST /v1/pay/build` then **`MWA.signTransaction` only**
  (burner: on-device partial-sign, same pay/build envelope)
- Wrap / top-up: wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE`,
  **`MWA.signAndSendTransaction` allowed** (burner: sign + RPC send)
- Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**
  (not wTOKENx). Hide drained `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`.
- Never call `:8402`.

## What this tree is

```
www/index.html                      pay shell — Play cards first, x402 under them
www/js/billing.js                   tiers, product IDs, Play token → key exchange stub
www/js/burner.js                    local Ed25519 burner + x402 session
www/vendor/nacl-fast.min.js         TweetNaCl (public domain)
www/app/index.html                  grokui threads + composer + attach + New chat
www/app/js/rails.js                 live /supported + subscription Bearer key
www/app/js/wrap.js                  nine-account wrap-nav builder (bump 254 for wTOKENx2)
www/app/js/bind.js                  abstract attach → corpus
www/app/js/pay.js                   paidFetch: Play key or 402, never a sub-only wall
www/app/js/solana-lite.js           ATA / PDA / legacy tx (no @solana/web3.js)
cordova-plugin-play-billing/        BillingClient 6.2.1: query / purchase / restore / ack
cordova-plugin-openzoo-clipboard/   Android ClipboardManager (not navigator.clipboard)
cordova-plugin-mwa/                 Java: authorize, signMessage, signTransaction,
                                    signAndSendTransaction
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

`pickLargestUseful` gates wrap on held TOKEN/USDC/LEOS `> 0` (and
`depositForShares` when reserves are known). It must **not** compare
underlying raw to twin `maxAmountRequired`. Prompt **Wrap TOKEN to send
this?** then `MWA.signAndSend` wrap, confirm, pay. Short SOL or tokens
shows a copyable address + toast.

**New chat** is a labeled button on the MAIN header (one tap) and a
labeled sidebar row — not a tiny `+` hidden in the drawer.

Never open the HTTPS Phantom `/ul/` browse link. Custom scheme, if used, is
`phantom://v1/<method>`. MWA stays the Play/Phantom payment path.
