import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const localKey = globalThis[Symbol.for('watchlist.localKey')] ??= randomBytes(32);

export function sessionKey(secret, required) {
  if (!secret && !required) return localKey;
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '')) throw new Error('Configure SESSION_SECRET as 64 hexadecimal characters.');
  return Buffer.from(secret, 'hex');
}

export function cookies(request, key, secure) {
  const attributes = '; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
  const incoming = new Map((request.headers.get('cookie') ?? '').split(/;\s*/).map(cookie => cookie.split('=')));
  return {
    read(name) {
      try {
        const packed = Buffer.from(incoming.get(name) ?? '', 'base64url');
        if (packed.length < 29) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
        decipher.setAAD(Buffer.from(name));
        decipher.setAuthTag(packed.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
        return value.expires > Date.now() ? value : null;
      } catch { return null; }
    },
    set(name, value, seconds) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(name));
      const data = cipher.update(JSON.stringify({ ...value, expires: Date.now() + seconds * 1000 }));
      const sealed = Buffer.concat([iv, finishTag(cipher, data)]);
      return name + '=' + sealed.toString('base64url') + attributes + '; Max-Age=' + seconds;
    },
    clear(name) { return name + '=' + attributes + '; Max-Age=0'; },
  };
}

function finishTag(cipher, data) {
  const end = cipher.final();
  return Buffer.concat([cipher.getAuthTag(), data, end]);
}

