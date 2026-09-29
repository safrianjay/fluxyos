#!/usr/bin/env node
// A reproducible, native product-UI social preview. Run with the QA server up.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.route('https://www.googletagmanager.com/**',route=>route.fulfill({body:'',contentType:'application/javascript'}));
    await page.goto('http://127.0.0.1:8765/use-cases/ecommerce-brands',{waitUntil:'networkidle'});
    await page.addStyleTag({content:`
      body > :not(main) { display:none !important; }
      main > :not(.ec-hero) { display:none !important; }
      .ec-hero { padding:48px 0; min-height:630px; }
      .ec-container { width:1088px; }
      .ec-hero-grid { grid-template-columns:480px 560px; gap:48px; }
      .ec-hero-copy { padding-top:0; }
      .ec-hero h1 { font-size:44px; letter-spacing:-2px; margin-top:32px; }
      .ec-lead { font-size:16px; }
      .ec-category { font-size:11px; }
      .ec-hero-visual { padding:0 0 60px; height:534px; }
      .ec-workspace { width:620px; }
      .ec-workspace .ec-revenue-chart { max-height:125px; }
      .ec-workspace-body { padding:18px 24px; }
      .ec-order-row { padding:8px 0; }
      .ec-hero-record { left:-22px; bottom:0; width:300px; }
      .ec-record-body { padding:12px 18px; }
      .ec-hero-record .ec-window-head { padding:12px 18px; min-height:48px; }
      .ec-demo-caption,.ec-hero-copy > .ec-text-link { display:none; }
      .ec-og-brand { display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600; }
      .ec-og-brand img { width:32px;height:32px; }
      .ec-og-brand small { font-size:13px;font-weight:400;color:#6B7280;margin-left:12px; }
    `});
    await page.evaluate(()=>{
      const brand=document.createElement('div');brand.className='ec-og-brand';
      brand.innerHTML='<img src="/assets/images/favicon.svg" alt="">FluxyOS <small>E-Commerce Brands</small>';
      document.querySelector('.ec-hero-copy').prepend(brand);
    });
    await page.screenshot({path:path.resolve(__dirname,'../assets/images/og-ecommerce-brands.png')});
    console.log('Captured branded 1200 × 630 e-commerce preview.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
