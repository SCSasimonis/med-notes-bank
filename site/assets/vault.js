/* Med Notes Bank — client-side content vault.
   All study content is stored encrypted (AES-256-GCM, gzip inside). A key is derived from the
   password with PBKDF2-SHA-256; if the user chooses, the derived key (never the password) is kept
   on this device as a non-extractable CryptoKey in IndexedDB. */
"use strict";
window.Vault = (() => {
  const DBN = "mnb-vault", STORE = "keys", ID = "content-key", CHECK = "med-notes-bank";
  const te = new TextEncoder(), td = new TextDecoder();
  let key = null, meta = null;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const supported = () => !!(window.isSecureContext && crypto && crypto.subtle && "DecompressionStream" in window && "indexedDB" in window);

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(mode, fn) {
    try {
      const db = await idb();
      return await new Promise(res => {
        const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
        req.onsuccess = () => res(req.result ?? null);
        req.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }

  async function getMeta() {
    if (!meta) {
      const r = await fetch("content/meta.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("Could not load content (" + r.status + ")");
      meta = await r.json();
    }
    return meta;
  }
  async function derive(pw) {
    const m = await getMeta();
    const base = await crypto.subtle.importKey("raw", te.encode(pw.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(m.salt), iterations: m.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function open(k, buf, aad) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12), additionalData: te.encode(aad) }, k, u.slice(12));
  }
  async function gunzip(buf) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(s).arrayBuffer();
  }
  async function valid(k) {
    const m = await getMeta();
    try { return td.decode(await open(k, b64(m.check), "check")) === CHECK; } catch (e) { return false; }
  }

  async function tryStored() {
    if (!supported()) return false;
    const k = await idbDo("readonly", s => s.get(ID));
    if (k && await valid(k)) { key = k; return true; }
    return false;
  }
  async function unlock(pw, remember) {
    const k = await derive(pw);
    if (!(await valid(k))) return false;
    key = k;
    if (remember) await idbDo("readwrite", s => s.put(k, ID));
    return true;
  }
  async function lock() { key = null; await idbDo("readwrite", s => s.delete(ID)); }

  async function bytes(path) {
    if (!key) throw new Error("Locked");
    const r = await fetch(path);
    if (!r.ok) throw new Error("Could not load " + path + " (" + r.status + ")");
    const pt = await open(key, await r.arrayBuffer(), path.split("/").pop());
    return gunzip(pt);
  }
  const json = async path => JSON.parse(td.decode(await bytes(path)));

  return { supported, tryStored, unlock, lock, bytes, json };
})();
