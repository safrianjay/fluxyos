#!/usr/bin/env node
'use strict';
// Synchronize static, no-JS navigation from the canonical homepage headers.
// Never import prepare-deploy.js: executing that build script prunes files.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const iconTools = require('./public-nav-icons');
const ROOT = path.resolve(__dirname, '..');
const NAV = /<nav\b[\s\S]*?<\/nav>/i;
const stripHomeClass = html => html.replace(/\bhome-hero-nav\s*/g, '');
function pages() {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/prepare-deploy.js'), 'utf8');
  const roles = vm.runInNewContext('(' + source.match(/const PAGE_ROLES = (\{[\s\S]*?\n\});/)[1] + ')');
  const files = Object.keys(roles).filter(file => roles[file].includes('marketing'));
  for (const directory of ['use-cases', 'guides', 'id']) {
    files.push(...fs.readdirSync(path.join(ROOT, directory), { recursive:true })
      .filter(file => file.endsWith('.html')).map(file => directory + '/' + file));
  }
  // Redirect stubs, event signup, and private investor decks have no navbar.
  return files.filter(file => NAV.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
}
function canonical(locale) {
  const file = locale === 'id' ? 'id/fluxyos.html' : 'fluxyos.html';
  return iconTools.render(stripHomeClass(fs.readFileSync(path.join(ROOT, file), 'utf8').match(NAV)[0]));
}
function render(html, nav, file) {
  if (!file.startsWith('id/') && fs.existsSync(path.join(ROOT, 'id', file))) {
    const mirrorPath = '/id/' + file.replace(/\.html$/, '');
    nav = nav.replace(/(<a href=")[^"]*("[^>]*>\s*Bahasa \(ID\))/, '$1' + mirrorPath + '$2');
  }
  if (file.startsWith('id/')) {
    const rootPath = '/' + file.slice(3).replace(/\.html$/, '');
    nav = nav.replace(/(<a href=")[^"]*("[^>]*>\s*English \(EN\))/, '$1' + rootPath + '$2')
      .replace(/(<a href=")[^"]*("[^>]*>\s*Bahasa \(ID\))/, '$1/id' + rootPath + '$2');
  }
  html = html.replace(NAV, () => nav);
  if (!/href="\/?assets\/css\/fluxyos\.css"/.test(html)) {
    html = html.replace('</head>', '<link rel="stylesheet" href="/assets/css/fluxyos.css">\n</head>');
  }
  for (const script of ['fluxyos.js', 'i18n.js']) {
    if (!html.includes('assets/js/' + script)) {
      html = html.replace('</body>', '<script src="/assets/js/' + script + '" defer></script>\n</body>');
    }
  }
  return html;
}
function run(check) {
  let failures = 0, changed = 0;
  const sources = { en:canonical('en'), id:canonical('id') };
  for (const file of pages()) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const expected = sources[file.startsWith('id/') ? 'id' : 'en'];
    const synced = render(html, expected, file);
    // The homepage retains its existing page-specific class.
    if (stripHomeClass(html) === stripHomeClass(synced)) continue;
    if (check) { console.error('Navbar drift: ' + file); failures++; }
    else { fs.writeFileSync(path.join(ROOT, file), synced); changed++; }
  }
  console.log('Marketing navbar: ' + pages().length + ' pages checked, ' + changed + ' updated.');
  return failures;
}
if (require.main === module) process.exitCode = run(process.argv.includes('--check')) ? 1 : 0;
module.exports = { pages, canonical, NAV, run };
