'use strict';
// One route-to-asset registry renders every desktop/mobile business menu entry.
const fs=require('fs'),path=require('path');
const manifest=require('../assets/images/navbar-3d/manifest.json');
function entryFor(route){return Object.entries(manifest).find(([,m])=>m.route===route.replace(/^\/id(?=\/)/,''));}
function icon(id){const m=manifest[id];return `<span class="public-nav-icon" aria-hidden="true"><img src="/assets/images/navbar-3d/${m.asset}" width="48" height="48" alt="" loading="lazy" decoding="async" data-nav-icon></span>`;}
function render(nav){return nav.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g,(all,attrs,body)=>{
 const href=attrs.match(/href="([^"]+)"/)?.[1];if(!href||(!/group\/item/.test(attrs)&&!/mobile-menu-link/.test(attrs)))return all;
 // /fluxyos is also the logo/language/promo route; match the actual role label.
 const entry=entryFor(href);if(!entry)return all;
 const [id]=entry;if(attrs.includes('data-nav-entry'))return all.replace(/data-nav-entry="[^"]+"/,`data-nav-entry="${id}"`).replace(/\/assets\/images\/navbar-3d\/[^"]+/,`/assets/images/navbar-3d/${manifest[id].asset}`);if(id==='department-heads'&&!/Department Heads|Kepala Departemen/.test(body))return all;
 body=body.replace(/<span class="public-nav-icon"[\s\S]*?<\/span>/,'');
 body=body.replace(/<div[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/div>/,'').replace(/<span[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/span>/,'');
 if(!attrs.includes('public-nav-item'))attrs=attrs.replace(/class="/,'class="public-nav-item ');
 attrs=attrs.replace(/\sdata-nav-entry="[^"]+"/g,'');
 return `<a${attrs} data-nav-entry="${id}">${icon(id)}<div class="public-nav-copy">${body.trim()}</div></a>`;
 });}
module.exports={manifest,render,icon};
if(require.main===module){for(const file of['fluxyos.html','id/fluxyos.html']){const p=path.resolve(__dirname,'..',file),old=fs.readFileSync(p,'utf8');const nav=old.match(/<nav\b[\s\S]*?<\/nav>/)[0];fs.writeFileSync(p,old.replace(nav,render(nav)));}}
