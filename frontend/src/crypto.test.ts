import { describe, expect, it } from 'vitest';
import { decryptExport, encryptExport } from './crypto.ts';
describe('encrypted attendance exports',()=>{
  it('@claim:encrypted-export round trips locally and rejects the wrong passphrase',async()=>{
    const blob=await encryptExport('pseudonym,status\r\nFern 01,present\r\n','a long field key');
    const contents=await blob.text();
    const envelope=JSON.parse(contents);
    expect(envelope).toMatchObject({format:'privacy-class-checkin/aes-gcm-v1',kdf:'PBKDF2-SHA256',iterations:210000});
    expect(atob(envelope.iv)).toHaveLength(12);
    expect(atob(envelope.salt)).toHaveLength(16);
    await expect(decryptExport(contents,'a long field key')).resolves.toContain('Fern 01');
    await expect(decryptExport(contents,'another field key')).rejects.toThrow('incorrect');
  });
});
