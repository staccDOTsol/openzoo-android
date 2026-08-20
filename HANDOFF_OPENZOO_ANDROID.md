# Handoff — OpenZoo Android (Play Store / Phantom MWA)

This tree is the **generic Play Store / any Android 14+ + Phantom** app.

It is **not** the Seeker dApp store (`fun.openzoo.seeker`) and **not** PSG1
(`fun.openzoo.psg1`). Those are separate products. Do not mix their widget
ids, branding, or feature sets into this repo.

The product is **grokui on a phone**: threads, chat, wallet, attach → abstract
bind. Keep the Cordova + MWA shell (FreeSolDev/CordovaSeeker lineage). Do
**not** rewrite to Capacitor, SwiftUI, or iOS deeplinks. Do **not** push to
FreeSolDev — this product lives on `staccDOTsol/openzoo-android` only.

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

Ship the grokui client on this Cordova shell: **threads / chat / wallet /
attach**. Bind is abstract — never show context ids, `/v1/bind`, bind hashes,
or wrap-twin homework.

Do **not** port RUN / WRITE / READ / SERVE. Those stay off this app.

A desktop GUI reference is in-repo at `www/app/gui.desktop.html` (layout/UX
only). The shipped UI is `www/app/index.html`.

## Gateway and payment

- Gateway: `https://x402-tokens.fly.dev`
- Rails: live `GET https://x402.accrue.fund/supported`
- 402 pay: `POST /v1/pay/build` then **`MWA.signTransaction` only**
- Wrap / top-up: wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE`,
  **`MWA.signAndSendTransaction` allowed**
- Mint `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is **wTOKENx2**
  (not wTOKENx). Hide drained `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9`.
- Never call `:8402`.

## What this tree is

```
www/index.html          wallet shell — owns MWA, runs the app in an iframe
www/app/index.html      grokui threads + composer + attach
www/app/js/rails.js     live /supported, wTOKENx2, hide drained mint
www/app/js/wrap.js      nine-account wrap-nav builder (bump 254 for wTOKENx2)
www/app/js/bind.js      abstract attach → corpus
www/app/js/pay.js       402 sign-only; wrap signAndSend
www/app/js/solana-lite.js
                        ATA / PDA / legacy tx (no @solana/web3.js)
cordova-plugin-mwa/     Java: authorize, signMessage, signTransaction,
                        signAndSendTransaction
config.xml              widget id fun.openzoo.android
```

`MWA.signTransaction(txB64, ok, err)` returns `{ signedTransaction }` (base64)
and is the only MWA sign API for 402 payment.

`MWA.signAndSendTransaction` is wrap / top-up only.

Keep the existing split: the shell owns the wallet; the UI never sees a key.
