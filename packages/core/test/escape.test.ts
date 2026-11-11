import { describe, expect, it } from 'vitest';
import { escapeXml } from '../src/index.ts';

describe('escapeXml', () => {
  it('escapes all five, & first', () => expect(escapeXml(`a & <b> "c" 'd' &amp;`)).toBe('a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39; &amp;amp;'));
});
