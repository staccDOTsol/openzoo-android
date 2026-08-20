# OpenZoo Android — grokui on a phone

Generic **OpenZoo** for any Android 14+ phone, shipped via Google Play.
Apache Cordova shell + **Google Play Billing** first (the card path), plus
**x402 / wallet** as the other working option (Phantom MWA + local burner).

This is the same product as the desktop grokui client: **threads, chat**,
and **attach → bind behind the scenes**. Subscription keys come from
[zoo.openzoo.fun/subscriptions](https://zoo.openzoo.fun/subscriptions)
(`GET https://zoo.openzoo.fun/api/billing/tiers`). Tagline:
**Card first · x402 also works**.

Play policy: digital subscriptions in a Play-distributed app must use
**Google Play Billing**, not Stripe-in-webview.

This is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Stay on this Cordova tree — do not rewrite to
Capacitor, SwiftUI, or iOS deeplinks, and do not push to FreeSolDev.

| | |
|---|---|
| App name | OpenZoo |
| Widget id / applicationId | `fun.openzoo.android` |
| Product | grokui: threads / chat / attach |
| First-run | Play Billing plans first, x402 / wallet directly under them |
| Plans | Basic $9 · Pro $29 (Most teams want this) · Ultra $99 |
| Play SKUs | `fun.openzoo.android.sub.basic` / `.pro` / `.ultra` |
| Gateway | `https://x402-tokens.fly.dev` |
| Wallet | Phantom via MWA + local burner — working x402 path, never a lock |

## How it works

```
┌──────────────────────────────────────┐
│ www/index.html  (pay shell)          │
│  • Play Billing Basic / Pro / Ultra  │
│  • x402: Phantom MWA + local burner  │
│  • Continue with x402 (no Play lock) │
│  ┌────────────────────────────────┐  │
│  │ iframe: www/app/               │  │
│  │  grokui threads + chat         │  │
│  │  attach files/folder/text      │  │
│  │  New chat on the header        │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

First screen when they need to pay leads with the card / Play plans.
x402 / wallet sits directly under them. A sideload without Play products
must still enter and pay with x402. No Chrome Stripe checkout.

After a Play purchase the app posts the purchase token to
`POST https://zoo.openzoo.fun/api/billing/play`. That route is **not live
yet**. The client stubs the exchange and keeps a TODO: the backend must
verify the token with the Google Play Developer API and mint the **same**
subscription API key that web Stripe checkout already mints via
`GET /api/billing/key?session=`. Do not invent a second key system.
Do not call `POST /api/billing/checkout` from Android.

Bind is **abstract**: the user attaches files, a folder, or pasted text.
The UI never shows context ids, `/v1/bind`, bind hashes, or wrap-twin homework.

## Plans (copy from live `/api/billing/tiers` — do not invent prices)

| Tier | Price | Savings share | rpm | max bind | top-k |
|---|---|---|---|---|---|
| Basic | $9/mo | 40% | 60 | 32MB | 32 |
| Pro | $29/mo | 20% | 300 | 512MB | 128 |
| Ultra | $99/mo | 10% | 2000 | ~8GB | 256 |

`trialDays` is 0. Usage is invoiced at a **$1.00** threshold.

Play Console must create the three monthly subscription product IDs above.

## x402 / wallet (the other working option)

Addresses are selectable. Tap or select copies via Android ClipboardManager
(toast **copied**; a local burner says **copied local burner**).

x402 does not show raw WebView **Load failed**. A 402 is persisted while
Phantom is in the foreground and retried on resume.

Never open the HTTPS Phantom `/ul/` browse link. Custom scheme is
`phantom://v1/<method>` only. MWA is the Phantom payment path. The local
burner signs on-device (TweetNaCl) and never uses `/ul/`.

x402 wrap is a working pay path, not a Settings-only afterthought:

1. Live rails from `GET https://x402.accrue.fund/supported`
2. Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**
3. Hide drained `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`
4. **402 pay tx:** `MWA.signTransaction` only (facilitator is fee-payer)
5. **Wrap tx:** may `MWA.signAndSendTransaction`

Do not call `:8402` or `/v1/session`.

## Build

```bash
npm install -g cordova
npm install
npm test                 # rails + wrap + bind + billing + clipboard + burner + live smoke
cordova platform add android
cordova requirements android
cordova build android    # debug APK
```

Requirements: Android SDK + JDK 17. Widget / Gradle `applicationId` comes from
`config.xml` (`fun.openzoo.android`). Play Billing only works on a real
Play Store install.

### Remaining device test

Needs a **real Android 14+ phone** and Play Console products:

1. First run shows Basic / Pro / Ultra first, then x402 / wallet under it
2. Buy or restore a Play subscription **or** Continue with x402 / Phantom / burner
3. Sideload / missing Play products still enters via x402
4. Attach a short note and ask a question (no context id on screen)

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## License

MIT
