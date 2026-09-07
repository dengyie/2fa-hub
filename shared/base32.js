// RFC 4648 Base32 (A-Z, 2-7)，容错处理常见变体（0->O, 1->8? 不做映射，仅去空白与大写化）
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 规范化用户输入的 secret：去空白、大写、补齐 padding，非法字符抛错 */
export function normalizeBase32(input) {
  const clean = String(input || '').replace(/[\s-]/g, '').toUpperCase();
  if (!clean.length) throw new Error('empty secret');
  if (!/^[A-Z2-7]+=*$/.test(clean)) throw new Error('invalid base32 characters');
  return clean.replace(/=+$/, '');
}

export function base32Decode(input) {
  const clean = normalizeBase32(input);
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out.push(ALPHABET[(value >>> (bits - 5)) & 31]);
      bits -= 5;
    }
  }
  if (bits > 0) out.push(ALPHABET[(value << (5 - bits)) & 31]);
  return out.join('');
}
