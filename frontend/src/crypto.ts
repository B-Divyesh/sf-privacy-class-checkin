const encoder = new TextEncoder();

export async function encryptExport(csv: string, passphrase: string): Promise<Blob> {
  if (passphrase.length < 8) throw new Error('Use a passphrase with at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(csv)));
  const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  return new Blob([JSON.stringify({ format: 'privacy-class-checkin/aes-gcm-v1', kdf: 'PBKDF2-SHA256', iterations: 210000, salt: base64(salt), iv: base64(iv), data: base64(ciphertext) }, null, 2)], { type: 'application/json' });
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export async function decryptExport(contents: string, passphrase: string): Promise<string> {
  if (passphrase.length < 8) throw new Error('Enter the passphrase used when the file was exported.');
  let envelope: {format:string;iterations:number;salt:string;iv:string;data:string};
  try { envelope=JSON.parse(contents); } catch { throw new Error('This is not a Privacy Class Check-in encrypted file.'); }
  if(envelope.format!=='privacy-class-checkin/aes-gcm-v1') throw new Error('This encrypted file format is not supported.');
  const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:fromBase64(envelope.salt),iterations:envelope.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv)},key,fromBase64(envelope.data))); }
  catch { throw new Error('The passphrase is incorrect, or the encrypted file has been changed.'); }
}

export async function verifySignedCsv(csv:string):Promise<boolean> {
  const signature=csv.match(/^# signature=ed25519:(.+)$/m)?.[1]?.trim();
  const publicKey=csv.match(/^# public_key=ed25519:(.+)$/m)?.[1]?.trim();
  const start=csv.indexOf('pseudonym,status,recorded_at_utc,source\r\n');
  if(!signature||!publicKey||start<0)return false;
  try { const key=await crypto.subtle.importKey('raw',fromBase64(publicKey),{name:'Ed25519'},false,['verify']);return crypto.subtle.verify({name:'Ed25519'},key,fromBase64(signature),encoder.encode(csv.slice(start))); } catch { return false; }
}

export function download(blob: Blob, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob); anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
