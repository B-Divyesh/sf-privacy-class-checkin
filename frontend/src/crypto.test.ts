import { describe, expect, it } from 'vitest';
import { decryptExport, encryptExport } from './crypto.ts';
describe('encrypted attendance exports',()=>{
  it('round trips locally and rejects the wrong passphrase',async()=>{
    const blob=await encryptExport('pseudonym,status\r\nFern 01,present\r\n','a long field key');
    const contents=await blob.text();
    await expect(decryptExport(contents,'a long field key')).resolves.toContain('Fern 01');
    await expect(decryptExport(contents,'another field key')).rejects.toThrow('incorrect');
  });
});
