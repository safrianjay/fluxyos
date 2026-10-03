/* Progressive enhancement for local retail product visuals. No financial writes. */
(()=>{
 const tour=document.querySelector('[data-retail-tour]');if(!tour)return;
 const tabs=[...tour.querySelectorAll('[data-rf-step]')],panels=[...tour.querySelectorAll('.rf-tour-panel')],list=tour.querySelector('[data-rf-tabs]'),playback=tour.querySelector('[data-rf-playback]');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),isID=document.documentElement.lang==='id';
 let active=0,timer,paused=false,visible=false,hovered=false;
 list.hidden=false;list.setAttribute('role','tablist');playback.hidden=false;tour.dataset.enhanced='true';
 function select(i,focus=false){
  active=i;tour.dataset.activeStep=String(i);
  tabs.forEach((tab,n)=>{tab.setAttribute('aria-selected',String(n===i));tab.tabIndex=n===i?0:-1;panels[n].hidden=n!==i;panels[n].inert=n!==i;});
  if(focus)tabs[i].focus({preventScroll:true});
 }
 function sync(){
  clearTimeout(timer);tour.classList.remove('is-playing');
  const mayPlay=!paused&&!reduced.matches&&!document.hidden&&visible&&!hovered&&(!tour.contains(document.activeElement)||document.activeElement===playback);
  const label=isID?(paused||reduced.matches?'Putar tur':'Jeda tur'):(paused||reduced.matches?'Play tour':'Pause tour');
  // Preserve the pointer target during hover/focus events (including WebKit).
  if(playback.textContent!==label)playback.textContent=label;
  playback.setAttribute('aria-pressed',String(paused||reduced.matches));playback.disabled=reduced.matches;
  if(mayPlay){
   // Reset the CSS reading-progress bar together with the interval.
   void tour.offsetWidth;
   tour.classList.add('is-playing');timer=setTimeout(()=>{select((active+1)%tabs.length);sync();},8500);
  }
 }
 tabs.forEach((tab,i)=>{
  tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panels[i].id);
  panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',tab.id);panels[i].tabIndex=0;
  tab.addEventListener('click',()=>{paused=true;select(i);sync();});
  tab.addEventListener('keydown',e=>{const dest={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[e.key];if(dest!==undefined){e.preventDefault();paused=true;select(dest,true);sync();}});
 });
 playback.addEventListener('click',()=>{playback.focus({preventScroll:true});paused=!paused;sync();});
 tour.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hovered=true;sync();}});
 tour.addEventListener('pointerleave',()=>{hovered=false;sync();});
 tour.addEventListener('focusin',sync);tour.addEventListener('focusout',()=>setTimeout(sync,0));
 document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
 if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.25}).observe(tour);else visible=true;
 select(0);sync();
 // The multi-card viewport uses bounds, rather than assuming one full-width slide.
 const carousel=document.querySelector('.rf-walk-carousel'),cards=[...carousel.querySelectorAll('.rf-walk-card')],prev=document.querySelector('[data-rf-prev]'),next=document.querySelector('[data-rf-next]'),status=document.querySelector('[data-rf-status]');
 prev.parentElement.hidden=false;let scrollFrame;
 function update(){
  const max=carousel.scrollWidth-carousel.clientWidth,left=carousel.scrollLeft,box=carousel.getBoundingClientRect();
  // Native snap alignment can retain the 2px inline inset at either boundary.
  prev.disabled=left<=3;next.disabled=left>=max-3;
  const shown=cards.map((c,i)=>({i,r:c.getBoundingClientRect()})).filter(({r})=>r.left<box.right-8&&r.right>box.left+8);
  if(shown.length)status.textContent=`${isID?'Langkah':'Steps'} ${shown[0].i+1}–${shown.at(-1).i+1} / ${cards.length}`;
 }
 function move(value,immediate=false){
  carousel.scrollTo({left:Math.max(0,Math.min(carousel.scrollWidth-carousel.clientWidth,value)),behavior:immediate||reduced.matches?'instant':'smooth'});
 }
 const stride=()=>cards[1].offsetLeft-cards[0].offsetLeft;
 prev.addEventListener('click',()=>move(carousel.scrollLeft-stride()));next.addEventListener('click',()=>move(carousel.scrollLeft+stride()));
 carousel.addEventListener('keydown',e=>{if(e.target!==carousel)return;const targets={ArrowLeft:carousel.scrollLeft-stride(),ArrowRight:carousel.scrollLeft+stride(),Home:0,End:carousel.scrollWidth};if(e.key in targets){e.preventDefault();move(targets[e.key],e.key==='Home'||e.key==='End');}});
 carousel.addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(update);},{passive:true});
 if('ResizeObserver'in window)new ResizeObserver(update).observe(carousel);
 update();
})();
