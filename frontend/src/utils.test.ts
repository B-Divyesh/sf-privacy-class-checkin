import { describe, expect, it } from 'vitest';
import { escapeHtml, relative } from './utils.ts';
describe('display helpers',()=>{
  it('escapes roster labels before inserting them',()=>expect(escapeHtml('<img onerror=x>')).toBe('&lt;img onerror=x&gt;'));
  it('formats ended sessions',()=>expect(relative(0)).toBe('Ended'));
});
