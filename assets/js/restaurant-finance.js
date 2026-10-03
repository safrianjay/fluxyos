/* Local illustrative finance map. No persistence, API calls, or financial writes. */
(()=>{
 const map=document.querySelector('[data-finance-map]');if(!map)return;
 const tabs=[...map.querySelectorAll('[data-map-step]')],panels=[...map.querySelectorAll('.rc-map-panel')],list=map.querySelector('.rc-map-tabs');
 list.hidden=false;list.setAttribute('role','tablist');map.classList.add('is-enhanced');
 let active=0;
 function select(i,focus=false){active=i;map.style.setProperty('--rc-progress',i/(tabs.length-1));tabs.forEach((tab,n)=>{tab.setAttribute('aria-selected',String(n===i));tab.tabIndex=n===i?0:-1;panels[n].hidden=n!==i;panels[n].inert=n!==i;panels[n].classList.toggle('is-selected',n===i);});if(focus){tabs[i].focus();tabs[i].scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}}
 tabs.forEach((tab,i)=>{tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panels[i].id);panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',tab.id);panels[i].tabIndex=0;tab.addEventListener('click',()=>{map.classList.add('has-interacted');stopForInteraction();select(i);});tab.addEventListener('keydown',e=>{const dest={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[e.key];if(dest!==undefined){e.preventDefault();map.classList.add('has-interacted');stopForInteraction();select(dest,true);}});});select(0);
 // Advance only while the reader can see the tour. Manual choices stay selected.
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),playback=map.querySelector('[data-map-playback]');
 const isID=document.documentElement.lang==='id';let timer,paused=false,visible=false,hovered=false;
 playback.hidden=false;
 function syncPlayback(){
  clearTimeout(timer);map.classList.remove('is-playing');
  const allowed=!paused&&!reduced.matches&&!document.hidden&&visible&&!hovered&&(!map.contains(document.activeElement)||document.activeElement===playback);
  const playbackLabel=isID?(paused||reduced.matches?'Putar tur':'Jeda tur'):(paused||reduced.matches?'Play tour':'Pause tour');
  if(playback.textContent!==playbackLabel)playback.textContent=playbackLabel;
  playback.setAttribute('aria-pressed',String(paused||reduced.matches));
  playback.disabled=reduced.matches;
  if(allowed){map.classList.add('is-playing');timer=setTimeout(()=>{map.classList.add('has-interacted');select((active+1)%tabs.length);list.scrollTo({left:Math.max(0,tabs[active].offsetLeft-list.offsetLeft-(list.clientWidth-tabs[active].offsetWidth)/2),behavior:'instant'});syncPlayback();},8500);}
 }
 function stopForInteraction(){paused=true;syncPlayback();}
 playback.addEventListener('click',()=>{playback.focus({preventScroll:true});paused=!paused;syncPlayback();});
 map.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hovered=true;syncPlayback();}});
 map.addEventListener('pointerleave',()=>{hovered=false;syncPlayback();});
 map.addEventListener('focusin',syncPlayback);map.addEventListener('focusout',()=>setTimeout(syncPlayback,0));
 document.addEventListener('visibilitychange',syncPlayback);reduced.addEventListener('change',syncPlayback);
 if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncPlayback();},{threshold:0}).observe(map);else{visible=true;syncPlayback();}
 const scenarios=[...document.querySelectorAll('.rc-scenario')],prev=document.querySelector('[data-scenario-prev]'),next=document.querySelector('[data-scenario-next]'),status=document.querySelector('[data-scenario-status]');let current=0;
 document.querySelector('.rc-scenarios').classList.add('is-enhanced');document.querySelector('.rc-scenario-controls').hidden=false;
 function scenario(i){current=i;scenarios.forEach((s,n)=>{s.hidden=n!==i;s.inert=n!==i;s.classList.toggle('is-selected',n===i)});prev.disabled=i===0;next.disabled=i===scenarios.length-1;status.textContent=`${i+1} / ${scenarios.length}`;}
 prev.addEventListener('click',()=>scenario(Math.max(0,current-1)));next.addEventListener('click',()=>scenario(Math.min(scenarios.length-1,current+1)));scenario(0);
 const links=[...document.querySelectorAll('.rc-section-nav a')];if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)links.forEach(a=>{if(a.hash===`#${entry.target.id}`)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});},{rootMargin:'-20% 0px -55% 0px'});links.forEach(a=>observer.observe(document.querySelector(a.hash)));}
})();
