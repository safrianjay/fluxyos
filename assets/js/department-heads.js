/* Manual reading steps: native buttons, roving focus and no automatic cycling. */
(()=>{
 const tour=document.querySelector('[data-department-tour]');if(!tour)return;
 const tabs=[...tour.querySelectorAll('[role=tab]')];
 const select=(index,focus=false)=>tabs.forEach((tab,i)=>{
  const active=i===index;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
  document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;
  if(active&&focus)tab.focus();
 });
 tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>select(i));
  tab.addEventListener('keydown',event=>{
   let next;if(['ArrowRight','ArrowDown'].includes(event.key))next=(i+1)%tabs.length;
   else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(i+tabs.length-1)%tabs.length;
   else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;
   if(next!==undefined){event.preventDefault();select(next,true);}
  });
 });
})();
