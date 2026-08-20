# OpenZoo Android — Play Store / Phantom MWA

Generic **OpenZoo** for any Android 14+ phone with [Phantom](https://phantom.app/),
shipped via Google Play. Apache Cordova shell + native Mobile Wallet Adapter
(`cordova-plugin-mwa`) for connect and **`signTransaction`**.

This is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Stay on this Cordova + MWA tree — do not rewrite to
Capacitor, and do not push to FreeSolDev.

| | |
|---|---|
| App name | OpenZoo |
| Widget id / applicationId | `fun.openzoo.android` |
| Product | chat + bind + stats |
| Gateway | `https://x402-tokens.fly.dev` |
| Wallet | Phantom via MWA (`signTransaction` only — never `signAndSend`) |

See [`HANDOFF_OPENZOO_ANDROID.md`](HANDOFF_OPENZOO_ANDROID.md) for identity and
scope. Payment facts were checked live against the gateway (2026-08-17 / 2026-08-20).

## How it works

```
┌─────────────────────────────────┐
│ www/index.html  (wallet shell)  │
│  • MWA native connect (Phantom) │
│  • signTransaction bridge       │
│  ┌───────────────────────────┐  │
│  │ iframe: www/app/          │  │
│  │  chat / bind / stats      │  │
│  │  402 → pay/build → sign   │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The shell owns all wallet state; the UI never touches keys and never builds a
Solana transaction. There is no `@solana/web3.js` / `@solana/spl-token` in the
webview.

## Payment

1. `POST https://x402-tokens.fly.dev/v1/chat/completions` → **402**
2. Pick a payable **Solana** `accepts[]` row (ignore `eip155` on Android)
3. Probe balances with JSON-RPC `getTokenAccountsByOwner` (no web3.js)
4. Prefer the live Solana `accepts[]` row (by `extra.symbol`) in order
   yUSDCx → wTOKENx → wLEOSx. Probe that row's `asset` mint. Plain USDC
   (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) is never an `accepts[]`
   row; `/v1/pay/build` does not wrap.
5. `POST /v1/pay/build` `{ accept, payer }` → unsigned tx + envelope
6. Shell: **`MWA.signTransaction(txB64)` only**
7. Retry the completion with
   `X-PAYMENT: base64({ ...envelope, payload: { transaction: "<signed>" } })`

Payment is the auth — any `Authorization` string is accepted. Requests also
send `x-openzoo-namespace: stacc` (unsigned soft-launch).

A wallet that only holds regular USDC cannot pay. The app **steers** instead
of retrying into a silent simulation failure:

> This app pays with USDC on Solana. If your Phantom wallet only has regular
> USDC, open https://x402.accrue.fund/start to wrap it, then come back.

That URL opens in the system browser. There is **no on-device wrap** in v1.

If the balance probe itself fails, the app tries the live yUSDCx → wTOKENx →
wLEOSx rows and shows the same steer panel when settlement looks underfunded.

## Bind + stats

- Bind (free): `POST /v1/hrr/bind` `{ corpus }` or
  `{ items:[{ text }], context_id? }` → `{ context_id, bound }`. Later chats
  send `x-hrr-context` (optional `x-hrr-top-k`). A chat `404` with
  `error.code = context_not_found` re-binds for free **before** paying.
- Stats: `GET /v1/stats` only (`app`, `today`, `days[]`, `growth`,
  `topModels[]`, `coverage`). Do not call `/v1/session` or anything on `:8402`.
- Models: `GET /v1/models`. Default is `google/gemini-3.7-flash` when present.
  Do not use a fake `openzoo` model id.

This app is chat + bind + stats only. It does not implement desktop RUN /
WRITE / READ / SERVE, and the system prompt says so.

## Build

```bash
npm install -g cordova
npm install
npm test                 # rail picker + live gateway smoke (no wallet)
cordova platform add android
cordova requirements android
cordova build android    # debug APK
```

Requirements: Android SDK + JDK 17. Widget / Gradle `applicationId` comes from
`config.xml` (`fun.openzoo.android`).

Debug APK path after a successful Cordova build (typical):

`platforms/android/app/build/outputs/apk/debug/app-debug.apk`

### Remaining device test (cannot be done in a browser or emulator)

MWA needs a **real Android 14+ phone with Phantom installed**. An emulator is
not enough.

On device:

1. Connect Phantom via the shell (`CONNECT PHANTOM`)
2. Send a completion — Phantom should prompt to **sign** (not send) a tx
3. Bind a short corpus and ask a question against it
4. Open stats
5. With a USDC-only wallet, confirm the wrap steer panel (plain “USDC on
   Solana” copy, wrap page in the system browser) — not a raw RPC / simulation
   error

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## License

MIT
