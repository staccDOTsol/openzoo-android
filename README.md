# OpenZoo Android — grokui on a phone

Generic **OpenZoo** for any Android 14+ phone, shipped via Google Play.
Apache Cordova shell + **Google Play Billing** first-run, plus optional
Phantom Mobile Wallet Adapter (`cordova-plugin-mwa`).

This is the same product as the desktop grokui client: **threads, chat**,
and **attach → bind behind the scenes**. Subscription keys come from
[zoo.openzoo.fun/subscriptions](https://zoo.openzoo.fun/subscriptions)
(`GET https://zoo.openzoo.fun/api/billing/tiers`). Tagline:
**Subscription keys · no x402**.

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
| First-run | Google Play Billing paywall (before wallet) |
| Plans | Basic $9 · Pro $29 (Most teams want this) · Ultra $99 |
| Play SKUs | `fun.openzoo.android.sub.basic` / `.pro` / `.ultra` |
| Gateway | `https://x402-tokens.fly.dev` |
| Wallet | Phantom via MWA — **Settings only**, not first-run |

## How it works

```
┌──────────────────────────────────────┐
│ www/index.html  (Play paywall shell) │
│  • pick Basic / Pro / Ultra          │
│  • Play Billing purchase / restore   │
│  • exchange token → subscription key │
│  ┌────────────────────────────────┐  │
│  │ iframe: www/app/               │  │
│  │  grokui threads + chat         │  │
│  │  attach files/folder/text      │  │
│  │  Settings → optional Phantom   │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

First launch is the Play paywall. There is no CONNECT PHANTOM, no Chrome
Stripe checkout, and no x402 wrap on that screen.

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

## Optional crypto (Settings later)

Phantom / x402 wrap is **off by default** and lives behind Settings. If
enabled later:

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
npm test                 # rails + wrap + bind + billing + live smoke
cordova platform add android
cordova requirements android
cordova build android    # debug APK
```

Requirements: Android SDK + JDK 17. Widget / Gradle `applicationId` comes from
`config.xml` (`fun.openzoo.android`). Play Billing only works on a real
Play Store install.

### Remaining device test

Needs a **real Android 14+ phone** and Play Console products:

1. First run shows Basic / Pro / Ultra — not Phantom, not Stripe
2. Buy or restore a subscription in Google Play
3. App enters grokui (key exchange may stay pending until `/api/billing/play` ships)
4. Attach a short note and ask a question (no context id on screen)

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## License

MIT
