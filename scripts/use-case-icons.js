'use strict';
// Body feature icons only: preserve wrappers, geometry, copy, controls and scenes.
const fs=require('fs'),path=require('path');
const aliases={table:'restaurant-table',ledger:'accounting-ledger',budget:'allocation-tray'};
function transform(html){return html.replace(/<main\b[\s\S]*?<\/main>/g,main=>main.replace(/<img\b[^>]*>/g,tag=>{
 const cls=tag.match(/class="([^"]*)"/)?.[1]||'';
 if(!/(?:^|\s)(?:cf-icon|mf-icon|rf-icon|rc-map-object)(?:\s|$)/.test(cls))return tag;
 const src=tag.match(/src="([^"]+)"/)?.[1];if(!src||src.includes('/use-case-2d/'))return tag;
 const original=path.basename(src,'.webp'),name=aliases[original]||original;
 if(!fs.existsSync(path.join(__dirname,'../assets/images/use-case-2d',name+'.svg')))throw Error('Missing 2D icon: '+name);
 return tag.replace(src,'/assets/images/use-case-2d/'+name+'.svg');
}));}
module.exports={transform};
