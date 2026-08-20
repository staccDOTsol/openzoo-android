# Handoff — openzoo on Solana Seeker / Android (Cordova + MWA)

Ship openzoo as a native Android app for the Solana Seeker, where the user pays
per call from **their own wallet** via Mobile Wallet Adapter instead of a burner
key on disk.

Everything below was checked live on 2026-08-17. Facts marked VERIFIED were
executed, not assumed. Read §3 before writing any payment code — it is the part
that decides the architecture.

---

## 0. Where things stand

- Template cloned clean to `~/openzoo-mobile` (fork of `FreeSolDev/CordovaSeeker`,
  MIT, 8 commits, last upstream push 2026-07-19).
- Nothing openzoo-specific has been written yet. The tree is stock — the app
  itself is entirely ahead of you.
- **Both backend prerequisites are DONE and deployed**: CORS on the gateway,
  and `POST /v1/pay/build` which hands you an unsigned payment transaction so
  the phone never needs Solana libraries. See §3.

---

## 1. What the template gives you (VERIFIED by reading the tree)

```
www/index.html          wallet shell — owns MWA state, runs the app in an iframe
www/game/index.html     demo clicker (delete or ignore)
cordova-plugin-mwa/     ~300 lines of Java: the whole MWA client
config.xml              widget id com.example.cordovaseeker  ← rebrand
res/icon/android/*.png  6 densities  ← replace
```

`cordova-plugin-mwa/www/mwa.js` clobbers a global `MWA` with exactly four calls:

| call | returns |
|---|---|
| `MWA.authorize(ok, err)` | `{ address, authToken }` |
| `MWA.signMessage(msgB64, ok, err)` | `{ signature }` (base58) |
| **`MWA.signTransaction(txB64, ok, err)`** | `{ signedTransaction }` (base64) |
| `MWA.signAndSendTransaction(txB64, ok, err)` | `{ signature }` |

**`signTransaction` is the one that matters** — x402 needs the payer to
*partial*-sign and the gateway's feePayer to complete it. Do **not** use
`signAndSendTransaction`: it submits the tx itself, which is not the x402 flow
and will break settlement.

The shell already: connects via MWA, runs `GAME_URL` in an iframe, and bridges
`wallet-sign-message` over `postMessage` (`www/index.html:135` GAME_URL,
`:232` authorize, `:271` sign bridge). You extend that bridge with a
`wallet-sign-transaction` message; the pattern is right there to copy.

---

## 2. Target architecture

```
Cordova shell (www/index.html)          — owns MWA, never touches app logic
  └── iframe: openzoo chat UI           — hosted, or bundled
        │  postMessage: sign-transaction
        ▼
  MWA.signTransaction  →  user's wallet (Phantom / Seeker Vault)
        │
        ▼
  POST https://x402-tokens.fly.dev/v1/chat/completions  with X-PAYMENT
```

The shell owns the wallet; the chat UI never sees a key. That is the
template's existing split and it is the right one — keep it.

---

## 3. THE PAYMENT PATH — read this before coding

A 402 from the gateway looks like this (VERIFIED live):

```jsonc
{ "accepts": [ {
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "asset":   "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv",   // yUSDCx
    "maxAmountRequired": "21089",
    "payTo":   "WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb",
    "extra": { "feePayer": "WzMaL78…", "symbol": "yUSDCx", "decimals": 6,
               "billedUsd": 0.021, "facilitator": "https://x402.accrue.fund" }
  }, … ]                                    // 7 rows: 2 solana, 5 eip155
}
```

Payment is **one Token-2022 TransferChecked**, payer ATA → payTo ATA,
`feePayer` = the gateway (so the user needs **no SOL**), partial-signed by the
payer. Then retry the original request with:

```
X-PAYMENT: base64({ x402Version:1, scheme, network,
                    payload: { transaction: "<base64 signed tx>" } })
```

### The problem

The 402 gives amount, decimals, asset, payTo and feePayer — but **not** the
recent blockhash, **not** the token program id, and **not** the derived ATAs.
Building that transaction on-device means bundling `@solana/web3.js` +
`@solana/spl-token` into the Cordova webview. That is heavy, and it puts
consensus-critical construction on the least testable surface you own.

### The fix — BUILT AND DEPLOYED

The gateway now builds the transaction for you. **No Solana libraries on
device.**

```
POST https://x402-tokens.fly.dev/v1/pay/build
  { "accept": <one accepts[] row from the 402>, "payer": "<base58 pubkey>" }

→ 200 { "transaction": "<base64 UNSIGNED tx>",
        "envelope": { "x402Version":1, "scheme":"exact", "network":"solana:…",
                      "payload": { "transaction": "<replace with the signed transaction>" } } }
```

Free, no auth, CORS-enabled. It reads chain state and returns bytes; it moves
nothing, and the payer's key never goes near the server. Source:
`~/claude/x402-tokens/src/paybuild.ts`. Solana rows only — EVM rows are
EIP-3009 *signatures*, not transactions, and the endpoint 400s on them with
that explanation.

VERIFIED end to end from a real wallet, signing exactly the way
`MWA.signTransaction` does (deserialize → partialSign → re-serialize):

```
1. POST /v1/chat/completions        → 402, 7 accepts rows
2. POST /v1/pay/build               → 200, 415-byte unsigned tx
3. Transaction.from(...).partialSign → feePayer slot EMPTY, payer slot SIGNED
4. retry with X-PAYMENT             → reached facilitator simulation
```

Step 3 is the important confirmation: the transaction comes back with the
payer slot open and the feePayer slot reserved, which is precisely the shape
x402 settlement expects.

**The compute-budget nonce is already in there and is load-bearing.** The
builder prepends `ComputeBudgetProgram.setComputeUnitLimit` with a *random*
unit count. Without it, two callers quoting the same price inside one blockhash
window produce a byte-identical transaction, hence an identical signature, and
the second is rejected as a duplicate — MEASURED as 8 `failed_settle` in a
single window under 10 concurrent workers. If you ever refactor the builder,
keep it.

So the phone's job is only:

```
fetch → 402 → POST /v1/pay/build → MWA.signTransaction → retry with X-PAYMENT
```

### PICK A RAIL THE USER CAN ACTUALLY PAY (this WILL bite you)

The 402 offers 7 rows and **the first Solana row is not always payable**. In
testing, building against row 1 (`yUSDCx`) produced a structurally perfect
transaction that failed at simulation — the wallet held `wTOKENx`, not
`yUSDCx`. Nothing was wrong with the transaction; the wallet simply could not
fund that asset.

Solana rows settle in **NAV-wrapped Token-2022 twins** (`yUSDCx` wraps USDC,
`wTOKENx` wraps TOKEN). A user holding plain USDC holds *neither*. The desktop
shim solves this by wrapping on the fly (`~/openzoo-shim/lib/pay.js`
`topUpQuotedAsset`).

Mobile must decide, and this is a product call, not a detail:

1. **Read balances, pick a row the wallet can cover.** Simplest; fails if the
   user holds only unwrapped assets.
2. **Wrap on device** — port the shim's wrap path. Most capable, most work.
3. **Steer the user** to fund a supported twin, with a clear in-app explanation.

Do not ship option 1 silently: a user holding plain USDC will see an
inscrutable simulation failure and conclude the app is broken.

---

## 4. Gateway facts you can rely on (VERIFIED 2026-08-17)

- **CORS is live.** `OPTIONS /v1/chat/completions` → **204**;
  `access-control-allow-origin` echoes the caller; `x-payment` and the
  `x-openzoo-namespace*` headers are in `allow-headers`; `x-payment-response`
  is in `expose-headers` so the client can read its own receipt. A webview can
  call the gateway directly.
- Base URL: `https://x402-tokens.fly.dev`. Any `Authorization` string is
  accepted — **payment is the auth**, not a key.
- `GET /v1/stats` is public and CORS-enabled if you want in-app stats.
- Rails offered: solana/yUSDCx, solana/wTOKENx, plus five eip155 rows.
  **Pick a solana row on Seeker.**
- The Solana rows settle in a **NAV-wrapped Token-2022 twin** (`yUSDCx`), not
  plain USDC. A user holding only plain USDC cannot pay a solana row directly —
  the shim wraps first. Decide early whether mobile wraps too, or steers users
  to a rail they already hold. This is a product decision, not a detail.

---

## 5. Concrete task list

1. **Rebrand** — `config.xml` widget id (`fun.openzoo.seeker`), `<name>`,
   `res/icon/android/*` (source art: `~/claude/x402-tokens/meta/token.jpg`,
   1024×1024; the desktop app's generated icons are in
   `~/openzoo-shim/grokui-app/build/`).
2. **Point the shell at openzoo** — set `GAME_URL` to the hosted chat UI, or
   bundle a trimmed build under `www/app/`.
3. **Extend the postMessage bridge** with `wallet-sign-transaction` →
   `MWA.signTransaction` → `wallet-sign-transaction-response`. Copy the
   existing `wallet-sign-message` handler (`www/index.html:271`).
4. ~~Build `/v1/pay/build`~~ — **DONE and deployed** (§3). If you change the
   gateway for any other reason: ⚠️ `npm run build` BEFORE `flyctl deploy` —
   the Dockerfile ships a prebuilt `dist/` and will otherwise silently deploy
   the previous JS.
5. **Wire the 402 loop** in the chat UI: 402 → pick a payable rail (§3) →
   `/v1/pay/build` → bridge → `MWA.signTransaction` → retry with `X-PAYMENT`.
6. **Test on a real device.** MWA cannot work in a browser or an emulator
   without a wallet app; you need Seeker hardware or an Android device with
   Phantom installed.

---

## 6. Scope limits — do not silently widen

- **Android only.** `cordova-plugin-mwa` is Java; MWA does not exist on iOS.
  An iOS build is a separate project with a different wallet story (deeplinks,
  or an in-app burner) and its own App Store risk around crypto payments.
- **Chat + bind + stats only.** The desktop app's RUN / WRITE / READ / SERVE
  directives need a shell and filesystem. Neither exists on a phone. Do not
  port them; do not leave the system prompt claiming they work, or the model
  will emit commands that silently do nothing (that exact failure cost a full
  debugging session on desktop).
- The upstream template is a **games** template with 1 star and no affiliation
  with Solana Mobile. You are the maintainer of anything that breaks in it.

---

## 7. Landmines (each cost real time already)

- **`npm run build` before `flyctl deploy`** — see §5.4.
- **Do not use `signAndSendTransaction`** for x402 — see §1.
- **Keep the compute-budget nonce** — see §3.
- **Never claim a capability the runtime lacks.** A model told it has tools it
  cannot reach will fabricate output rather than report failure.
- The gateway runs **one** Fly machine deliberately (the credit ledger is
  machine-local). Do not scale it out to "fix" latency.
