import { test, expect } from '@playwright/test';

test('repeated PDF batches release workers, including parse and upload failures', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const stats = window.__pdfWorkers = { active: 0, max: 0, created: 0, terminated: 0 };
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); stats.created++; stats.active++; stats.max=Math.max(stats.max,stats.active); }
      terminate() { if(!this.finished) {this.finished=true; stats.active--; stats.terminated++;} return super.terminate(); }
    };
  });
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(Array.from({length:5},(_,i)=>`<section style="page-break-after:always"><h1>Paper ${i}</h1><p>1. Solve x + 1 = 2.</p></section>`).join(''));
  const buffer = await pdfPage.pdf({format:'A4'}); await pdfPage.close();
  const events=[], ids=new Map(); let uploadedPages=0;
  await page.route('**/api/model-profiles',route=>route.fulfill({json:{profiles:[],selectedProfileId:''}}));
  await page.route('**/api/extraction-queue?summary=1',route=>route.fulfill({json:{concurrency:30,activeCount:0,queuedCount:0,paused:false}}));
  await page.route('**/api/documents',route=>{
    if(route.request().method()!=='POST') return route.continue();
    const name=route.request().postDataBuffer().toString().match(/filename="([^"]+)"/)?.[1];
    if(!ids.has(name)) ids.set(name, name?.includes('fail-upload')?'fail-upload':crypto.randomUUID());
    return route.fulfill({json:{id:ids.get(name),status:'uploading'}});
  });
  await page.route('**/api/documents/*/pages',async route=>{
    if(route.request().url().includes('/fail-upload/')) return route.fulfill({status:400,json:{error:'fixture upload failure'}});
    uploadedPages++;
    await new Promise(resolve=>setTimeout(resolve,20));
    await route.fulfill({json:{id:crypto.randomUUID()}});
  });
  await page.route('**/api/documents/*',route=>route.request().method()==='PATCH'?route.fulfill({json:{ok:true}}):route.continue());
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/runtime-events') events.push(request.postDataJSON());});
  await page.goto('/');
  const cdp=await page.context().newCDPSession(page), heaps=[];
  for(let batch=0;batch<3;batch++) {
    await page.getByRole('button',{name:'导入试卷',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'导入试卷'});
    const files=Array.from({length:10},(_,i)=>({name:`batch-${batch}-${i}.pdf`,mimeType:'application/pdf',buffer}));
    files.push({name:`bad-${batch}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF-broken')});
    files.push({name:`fail-upload-${batch}.pdf`,mimeType:'application/pdf',buffer});
    await dialog.getByLabel('选择 PDF 文件').setInputFiles(files);
    await dialog.getByRole('button',{name:'开始导入'}).click();
    await expect.poll(()=>events.filter(e=>e.event==='pdf_end').length,{timeout:45000}).toBe((batch+1)*12);
    await expect.poll(()=>page.evaluate(()=>window.__pdfWorkers.active)).toBe(0);
    await cdp.send('HeapProfiler.collectGarbage');
    heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  }
  const workers=await page.evaluate(()=>window.__pdfWorkers);
  expect(workers.created).toBe(36); expect(workers.terminated).toBe(36); expect(workers.max).toBeLessThanOrEqual(2);
  expect(uploadedPages).toBe(150);
  expect(heaps[2]-heaps[0]).toBeLessThan(30*1024*1024);
  expect(events.filter(e=>e.event==='pdf_error')).toHaveLength(6);
  expect(Math.max(...events.map(e=>e.activePdfs))).toBeLessThanOrEqual(2);
  console.log(JSON.stringify({workers,heaps,uploadedPages}));
});
