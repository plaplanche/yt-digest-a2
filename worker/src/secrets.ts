export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const randomToken = (bytes = 32): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

// AES-GCM with a random 12-byte IV, stored as `v1:` followed by the base64 of IV and ciphertext (spec 6.3).
export async function encryptSecret(plain: string, keyBase64: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return `v1:${toBase64(out)}`;
}
