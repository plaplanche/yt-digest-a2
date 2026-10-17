const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const base64url = (bytes: Uint8Array): string => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const fromBase64url = (text: string): Uint8Array<ArrayBuffer> => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/"));

// A random URL-safe string of 256 bits.
export const randomToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

// AES-GCM with a random IV per value, stored as `v1:` and the base64 of IV and ciphertext (spec 6.3).
export async function encrypt(plaintext: string, base64Key: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromBase64(base64Key), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return `v1:${toBase64(new Uint8Array([...iv, ...data]))}`;
}
