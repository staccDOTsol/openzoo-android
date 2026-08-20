/**
 * Minimal Solana helpers for wrap-nav txs. No @solana/web3.js.
 * Used to derive ATAs and serialize an unsigned legacy transaction.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooSolana = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var SYSTEM_PROGRAM = "11111111111111111111111111111111";
  var TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  var TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  var ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  var WRAP_PROGRAM = "FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE";

  function concatBytes(parts) {
    var n = 0;
    for (var i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    var o = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], o);
      o += parts[j].length;
    }
    return out;
  }

  function encodeBase58(bytes) {
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var size = Math.ceil(bytes.length * 138 / 100) + 1;
    var b = new Uint8Array(size);
    var length = 0;
    for (var i = zeros; i < bytes.length; i++) {
      var carry = bytes[i];
      var j = 0;
      for (var k = size - 1; (carry !== 0 || j < length) && k !== -1; k--, j++) {
        carry += 256 * b[k];
        b[k] = carry % 58;
        carry = (carry / 58) | 0;
      }
      length = j;
    }
    var it = size - length;
    while (it < size && b[it] === 0) it++;
    var s = "";
    for (var z = 0; z < zeros; z++) s += "1";
    for (; it < size; it++) s += B58[b[it]];
    return s;
  }

  function decodeBase58(str) {
    if (!str) throw new Error("empty base58");
    var zeros = 0;
    while (zeros < str.length && str[zeros] === "1") zeros++;
    var size = Math.ceil(str.length * 733 / 1000) + 1;
    var b = new Uint8Array(size);
    var length = 0;
    for (var i = zeros; i < str.length; i++) {
      var carry = B58.indexOf(str[i]);
      if (carry < 0) throw new Error("bad base58");
      var j = 0;
      for (var k = size - 1; (carry !== 0 || j < length) && k !== -1; k--, j++) {
        carry += 58 * b[k];
        b[k] = carry % 256;
        carry = (carry / 256) | 0;
      }
      length = j;
    }
    var it = size - length;
    while (it < size && b[it] === 0) it++;
    var out = new Uint8Array(zeros + (size - it));
    var o = zeros;
    for (; it < size; it++) out[o++] = b[it];
    return out;
  }

  function pubkeyBytes(addr) {
    if (addr instanceof Uint8Array) {
      if (addr.length !== 32) throw new Error("pubkey must be 32 bytes");
      return addr;
    }
    var b = decodeBase58(String(addr));
    if (b.length !== 32) throw new Error("pubkey decode length " + b.length);
    return b;
  }

  function pubkeyStr(addr) {
    if (typeof addr === "string") return addr;
    return encodeBase58(pubkeyBytes(addr));
  }

  function sha256Sync(bytes) {
    if (typeof require === "function") {
      try {
        var crypto = require("crypto");
        return new Uint8Array(crypto.createHash("sha256").update(Buffer.from(bytes)).digest());
      } catch (e) { /* fall through to pure js */ }
    }
    return sha256Js(bytes);
  }

  // Compact SHA-256 (public-domain style). Used when Node crypto is unavailable.
  function sha256Js(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bitLen = msg.length * 8;
    var withPad = msg.length + 1 + 8;
    var pad = (64 - (withPad % 64)) % 64;
    var buf = new Uint8Array(withPad + pad);
    buf.set(msg);
    buf[msg.length] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 4, bitLen, false);
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);
    for (var off = 0; off < buf.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (var t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (var u = 0; u < 64; u++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + K[u] + w[u]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    var out = new Uint8Array(32);
    var view = new DataView(out.buffer);
    view.setUint32(0, h0, false); view.setUint32(4, h1, false);
    view.setUint32(8, h2, false); view.setUint32(12, h3, false);
    view.setUint32(16, h4, false); view.setUint32(20, h5, false);
    view.setUint32(24, h6, false); view.setUint32(28, h7, false);
    return out;
  }

  var ED25519_P = (1n << 255n) - 19n;
  var ED25519_D = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n;
  // 2^((p-1)/4) mod p — sqrt(-1) on this field.
  var ED25519_I = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0n;

  function modPow(a, e, m) {
    var r = 1n;
    a %= m;
    while (e > 0n) {
      if (e & 1n) r = (r * a) % m;
      a = (a * a) % m;
      e >>= 1n;
    }
    return r;
  }

  function isOnCurve(bytes) {
    if (!bytes || bytes.length !== 32) return false;
    var y = 0n;
    for (var i = 0; i < 32; i++) y |= BigInt(bytes[i]) << (8n * BigInt(i));
    var sign = y >> 255n;
    y &= (1n << 255n) - 1n;
    if (y >= ED25519_P) return false;
    var y2 = (y * y) % ED25519_P;
    var u = (y2 - 1n + ED25519_P) % ED25519_P;
    var v = (ED25519_D * y2 + 1n) % ED25519_P;
    var x2 = (u * modPow(v, ED25519_P - 2n, ED25519_P)) % ED25519_P;
    if (x2 === 0n) return sign === 0n;
    var x = modPow(x2, (ED25519_P + 3n) / 8n, ED25519_P);
    if ((x * x) % ED25519_P !== x2) x = (x * ED25519_I) % ED25519_P;
    return (x * x) % ED25519_P === x2;
  }

  var PDA_MARKER = (function () {
    var s = "ProgramDerivedAddress";
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  })();

  function textBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  function findProgramAddress(seeds, programId) {
    var prog = pubkeyBytes(programId);
    for (var bump = 255; bump >= 0; bump--) {
      var parts = [];
      for (var i = 0; i < seeds.length; i++) {
        var seed = seeds[i];
        if (seed instanceof Uint8Array) {
          parts.push(seed);
        } else if (typeof seed === "string") {
          // 32-byte base58 pubkeys vs ASCII seeds like "mint_authority".
          try {
            var decoded = decodeBase58(seed);
            parts.push(decoded.length === 32 ? decoded : textBytes(seed));
          } catch (e) {
            parts.push(textBytes(seed));
          }
        } else {
          parts.push(pubkeyBytes(seed));
        }
      }
      parts.push(new Uint8Array([bump]));
      parts.push(prog);
      parts.push(PDA_MARKER);
      var hash = sha256Sync(concatBytes(parts));
      if (!isOnCurve(hash)) return { address: encodeBase58(hash), bump: bump, bytes: hash };
    }
    throw new Error("unable to find program address");
  }

  function getAssociatedTokenAddress(mint, owner, tokenProgram) {
    return findProgramAddress(
      [pubkeyBytes(owner), pubkeyBytes(tokenProgram || TOKEN_PROGRAM), pubkeyBytes(mint)],
      ASSOCIATED_TOKEN_PROGRAM
    ).address;
  }

  function compactU16(n) {
    var out = [];
    var rem = n >>> 0;
    for (;;) {
      var byte = rem & 0x7f;
      rem >>>= 7;
      if (rem !== 0) byte |= 0x80;
      out.push(byte);
      if (rem === 0) break;
    }
    return new Uint8Array(out);
  }

  function u64le(n) {
    var v = BigInt(n);
    var b = new Uint8Array(8);
    for (var i = 0; i < 8; i++) {
      b[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return b;
  }

  function decodeBlockhash(blockhash) {
    return pubkeyBytes(blockhash);
  }

  /**
   * Compile a legacy unsigned transaction.
   * ixs: [{ programId, keys:[{pubkey, isSigner, isWritable}], data: Uint8Array }]
   */
  function compileLegacyTx(feePayer, blockhash, ixs) {
    var fee = pubkeyStr(feePayer);
    var metas = [];
    function addMeta(pubkey, isSigner, isWritable) {
      var id = pubkeyStr(pubkey);
      for (var i = 0; i < metas.length; i++) {
        if (metas[i].id === id) {
          metas[i].isSigner = metas[i].isSigner || isSigner;
          metas[i].isWritable = metas[i].isWritable || isWritable;
          return;
        }
      }
      metas.push({ id: id, isSigner: !!isSigner, isWritable: !!isWritable });
    }
    addMeta(fee, true, true);
    for (var i = 0; i < ixs.length; i++) {
      var ix = ixs[i];
      for (var k = 0; k < ix.keys.length; k++) {
        addMeta(ix.keys[k].pubkey, ix.keys[k].isSigner, ix.keys[k].isWritable);
      }
      addMeta(ix.programId, false, false);
    }
    var signedW = [];
    var signedR = [];
    var unsignedW = [];
    var unsignedR = [];
    for (var m = 0; m < metas.length; m++) {
      var meta = metas[m];
      if (meta.isSigner && meta.isWritable) signedW.push(meta);
      else if (meta.isSigner) signedR.push(meta);
      else if (meta.isWritable) unsignedW.push(meta);
      else unsignedR.push(meta);
    }
    var accounts = signedW.concat(signedR, unsignedW, unsignedR);
    var indexOf = {};
    for (var a = 0; a < accounts.length; a++) indexOf[accounts[a].id] = a;

    var header = new Uint8Array([
      signedW.length + signedR.length,
      signedR.length,
      unsignedR.length,
    ]);
    var accountBytes = [];
    for (var b = 0; b < accounts.length; b++) {
      accountBytes.push(pubkeyBytes(accounts[b].id));
    }
    var compiledIxs = [];
    for (var x = 0; x < ixs.length; x++) {
      var item = ixs[x];
      var accIdx = [];
      for (var y = 0; y < item.keys.length; y++) accIdx.push(indexOf[pubkeyStr(item.keys[y].pubkey)]);
      compiledIxs.push({
        programIdIndex: indexOf[pubkeyStr(item.programId)],
        accounts: accIdx,
        data: item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data),
      });
    }

    var messageParts = [header, compactU16(accounts.length)].concat(accountBytes);
    messageParts.push(decodeBlockhash(blockhash));
    messageParts.push(compactU16(compiledIxs.length));
    for (var c = 0; c < compiledIxs.length; c++) {
      var ci = compiledIxs[c];
      messageParts.push(new Uint8Array([ci.programIdIndex]));
      messageParts.push(compactU16(ci.accounts.length));
      messageParts.push(new Uint8Array(ci.accounts));
      messageParts.push(compactU16(ci.data.length));
      messageParts.push(ci.data);
    }
    var message = concatBytes(messageParts);
    var sigCount = signedW.length + signedR.length;
    var sigs = new Uint8Array(1 + sigCount * 64);
    sigs[0] = sigCount;
    var serialized = concatBytes([sigs, message]);
    return {
      accounts: accounts.map(function (acc) { return acc.id; }),
      numRequiredSignatures: sigCount,
      message: message,
      serialized: serialized,
      base64: bytesToB64(serialized),
    };
  }

  function bytesToB64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function createAtaIdempotentIx(payer, ata, owner, mint, tokenProgram) {
    return {
      programId: ASSOCIATED_TOKEN_PROGRAM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: new Uint8Array([1]),
    };
  }

  function wrapIx(pool, owner, userWrapped, userUnderlying, depositRaw) {
    var data = concatBytes([
      new Uint8Array([1]),
      u64le(depositRaw),
      new Uint8Array([pool.bump]),
    ]);
    return {
      programId: pool.programId || WRAP_PROGRAM,
      keys: [
        { pubkey: pool.escrow, isSigner: false, isWritable: true },
        { pubkey: pool.wrapped, isSigner: false, isWritable: true },
        { pubkey: userWrapped, isSigner: false, isWritable: true },
        { pubkey: pool.authority, isSigner: false, isWritable: false },
        { pubkey: pool.wrappedProgram, isSigner: false, isWritable: false },
        { pubkey: userUnderlying, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: pool.underlying, isSigner: false, isWritable: false },
        { pubkey: pool.underlyingProgram, isSigner: false, isWritable: false },
      ],
      data: data,
    };
  }

  return {
    SYSTEM_PROGRAM: SYSTEM_PROGRAM,
    TOKEN_PROGRAM: TOKEN_PROGRAM,
    TOKEN_2022_PROGRAM: TOKEN_2022_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM: ASSOCIATED_TOKEN_PROGRAM,
    WRAP_PROGRAM: WRAP_PROGRAM,
    encodeBase58: encodeBase58,
    decodeBase58: decodeBase58,
    pubkeyBytes: pubkeyBytes,
    pubkeyStr: pubkeyStr,
    sha256Sync: sha256Sync,
    isOnCurve: isOnCurve,
    findProgramAddress: findProgramAddress,
    getAssociatedTokenAddress: getAssociatedTokenAddress,
    compactU16: compactU16,
    u64le: u64le,
    compileLegacyTx: compileLegacyTx,
    createAtaIdempotentIx: createAtaIdempotentIx,
    wrapIx: wrapIx,
    bytesToB64: bytesToB64,
    textBytes: textBytes,
  };
});
