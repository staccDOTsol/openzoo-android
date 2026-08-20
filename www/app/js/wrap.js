/**
 * wrap-nav top-up. Builds the NINE-account Wrap instruction (program pulls
 * the deposit). Desktop reference: staccDOTsol/openzoo lib/wrap.js.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooWrap = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var S = (typeof module === "object" && module.exports)
    ? require("./solana-lite.js")
    : root.OpenZooSolana;
  var R = (typeof module === "object" && module.exports)
    ? require("./rails.js")
    : root.OpenZooRails;

  var MINIMUM_LIQUIDITY = 1000n;
  var AUTHORITY_SEED = "mint_authority";

  function depositForShares(sharesNeeded, reserves, supply) {
    sharesNeeded = BigInt(sharesNeeded);
    reserves = BigInt(reserves);
    supply = BigInt(supply);
    if (supply === 0n || reserves === 0n) return sharesNeeded + MINIMUM_LIQUIDITY;
    var exact = (sharesNeeded * reserves + supply - 1n) / supply;
    return exact + exact / 200n + 2n;
  }

  function poolFromAcquire(wrappedMint, acquire, wrappedProgram) {
    if (!acquire || acquire.method !== "spl-token-wrap") return null;
    if (!acquire.underlying || !acquire.underlying.address || !acquire.escrow) return null;
    var programId = acquire.program || R.WRAP_PROGRAM || S.WRAP_PROGRAM;
    var authority = acquire.mintAuthority;
    var bump = acquire.authorityBump;
    if (bump == null && authority) {
      var derived = S.findProgramAddress([AUTHORITY_SEED, wrappedMint], programId);
      if (derived.address === authority) bump = derived.bump;
    }
    if (bump == null) {
      var fallback = S.findProgramAddress([AUTHORITY_SEED, wrappedMint], programId);
      authority = authority || fallback.address;
      bump = fallback.bump;
    }
    return {
      wrapped: wrappedMint,
      wrappedProgram: wrappedProgram || S.TOKEN_2022_PROGRAM,
      programId: programId,
      authority: authority,
      bump: Number(bump),
      escrow: acquire.escrow,
      underlying: acquire.underlying.address,
      underlyingProgram: acquire.underlying.tokenProgram || S.TOKEN_PROGRAM,
      underlyingDecimals: acquire.underlying.decimals == null ? 6 : acquire.underlying.decimals,
    };
  }

  function resolvePool(wrappedMint, kinds, wrappedProgram) {
    var kind = R.findKindByMint(kinds, wrappedMint);
    var acq = kind && kind.extra && kind.extra.acquire;
    return poolFromAcquire(wrappedMint, acq, wrappedProgram);
  }

  function buildWrapInstructions(pool, owner, depositRaw, rentPayer) {
    rentPayer = rentPayer || owner;
    var userWrapped = S.getAssociatedTokenAddress(pool.wrapped, owner, pool.wrappedProgram);
    var userUnderlying = S.getAssociatedTokenAddress(pool.underlying, owner, pool.underlyingProgram);
    return {
      userWrapped: userWrapped,
      userUnderlying: userUnderlying,
      ixs: [
        S.createAtaIdempotentIx(rentPayer, userWrapped, owner, pool.wrapped, pool.wrappedProgram),
        S.wrapIx(pool, owner, userWrapped, userUnderlying, depositRaw),
      ],
    };
  }

  function buildWrapTx(pool, owner, depositRaw, blockhash, rentPayer) {
    var built = buildWrapInstructions(pool, owner, depositRaw, rentPayer);
    var compiled = S.compileLegacyTx(rentPayer || owner, blockhash, built.ixs);
    return {
      userWrapped: built.userWrapped,
      userUnderlying: built.userUnderlying,
      ixs: built.ixs,
      compiled: compiled,
      base64: compiled.base64,
    };
  }

  function wrapAccountCount(ix) {
    return ix && ix.keys ? ix.keys.length : 0;
  }

  function wrapIxData(depositRaw, bump) {
    return S.wrapIx({
      escrow: S.SYSTEM_PROGRAM,
      wrapped: S.SYSTEM_PROGRAM,
      authority: S.SYSTEM_PROGRAM,
      wrappedProgram: S.TOKEN_2022_PROGRAM,
      underlying: S.SYSTEM_PROGRAM,
      underlyingProgram: S.TOKEN_PROGRAM,
      programId: S.WRAP_PROGRAM,
      bump: bump,
    }, S.SYSTEM_PROGRAM, S.SYSTEM_PROGRAM, S.SYSTEM_PROGRAM, depositRaw).data;
  }

  return {
    MINIMUM_LIQUIDITY: MINIMUM_LIQUIDITY,
    depositForShares: depositForShares,
    poolFromAcquire: poolFromAcquire,
    resolvePool: resolvePool,
    buildWrapInstructions: buildWrapInstructions,
    buildWrapTx: buildWrapTx,
    wrapAccountCount: wrapAccountCount,
    wrapIxData: wrapIxData,
  };
});
