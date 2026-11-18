/**
 * Patch the `index.html` Cocos emits for web-desktop into a shippable page (M7):
 * real title/meta/OG, icon, dark background (no white flash on load), drop the header/footer
 * and the template's 1280×960 frame + 5px border. Pure string work so vitest can test it.
 */
export interface SiteMeta {
  readonly title: string;
  readonly description: string;
  /** Origin URL with `https://`, no trailing `/`. */
  readonly origin: string;
  /** OG image path from the root, e.g. `/og.png`. */
  readonly ogImagePath: string;
}

const BACKDROP = '#0e0c14';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) {
    throw new Error(`index.html has no ${what} — did the Cocos template change? Edit scripts/lib/deploy-html.ts.`);
  }
  return html.replace(pattern, replacement);
}

export function patchIndexHtml(html: string, meta: SiteMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = `${meta.origin}${meta.ogImagePath}`;

  const head = [
    `<title>${title}</title>`,
    `    <meta name="description" content="${description}"/>`,
    `    <meta name="theme-color" content="${BACKDROP}"/>`,
    `    <link rel="canonical" href="${meta.origin}/"/>`,
    `    <meta property="og:type" content="website"/>`,
    `    <meta property="og:title" content="${title}"/>`,
    `    <meta property="og:description" content="${description}"/>`,
    `    <meta property="og:url" content="${meta.origin}/"/>`,
    `    <meta property="og:image" content="${image}"/>`,
    `    <meta name="twitter:card" content="summary_large_image"/>`,
    `    <style>html,body{background:${BACKDROP};margin:0;overflow:hidden}` +
      `#GameDiv{position:fixed;inset:0;width:100vw!important;height:100vh!important;` +
      `border:0;border-radius:0;box-shadow:none;margin:0}.header,.footer{display:none}</style>`,
  ].join('\n');

  let out = replaceOnce(html, /<title>[^<]*<\/title>/, head, '<title>');
  out = replaceOnce(
    out,
    /<link rel="icon"[^>]*\/>/,
    '<link rel="icon" type="image/png" href="favicon.png"/>\n' +
      '    <link rel="apple-touch-icon" href="apple-touch-icon.png"/>',
    '<link rel="icon">',
  );
  out = replaceOnce(out, /\s*<h1 class="header">[\s\S]*?<\/h1>/, '', 'h1.header');
  out = replaceOnce(out, /\s*<p class="footer">[\s\S]*?<\/p>/, '', 'p.footer');
  out = replaceOnce(out, /<html>/, '<html lang="en">', '<html>');
  // Landscape: the template writes "portrait", the mobile default, but this game is 16:9.
  out = out.replace(/<meta name="screen-orientation" content="portrait"\/>/, '<meta name="screen-orientation" content="landscape"/>');
  return out;
}
