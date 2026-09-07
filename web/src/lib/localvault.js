// 本地保险库：数据只存浏览器 localStorage，永不经过网络。
// 可选口令加密：PBKDF2(200k, SHA-256) 派生密钥 + AES-256-GCM 整库加密。
const STORAGE_KEY = '2fahub.local.vault.v1';
const PBKDF2_ITER = 200_000;

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

const b64 = {
  // 分块转换：spread 展开大 buffer 会栈溢出（本地库可以长到几百 KB）
  enc(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },
  dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

/**
 * 读取本地保险库。
 * @returns {Promise<{entries: Array, encrypted: boolean}>}
 * @throws encrypted 库且口令错误/未提供时抛错
 */
export async function loadLocalVault(passphrase = null) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { entries: [], encrypted: false };
  const box = JSON.parse(raw);
  if (!box.enc) return { entries: box.entries || [], encrypted: false };
  if (!passphrase) throw new Error('locked');
  try {
    const key = await deriveKey(passphrase, b64.dec(box.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64.dec(box.iv) }, key, b64.dec(box.data),
    );
    return { entries: JSON.parse(new TextDecoder().decode(plain)), encrypted: true };
  } catch {
    throw new Error('wrong passphrase');
  }
}

/** 保存本地保险库；passphrase 为空则明文存放（提示用户风险） */
export async function saveLocalVault(entries, passphrase = null) {
  let box;
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(entries)),
    );
    box = { enc: true, salt: b64.enc(salt), iv: b64.enc(iv), data: b64.enc(data) };
  } else {
    box = { enc: false, entries };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(box));
}

export function localVaultIsEncrypted() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try { return !!JSON.parse(raw).enc; } catch { return false; }
}

export function wipeLocalVault() {
  localStorage.removeItem(STORAGE_KEY);
}
