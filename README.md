# OpenZoo Android — grokui on a phone

Generic **OpenZoo** for any Android 14+ phone with [Phantom](https://phantom.app/),
shipped via Google Play. Apache Cordova shell + native Mobile Wallet Adapter
(`cordova-plugin-mwa`). This is the same product as the desktop grokui client:
**threads, chat, wallet**, and **attach → bind behind the scenes**.

This is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Stay on this Cordova + MWA tree — do not rewrite to
Capacitor, SwiftUI, or iOS deeplinks, and do not push to FreeSolDev.

| | |
|---|---|
| App name | OpenZoo |
| Widget id / applicationId | `fun.openzoo.android` |
| Product | grokui: threads / chat / wallet / attach |
| Gateway | `https://x402-tokens.fly.dev` |
| Rails | live `GET https://x402.accrue.fund/supported` |
| Wallet | Phantom via MWA |

## How it works

```
┌─────────────────────────────────┐
│ www/index.html  (wallet shell)  │
│  • MWA native connect (Phantom) │
│  • signTransaction  → 402 pay   │
│  • signAndSend      → wrap only │
│  ┌───────────────────────────┐  │
│  │ iframe: www/app/          │  │
│  │  grokui threads + chat    │  │
│  │  attach files/folder/text │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The shell owns all wallet state. The UI never touches keys.

Bind is **abstract**: the user attaches files, a folder, or pasted text. The
app binds a corpus behind the scenes. The UI never shows context ids, `/v1/bind`,
bind hashes, or wrap-twin homework.

## Payment + top-up

1. Live rails from `GET https://x402.accrue.fund/supported` (not a stale allowlist).
2. Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**.
   It replaces the drained mint `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`,
   which is hidden if a 402 still quotes it. Do not label FXYkw… as wTOKENx.
3. Look at what Phantom actually holds (USDC, TOKEN, LEOS, or a live twin).
   If a twin is short, wrap via wrap-nav
   `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE` using the directory `acquire`
   steps. wTOKENx2 wrap is **nine accounts, bump 254**; the program pulls the
   deposit.
4. **402 pay tx:** user partial-signs (`MWA.signTransaction`). Do not broadcast
   — the facilitator stays the fee-payer.
5. **Wrap tx:** may `MWA.signAndSendTransaction`.

A wallet that only holds regular USDC or TOKEN is topped up in-app. The user
is not sent to wrap homework. If Phantom has no SOL for the top-up, the app
says it needs a little SOL — nothing about twins.

Payment is the auth. Requests also send `x-openzoo-namespace: stacc`.

Do not call `:8402` or `/v1/session`.

## Build

```bash
npm install -g cordova
npm install
npm test                 # rails + wrap + bind + live gateway smoke (no wallet)
cordova platform add android
cordova requirements android
cordova build android    # debug APK
```

Requirements: Android SDK + JDK 17. Widget / Gradle `applicationId` comes from
`config.xml` (`fun.openzoo.android`).

### Remaining device test

MWA needs a **real Android 14+ phone with Phantom installed**.

On device:

1. Connect Phantom
2. Send a completion — Phantom should prompt to **sign** (not send) a pay tx
3. Attach a short note and ask a question against it (no context id on screen)
4. With USDC- or TOKEN-only, confirm the in-app top-up (sign-and-send wrap),
   then the pay sign

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## License

MIT
