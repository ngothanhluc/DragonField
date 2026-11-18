import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { patchIndexHtml } from '../../scripts/lib/deploy-html';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, '..', 'fixtures', 'cocos-web-desktop-index.html'), 'utf8');
const META = {
  title: 'Yokai Field — "test" & <x>',
  description: 'Description',
  origin: 'https://yokai.lukeinc.tech',
  ogImagePath: '/og.png',
};

describe('patchIndexHtml (Cocos 3.8.8 web-desktop template)', () => {
  const html = patchIndexHtml(TEMPLATE, META);

  it('replaces the default title, escaping HTML', () => {
    expect(html).not.toContain('Cocos Creator | yokai-field');
    expect(html).toContain('<title>Yokai Field — &quot;test&quot; &amp; &lt;x&gt;</title>');
  });

  it('has OG with an absolute image URL and a canonical link', () => {
    expect(html).toContain('<meta property="og:image" content="https://yokai.lukeinc.tech/og.png"/>');
    expect(html).toContain('<link rel="canonical" href="https://yokai.lukeinc.tech/"/>');
  });

  it('drops the template header/footer and favicon.ico', () => {
    expect(html).not.toContain('class="header"');
    expect(html).not.toContain('class="footer"');
    expect(html).not.toContain('favicon.ico');
    expect(html).toContain('href="favicon.png"');
  });

  it('keeps the canvas and the engine loader script', () => {
    expect(html).toContain('<canvas id="GameCanvas"');
    expect(html).toContain("System.import('./index.js')");
  });

  it('an unexpected template errors instead of shipping a half-baked page', () => {
    expect(() => patchIndexHtml('<html><body></body></html>', META)).toThrow(/<title>/);
  });
});
