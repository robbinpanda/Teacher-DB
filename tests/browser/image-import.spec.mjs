import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

async function openImages(page){
 await page.route('**/api/model-profiles',r=>r.fulfill({json:{profiles:[],selectedProfileId:''}}));
 await page.goto('/');await page.getByRole('button',{name:'导入试卷',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'导入试卷'});await dialog.getByRole('button',{name:'图片组卷',exact:true}).click();return dialog;
}
const picture=async(name,color='#fff')=>({name,mimeType:'image/png',buffer:await sharp({create:{width:300,height:420,channels:3,background:color}}).png().toBuffer()});
test('多图合成一卷，可预览、排序、移除，上传PDF页序正确且可恢复',async({page})=>{
 const dialog=await openImages(page);await dialog.getByLabel('试卷名称',{exact:true}).fill('图片导入测试');
 await dialog.getByLabel('选择试卷图片').setInputFiles([await picture('第一张.png','#ddd'),await picture('第二张.png')]);
 await expect(dialog.locator('.wb-image-pages li')).toHaveCount(2);
 await dialog.getByLabel('第 2 页上移',{exact:true}).click();await expect(dialog.locator('.wb-image-pages li').first()).toContainText('第二张.png');
 await dialog.getByLabel('选择试卷图片').setInputFiles(await picture('第三张.png'));
 await expect(dialog.locator('.wb-image-pages li')).toHaveCount(3);await dialog.getByLabel('移除第 2 页',{exact:true}).click();
 await expect(dialog.locator('.wb-image-pages li')).toHaveCount(2);
 let pdf;
 await page.route('**/api/documents?**',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const request=route.request(),body=request.postDataBuffer();
  const form=await new Response(body,{headers:{'content-type':request.headers()['content-type']}}).formData();
  const f=form.get('file');pdf=new Uint8Array(await f.arrayBuffer());
  expect(f.name).toBe('图片导入测试.pdf');expect(form.get('subject')).toBe('数学');
  return route.fulfill({status:400,json:{error:'模拟上传失败以测试恢复'}});
 });
 await dialog.getByRole('button',{name:'开始导入',exact:true}).click();
 await expect(dialog.locator('.wb-upload-tasks')).toContainText('模拟上传失败');
 const task=getDocument({data:pdf});const document=await task.promise;expect(document.numPages).toBe(2);await task.destroy();
 await page.reload();await expect(page.getByRole('button',{name:/恢复未完成导入/})).toBeVisible();
});
test('一张长截图自动生成五页，可关闭拆页，坏图片不会清空已选页面',async({page})=>{
 const dialog=await openImages(page);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="3800"><rect width="640" height="3800" fill="#f2f2f2"/>'+Array.from({length:5},(_,i)=>`<rect x="40" y="${100+i*740}" width="560" height="700" fill="white"/><text x="120" y="${220+i*740}">Question ${i+1}</text>`).join('')+'</svg>';
 const buffer=await sharp(Buffer.from(svg)).png().toBuffer();
 await dialog.getByLabel('选择试卷图片').setInputFiles({name:'长图.png',mimeType:'image/png',buffer});await expect(dialog.locator('.wb-image-pages li')).toHaveCount(5);
 await dialog.getByLabel('选择试卷图片').setInputFiles({name:'坏图.png',mimeType:'image/png',buffer:Buffer.from('invalid')});
 await expect(dialog.getByRole('alert')).toContainText('损坏');await expect(dialog.locator('.wb-image-pages li')).toHaveCount(5);
 await dialog.getByRole('button',{name:'清空页面'}).click();await dialog.getByLabel('添加时自动拆分长图').uncheck();
 await dialog.getByLabel('选择试卷图片').setInputFiles({name:'长图.png',mimeType:'image/png',buffer});await expect(dialog.locator('.wb-image-pages li')).toHaveCount(1);
});

test('图片组卷真实保存原卷与分页，沿用现有题库分类和待配置模型流程',async({page,request})=>{
 const dialog=await openImages(page);await dialog.getByLabel('试卷名称',{exact:true}).fill('图片组卷真实保存');
 await dialog.getByLabel('选择试卷图片').setInputFiles([await picture('页一.png'),await picture('页二.png','#eee')]);
 await expect(dialog.locator('.wb-image-pages li')).toHaveCount(2);
 let id;
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/documents'&&r.request().method()==='POST'&&r.ok())id=(await r.json()).id;});
 await dialog.getByRole('button',{name:'开始导入',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('原卷已保存');
 expect(id).toBeTruthy();
 const progress=await (await request.get(`/api/documents/${id}/progress`)).json();
 expect(progress.document.pageCount).toBe(2);expect(progress.pages).toHaveLength(2);expect(progress.document.status).toBe('awaiting_model');
 const docs=await (await request.get('/api/documents?subject=%E6%95%B0%E5%AD%A6&stage=middle&search='+encodeURIComponent('图片组卷真实保存'))).json();
 expect(docs.documents.some(d=>d.id===id&&d.subject==='数学'&&d.grade==='九年级')).toBe(true);
});
