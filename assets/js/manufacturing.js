/* Local demonstration only: no database reads, writes, or automatic focus changes. */
(()=>{
 const page=document.querySelector('.mf-page');if(!page)return;
 const list=page.querySelector('.mf-selector'),tabs=[...page.querySelectorAll('[data-mf-tab]')],panels=[...page.querySelectorAll('.mf-panel')],reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function select(index,focus=false){tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;panels[i].classList.remove('is-changing')});if(!reduced.matches){void panels[index].offsetWidth;panels[index].classList.add('is-changing')}if(focus)tabs[index].focus();page.dataset.activeRecord=String(index)}
 tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>select(i));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(i+1)%tabs.length;if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next===undefined)return;event.preventDefault();select(next,true)});panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',tab.id);panels[i].tabIndex=0});
 // Reserve the tallest panel at the current width, including translated copy.
 let measuredWidth=-1;
 function reserveHeight(){
  const width=list.parentElement.clientWidth;if(width<1)return;
  const heights=panels.map(panel=>{const hidden=panel.hidden,style=panel.getAttribute('style');panel.hidden=false;panel.style.cssText=`position:absolute;visibility:hidden;pointer-events:none;width:${width}px;min-height:0;height:auto`;const height=panel.getBoundingClientRect().height;panel.hidden=hidden;if(style===null)panel.removeAttribute('style');else panel.setAttribute('style',style);return height});
  const height=Math.ceil(Math.max(...heights));panels.forEach(panel=>panel.style.minHeight=`${height}px`);measuredWidth=width;
 }
 list.hidden=false;select(0);reserveHeight();
 if('ResizeObserver' in window)new ResizeObserver(()=>{if(list.parentElement.clientWidth!==measuredWidth)reserveHeight()}).observe(list.parentElement);
 document.fonts?.ready.then(reserveHeight);
page.dataset.manufacturingReady='true';
})();
