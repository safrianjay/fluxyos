#!/usr/bin/env node
/* Preserve all text, layout, SVG sizing and existing controls. */
const fs=require('fs'),path=require('path'),icons=require('../assets/js/platform-icons');
const root=path.resolve(__dirname,'..'),slugs=['budgetlanding','vendorspend','revenuesync','receiptcapture','aiagents','multi-currency','accounting-automation'];
let count=0;
for(const slug of slugs)for(const prefix of ['', 'id/']){
 const file=path.join(root,prefix+slug+'.html');let html=fs.readFileSync(file,'utf8');
 html=html.replace(/(<main\b[^>]*>)([\s\S]*?)(<\/main>)/,(_,start,main,end)=>start+main.replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g,(whole,attrs,body)=>{
  if(!/viewBox="0 0 24 24"/.test(attrs)||/data-platform-icon=/.test(attrs))return whole;
  const key=[...body.matchAll(/\bd="([^"]+)"/g)].map(m=>m[1]).join('|'),asset=icons[key];if(!asset)return whole;
  if(!fs.existsSync(path.join(root,`assets/images/platform-3d/${asset}.webp`)))throw Error('Missing asset: '+asset);
  count++;return `<svg${attrs} data-platform-icon="${asset}">${body.match(/<title\b[^>]*>[\s\S]*?<\/title>/)?.[0]||''}<image href="/assets/images/platform-3d/${asset}.webp" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg>`;
 })+end);
 if(!html.includes('/assets/js/platform-icons.js'))html=html.replace('</body>','<script src="/assets/js/platform-icons.js" defer></script>\n</body>');
 fs.writeFileSync(file,html);
}
console.log(`Updated ${count} existing feature icons; existing controls, charts, copy and geometry preserved.`);
