/* Native, local product demonstrations. No app writes or external requests. */
(() => {
  'use strict';
  const page = document.querySelector('.ecommerce-page');
  if (!page) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  page.classList.add('ec-enhanced');
  const animate = node => {
    node.classList.remove('ec-enter');
    if (!reduced.matches) { void node.offsetWidth; node.classList.add('ec-enter'); }
  };
  const flow = page.querySelector('[data-flow]');
  const steps = [...flow.querySelectorAll('[data-flow-step]')];
  const panels = [...flow.querySelectorAll('[data-flow-panel]')];
  const nodes = [...flow.querySelectorAll('[data-flow-node]')];
  const stageText = panels.map(panel => panel.getAttribute('aria-label'));
  let flowIndex = 0;
  let replayTimer;
  let manualUntil = 0;
  function showFlow(index) {
    flowIndex = index;
    steps.forEach((step,i) => { step.setAttribute('aria-pressed',String(i===index)); step.setAttribute('aria-controls',panels[i].id); });
    panels.forEach((panel,i) => { panel.hidden=i!==index; });
    nodes.forEach((node,i) => {
      node.classList.toggle('is-current',i===index);
      const connector=node.nextElementSibling;
      if(connector && connector.tagName==='I') connector.classList.toggle('is-complete',i<index);
    });
    animate(panels[index]);
  }
  showFlow(0);
  steps.forEach((step,i) => {
    step.addEventListener('click',() => { clearTimeout(replayTimer); manualUntil=Date.now()+15000; showFlow(i); });
    step.addEventListener('keydown',event => {
      let next;
      if(event.key==='ArrowDown' || event.key==='ArrowRight') next=(i+1)%steps.length;
      if(event.key==='ArrowUp' || event.key==='ArrowLeft') next=(i+steps.length-1)%steps.length;
      if(event.key==='Home') next=0;
      if(event.key==='End') next=steps.length-1;
      if(next!==undefined){ event.preventDefault(); steps[next].focus(); steps[next].click(); }
    });
  });
  flow.querySelector('[data-flow-replay]').addEventListener('click',() => {
    clearTimeout(replayTimer); manualUntil=Date.now()+20000; showFlow(0);
    if(reduced.matches) return;
    const advance = () => { if(document.hidden) return; showFlow(flowIndex+1); if(flowIndex<3) replayTimer=setTimeout(advance,2400); };
    replayTimer=setTimeout(advance,2400);
  });
  // Let the reader's scroll drive the active step; clicks temporarily take priority.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if(Date.now()<manualUntil || window.innerWidth<681) return;
      const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio);
      if(visible.length) showFlow(steps.indexOf(visible[0].target));
    },{rootMargin:'-15% 0px -35% 0px',threshold:[.25,.6,1]});
    steps.forEach(step=>observer.observe(step));
    const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');reveal.unobserve(entry.target);}
    }),{threshold:.2});
    page.querySelectorAll('[data-reveal]').forEach(node=>reveal.observe(node));
  }
  // Auto-cycling Hero uses the very same order values as the detailed workflow.
  const hero=page.querySelector('.ec-hero-visual');
  const status=hero.querySelector('[data-hero-status]');
  const heroStages=[...hero.querySelectorAll('[data-hero-stage]')];
  const progress=[...hero.querySelectorAll('.ec-stage-progress i')];
  let heroIndex=0;
  let heroVisible=true;
  const heroObserver='IntersectionObserver' in window ? new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;},{threshold:.1}) : null;
  if(heroObserver) heroObserver.observe(hero);
  function showHero(index){
    heroIndex=index;status.textContent=stageText[index];
    heroStages.forEach((node,i)=>{node.hidden=i!==index;});
    progress.forEach((node,i)=>node.classList.toggle('is-current',i<=index));
    hero.dataset.stage=String(index);animate(heroStages[index]);
  }
  showHero(0);
  const heroTimer=setInterval(()=>{ if(!reduced.matches && !document.hidden && heroVisible) showHero((heroIndex+1)%4); },3000);
  // Report tab semantics are only added once JS can actually operate the tabs.
  const reports=page.querySelector('[data-reports]');
  const tabs=[...reports.querySelectorAll('[data-report-tab]')];
  const reportPanels=[...reports.querySelectorAll('[data-report-panel]')];
  reports.querySelector('.ec-report-tabs').setAttribute('role','tablist');
  function report(index){
    tabs.forEach((tab,i)=>{
      tab.id='ec-report-tab-'+i; tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(i===index));
      tab.setAttribute('aria-controls',reportPanels[i].id); tab.tabIndex=i===index?0:-1;
      reportPanels[i].setAttribute('role','tabpanel'); reportPanels[i].setAttribute('aria-labelledby',tab.id); reportPanels[i].tabIndex=0; reportPanels[i].hidden=i!==index;
    });
    animate(reportPanels[index]);
  }
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>report(i));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(i+1)%tabs.length;
      if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=tabs.length-1;
      if(next!==undefined){event.preventDefault();report(next);tabs[next].focus();}
    });
  });
  report(0);
  // Short progressive answer; original text is kept for reduced motion and QA.
  const answers=[...page.querySelectorAll('[data-ai-answer]')];
  const questions=[...page.querySelectorAll('[data-ai-question]')];
  const answerText=answers.map(node=>node.querySelector('[data-answer-text]').textContent);
  let answerTimer;
  function answer(index,typing=false){
    clearInterval(answerTimer);
    answers.forEach((node,i)=>{node.hidden=i!==index;node.querySelector('[data-answer-text]').textContent=answerText[i];});
    questions.forEach((node,i)=>{node.setAttribute('aria-pressed',String(i===index));node.setAttribute('aria-controls','ec-answer-'+i);answers[i].id='ec-answer-'+i;});
    animate(answers[index]);
    if(typing && !reduced.matches){
      const text=answers[index].querySelector('[data-answer-text]');let chars=0;
      text.textContent=answerText[index].slice(0,12);
      answerTimer=setInterval(()=>{chars+=12;text.textContent=answerText[index].slice(0,chars);if(chars>=answerText[index].length)clearInterval(answerTimer);},24);
    }
  }
  questions.forEach((question,i)=>question.addEventListener('click',()=>answer(i,true)));
  answer(0);
  reduced.addEventListener('change',()=>{if(reduced.matches){clearTimeout(replayTimer);clearInterval(answerTimer);answers.forEach((node,i)=>node.querySelector('[data-answer-text]').textContent=answerText[i]);showHero(0);}});
  window.addEventListener('pagehide',()=>{clearInterval(heroTimer);clearInterval(answerTimer);clearTimeout(replayTimer);},{once:true});
  const canvas=document.querySelector('.footer-component .footer-canvas');
  if(canvas && typeof window.initUniverseCanvas==='function') window.initUniverseCanvas(canvas);
})();
