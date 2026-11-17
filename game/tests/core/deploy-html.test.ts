import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { patchIndexHtml } from '../../scripts/lib/deploy-html';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, '..', 'fixtures', 'cocos-web-desktop-index.html'), 'utf8');
const META = {
  title: 'Yokai Field — "test" & <x>',
  description: 'Mô tả',
  origin: 'https://yokai.lukeinc.tech',
  ogImagePath: '/og.png',
};

describe('patchIndexHtml (template web-desktop của Cocos 3.8.8)', () => {
  const html = patchIndexHtml(TEMPLATE, META);

  it('thay tiêu đề mặc định, escape HTML', () => {
    expect(html).not.toContain('Cocos Creator | yokai-field');
    expect(html).toContain('<title>Yokai Field — &quot;test&quot; &amp; &lt;x&gt;</title>');
  });

  it('có OG với URL ảnh tuyệt đối và canonical', () => {
    expect(html).toContain('<meta property="og:image" content="https://yokai.lukeinc.tech/og.png"/>');
    expect(html).toContain('<link rel="canonical" href="https://yokai.lukeinc.tech/"/>');
  });

  it('bỏ header/footer và favicon.ico của template', () => {
    expect(html).not.toContain('class="header"');
    expect(html).not.toContain('class="footer"');
    expect(html).not.toContain('favicon.ico');
    expect(html).toContain('href="favicon.png"');
  });

  it('giữ nguyên canvas và script nạp engine', () => {
    expect(html).toContain('<canvas id="GameCanvas"');
    expect(html).toContain("System.import('./index.js')");
  });

  it('template lạ thì báo lỗi thay vì ship trang nửa vời', () => {
    expect(() => patchIndexHtml('<html><body></body></html>', META)).toThrow(/<title>/);
  });
});
