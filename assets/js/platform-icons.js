/* Icon-only enhancement: keep each SVG's original box, classes and interactions. */
(()=>{
 const paths={
  'M8 8h8M8 12h8M8 16h4':'allocation-tray',
  'M4 6h16M4 12h16M4 18h16':'allocation-tray',
  'M4 20V10m8 10V4m8 16v-7M2 20h20':'revenue-stream',
  'M4 20V10M10 20V4M16 20v-7M22 20H2':'revenue-stream',
  'M4 7h16M4 17h16m-4-14 4 4-4 4M8 13l-4 4 4 4':'revenue-stream',
  'M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6':'invoice-envelope',
  'M3 5h18v14H3zM3 5l9 8 9-8':'invoice-envelope',
  'm10 13 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M16 9l2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0':'connected-records',
  'M3 12h18M5 6h14M5 18h14':'connected-records',
  'M3 4h7a2 2 0 0 1 2 2v15a3 3 0 0 0-3-2H3zM21 4h-7a2 2 0 0 0-2 2v15a3 3 0 0 1 3-2h6z':'accounting-ledger',
  'M4 3h16v18H4zM8 7h8M8 12h8M8 17h8':'accounting-ledger',
  'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M6 12h12':'receipt-scanner',
  'M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6':'invoice-envelope',
  'M8 3H3v5M3 3l7 7M16 21h5v-5M21 21l-7-7':'revenue-stream',
  'M4 4h16v16H4ZM4 9h16M9 9v11':'connected-records',
  'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h4':'receipt-scanner',
  'M4 19V5M4 19h16M8 15l4-5 4 2 4-7':'revenue-stream',
  'M4 5h16v14H4ZM4 5l8 7 8-7':'invoice-envelope',
  'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4 18.4 5.6':'intelligence-orb',
  'm9 12 2 2 4-4M6 3h12v18H6Z':'receipt-scanner',
  'M4 19V5M4 19h16M7 15l4-5 4 2 5-7':'revenue-stream',
  'M4 4h16v16H4ZM4 10h16M10 4v16M14 14h3M14 17h3':'allocation-tray',
  'M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4ZM14 7h6v14h-6M7 8h3M7 12h3':'connected-records',
  'M4 4h16v12H4zM8 20h8M12 16v4M8 8h8M8 12h4':'pos-terminal',
  'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M6 12h12':'receipt-scanner',
  'M4 4h16v16H4zM8 4v16M4 9h16M4 14h16':'accounting-ledger',
  'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18':'currency-globe',
  'M3 5h18v14H3zM7 9h3m4 0h3M7 14h10':'invoice-envelope',
  'M4 3v18h17M8 16v-5m5 5V7m5 9V4':'revenue-stream',
  'M6 3v6h12V3M6 21v-6h12v6M12 9v6M3 12h18':'revenue-stream',
  'M4 12a8 8 0 0 1 14-5m0 0V3m0 4h-4M20 12a8 8 0 0 1-14 5m0 0v4m0-4h4':'revenue-stream',
  'M4 7h16v14H4zM8 7V3h8v4M8 12h8M8 16h5':'invoice-envelope',
  'm3 7 9-4 9 4-9 4-9-4v10l9 4 9-4V7M12 11v10':'commerce-parcel',
  'M4 3h16v18H4zM9 3v18M4 9h16M4 15h16':'accounting-ledger',
  'm3 9 9-6 9 6H3M5 9v9m5-9v9m4-9v9m5-9v9M3 21h18':'connected-records'
 };
 if(typeof module==='object'&&module.exports)module.exports=paths;
 if(typeof document==='undefined')return;
 const start=()=>{
  const main=document.querySelector('main');if(!main)return;
  const enhance=svg=>{
   if(svg.hasAttribute('data-platform-icon')||svg.getAttribute('viewBox')!=='0 0 24 24')return;
   const key=[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('|');
   const asset=paths[key];if(!asset)return;
   const image=document.createElementNS('http://www.w3.org/2000/svg','image');
   image.setAttribute('href',`/assets/images/platform-3d/${asset}.webp`);
   image.setAttribute('width','24');image.setAttribute('height','24');
   image.setAttribute('preserveAspectRatio','xMidYMid meet');
   const title=svg.querySelector('title');svg.replaceChildren(...(title?[title]:[]),image);
   svg.dataset.platformIcon=asset;
  };
  const scan=node=>{if(node.nodeType!==1)return;if(node.matches('svg'))enhance(node);node.querySelectorAll('svg').forEach(enhance);};
  scan(main);
  // Existing demos insert new icons when tabs change. Convert those icons only.
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(main,{childList:true,subtree:true});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
