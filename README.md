# OpenZoo Android — Play Store / Phantom MWA

Generic **OpenZoo** for any Android 14+ phone with [Phantom](https://phantom.app/),
shipped via Google Play. Apache Cordova shell + native Mobile Wallet Adapter
(`cordova-plugin-mwa`) for connect and `signTransaction`.

This is **not** CordovaSeeker, **not** the Seeker dApp store
(`fun.openzoo.seeker`), and **not** PSG1 (`fun.openzoo.psg1`).

| | |
|---|---|
| App name | OpenZoo |
| Widget id | `fun.openzoo.android` |
| Product | chat + bind + stats |
| Gateway | `https://x402-tokens.fly.dev` |
| Wallet | Phantom via MWA (`signTransaction` only — never `signAndSend`) |

See [`HANDOFF_OPENZOO_ANDROID.md`](HANDOFF_OPENZOO_ANDROID.md) for the
implementation handoff (payment rail, scope, and what not to port).

## How it works

```
┌─────────────────────────────────┐
│ www/index.html  (wallet shell)  │
│  • MWA native connect (Phantom) │
│  ┌───────────────────────────┐  │
│  │ iframe: OpenZoo UI        │  │
│  │  chat / bind / stats      │  │
│  │  wallet events via        │  │
│  │  postMessage              │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The shell owns all wallet state; the UI never touches keys.

## Quick start

```bash
npm install -g cordova
npm install
cordova platform add android
cordova run android        # device or emulator
```

Requirements: Android SDK + JDK 17 (`cordova requirements android` to verify).

This import is still the stock Cordova + MWA template. Rebrand `config.xml` /
`package.json` to `fun.openzoo.android` and implement the product as the next
step — do not treat the demo clicker as the app.

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.json.example build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## License

MIT
