'use strict';
// Body feature artwork only: preserve wrappers, geometry, copy, controls and scenes.
const fs=require('fs'),path=require('path');
const aliases={table:'restaurant-table',ledger:'accounting-ledger',budget:'allocation-tray'};
const paths={...require('../assets/js/platform-icons'),
 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6':'invoice-envelope',
 'M4 7h16v14H4V7zm4 0V3h8v4m-8 6h8':'invoice-envelope',
 'M3 5h18v14H3V5zm5 7h8m-4-3v6':'finance-calculator',
 'M4 3h16v18H4V3zm4 13v-4m4 4V8m4 8v-6':'report-package',
 'M8 3H5v18h14V3h-3M8 3v4h8V3H8zm0 9h8m-8 4h5':'client-brief',
 'm3 7 9-4 9 4v10l-9 4-9-4V7zm0 0 9 4 9-4m-9 4v10M7.5 5l9 4':'commerce-parcel',
 'M4 3h16v18H4V3zm4 5h8m-8 4h8m-8 4h4':'accounting-ledger',
 'M3 3v18h18M7 15l4-5 4 3 5-8':'finance-review',
 'M3 5h18v14H3V5zm0 0 9 8 9-8':'invoice-envelope',
 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 9h10M7 13h10M7 17h5':'receipt-scanner'
};
function asset(name){
 name=aliases[name]||name;
 const special={ingredients:'restaurant-finance/ingredients',oven:'restaurant-finance/oven','restaurant-table':'restaurant-finance/table'};
 const directories=['platform-3d','cfo-finance','navbar-3d'];
 const relative=special[name]?`/assets/images/${special[name]}.webp`:directories.map(d=>`/assets/images/${d}/${name}.webp`).find(src=>fs.existsSync(path.join(__dirname,'..',src)));
 if(!relative||!fs.existsSync(path.join(__dirname,'..',relative)))throw Error('Missing approved 3D icon: '+name);
 return relative;
}
function transform(html){return html.replace(/<main\b[\s\S]*?<\/main>/g,main=>main.replace(/<img\b[^>]*>/g,tag=>{
 const cls=tag.match(/class="([^"]*)"/)?.[1]||'';
 if(!/(?:^|\s)(?:cf-icon|mf-icon|rf-icon|rc-map-object)(?:\s|$)/.test(cls))return tag;
 const src=tag.match(/src="([^"]+)"/)?.[1];if(!src)return tag;
 return tag.replace(src,asset(path.basename(src).replace(/\.(?:webp|svg)$/,'')));
}).replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g,(svg,attrs,body)=>{
 if(!attrs.includes('viewBox="0 0 24 24"'))return svg;
 const key=[...body.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m=>m[1]).join('|'),name=paths[key];
 if(!name)return svg; // Charts, arrows, controls, checkmarks and statuses stay intact.
 return `<svg${attrs} data-use-case-icon="${name}"><image href="${asset(name)}" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg>`;
}));}
module.exports={transform,asset};
