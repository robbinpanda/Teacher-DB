import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
test.use({extraHTTPHeaders:{'oai-authenticated-user-id':'book-test'}});
test('14章84题长教辅的两版PDF有完整章节题图和半页作答区',async({page,request,context})=>{
 test.setTimeout(240000);
 const seed=JSON.parse(execFileSync(process.execPath,['--import','./server/register.mjs','--import','tsx','scripts/seed-authoring-book.mts'],{encoding:'utf8',env:{...process.env,JIANTI_DATA_DIR:process.env.JIANTI_E2E_DATA_DIR}}));
 const scope='subject='+encodeURIComponent('数学')+'&stage=high';
 await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})),url:'http://127.0.0.1:3189'}]);
 await page.goto(`/studio/${seed.id}/preview?${scope}`);
 await expect(page.locator('.authoring-document')).toHaveAttribute('data-pagination-ready','true');
 await expect(page.locator('.authoring-document-chapter')).toHaveCount(14);await expect(page.locator('.authoring-exercise')).toHaveCount(84);
 await expect(page.locator('.authoring-document img')).toHaveCount(14);
 expect(await page.locator('.authoring-writing-space').count()).toBe(56);
 expect(await page.locator('.authoring-writing-space').evaluateAll(elements=>elements.every(e=>e.getBoundingClientRect().height>=500))).toBe(true);
 await mkdir('tmp/teacher-pilot',{recursive:true});
 const reports=[];
 for(const answers of [false,true]){
  const response=await request.get(`/api/authoring/${seed.id}/pdf?${scope}&answers=${answers?'1':'0'}`,{timeout:150000});expect(response.status()).toBe(200);
  const bytes=await response.body();await writeFile(`tmp/teacher-pilot/long-book-${answers?'teacher':'student'}.pdf`,bytes);
  const task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;let text='',imageCount=0;const lengths=[];
  for(let p=1;p<=pdf.numPages;p++){
   const page=await pdf.getPage(p),items=(await page.getTextContent()).items,content=items.map(i=>i.str).join('');lengths.push(content.length);
   const body=items.filter(i=>i.transform?.[5]>36).map(i=>i.str).join(''),footer=items.filter(i=>i.transform?.[5]<=36).map(i=>i.str).join('').replace(/\s/g,'');
   expect(body.trim().length,`blank page ${p}`).toBeGreaterThan(4);expect(footer).toBe(`${p}/${pdf.numPages}`);
   text+=content;imageCount+=(await page.getOperatorList()).fnArray.filter(op=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op)).length;
  }
  expect(text).toContain('周期现象与三角函数模型');for(let i=1;i<=84;i++)expect(text.replace(/\s/g,'')).toContain(`排版样题${i}】`);expect(imageCount).toBeGreaterThanOrEqual(14);
  expect(text.includes('BOOK-PRACTICE-ANSWER-84')).toBe(answers);expect(text).not.toContain('返回备课工作台');
  reports.push({version:answers?'teacher':'student',pages:pdf.numPages,images:imageCount,pageTextLengths:lengths});await task.destroy();
 }
 await writeFile('tmp/teacher-pilot/long-book-report.json',JSON.stringify(reports,null,2));
});
