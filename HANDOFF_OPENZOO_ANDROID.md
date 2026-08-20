# Handoff — OpenZoo Android (Play Store / Phantom MWA)

This tree is the **generic Play Store / any Android 14+ + Phantom** app.

It is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Those are separate products. Do not mix their widget
ids, branding, or feature sets into this repo.

The generic Play Store product (chat + bind + stats, `fun.openzoo.android`,
x402 via `MWA.signTransaction`) is implemented on this tree. Keep the facts
below; do not re-import the stock clicker or reuse another OpenZoo widget id.

---

## Identity (must)

| Field | Value |
|---|---|
| App name | **OpenZoo** |
| Widget id | **`fun.openzoo.android`** (MUST — do not reuse another OpenZoo id) |
| Store | Google Play / any Android 14+ phone with Phantom |
| Wallet | Phantom via Mobile Wallet Adapter (`cordova-plugin-mwa`) |
| Push target | this repo: `staccDOTsol/openzoo-android` |

## Product scope

Ship **chat + bind + stats only**.

Do **not** port RUN / WRITE / READ / SERVE. Those stay off this app.

A desktop GUI reference is in-repo at `www/app/gui.desktop.html` (Seeker peek,
for layout/UX only — do not treat it as the Android product spec).

## Gateway and payment

- Gateway: `https://x402-tokens.fly.dev`
- Payment path: `POST /v1/pay/build` then **`MWA.signTransaction` only**
- Never call `MWA.signAndSendTransaction` / `signAndSend` — x402 needs a
  partial-signed tx so the gateway feePayer can complete settlement

## Payment rail (do not silently fail)

Prefer, in order:

1. **yUSDCx** if the wallet can pay on that rail
2. else **wTOKENx**
3. else **wLEOSx**
4. else if the wallet only has plain **USDC** (or TOKEN / LEOS), **STEER**
   (prompt / convert) — do not drop the user with a silent failure

## What this import is

Stock Cordova + MWA template copied from `openzoo-mobile` (itself a
CordovaSeeker-style shell), plus this handoff and the GUI reference.

Shipped on this tree (do not regress):

- `config.xml` widget id `fun.openzoo.android`, name OpenZoo
- `package.json` name / displayName
- `www/index.html` wallet shell + bundled chat UI in `www/app/`
- 402 pay loop with balance probe + USDC steer (no on-device wrap)

## Template reminder (do not reinvent)

```
www/index.html          wallet shell — owns MWA, runs the app in an iframe
www/app/index.html      bundled chat + bind + stats (402 pay loop)
www/app/gui.desktop.html
                        desktop GUI reference (not loaded)
cordova-plugin-mwa/     ~300 lines of Java: authorize, signMessage,
                        signTransaction, signAndSendTransaction
config.xml              widget id fun.openzoo.android
```

`MWA.signTransaction(txB64, ok, err)` returns `{ signedTransaction }` (base64).
That is the only MWA sign API this app should use for payment.

Keep the existing split: the shell owns the wallet; the UI never sees a key.
