import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('资料搜索批量选择保留隐藏勾选，105份完整提交，超过上限不截断',async({page,context})=>{
 await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})),url:'http://127.0.0.1:3189'}]);
 const sources=Array.from({length:1001},(_,i)=>({id:`source-${i}`,name:`${i<105?'2024':'2025'} 年数学资料 ${String(i).padStart(4,'0')}`,questionCount:8}));
 let submitted;
 await page.route('**/api/model-profiles',route=>route.fulfill({json:{profiles:[{id:'fixture-model',displayName:'测试模型',enabled:true,apiKeyMask:'test'}]}}));
 await page.route('**/api/authoring?*',route=>{
  if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return route.fulfill({status:400,json:{error:'测试已接收资料选择'}});}
  return route.fulfill({json:{projects:[],sources,papers:[]}});
 });
 await page.goto('/studio');await page.getByText('选择资料范围（整个当前题库）',{exact:true}).click();
 const picker=page.locator('.studio-source-picker'),search=page.getByRole('searchbox',{name:'搜索资料名称'});
 await search.fill('２０２４ 数学');await expect(picker.locator('input[type=checkbox]')).toHaveCount(105);
 await page.getByRole('button',{name:'选中搜索结果',exact:true}).click();await expect(picker.locator('summary')).toContainText('已选 105 份');
 await search.fill('2024 0001');await expect(picker.locator('input[type=checkbox]')).toHaveCount(1);await expect(picker).toContainText('104 份不在当前搜索结果中');
 await page.getByRole('button',{name:'取消勾选搜索结果'}).click();await expect(picker.locator('summary')).toContainText('已选 104 份');
 await page.getByRole('button',{name:'选中搜索结果',exact:true}).click();await search.fill('2025');
 await page.getByRole('button',{name:'选中搜索结果',exact:true}).click();await expect(picker.getByRole('alert')).toContainText('最多选择 1000');
 await expect(picker.locator('summary')).toContainText('已选 105 份');await expect(picker.locator('input:checked')).toHaveCount(0);
 await search.fill('不存在的资料');await expect(picker).toContainText('找到 0 / 1001');await expect(page.getByRole('button',{name:'选中搜索结果',exact:true})).toBeDisabled();
 await page.getByLabel('教学要求').fill('使用选定资料编写三角函数校本教辅，每节配有例题与练习。');
 await page.getByLabel('作品类型').selectOption('book');await page.getByRole('button',{name:'生成教学大纲',exact:true}).click();
 await expect.poll(()=>submitted?.documentIds.length).toBe(105);expect(new Set(submitted.documentIds)).toEqual(new Set(sources.slice(0,105).map(source=>source.id)));
 await search.fill('2024');await mkdir('tmp/teacher-pilot',{recursive:true});await page.screenshot({path:'tmp/teacher-pilot/source-picker-browser.png',fullPage:false});
 await page.getByRole('button',{name:'使用整个当前题库',exact:true}).click();await expect(picker.locator('summary')).toContainText('整个当前题库');await expect(picker.getByRole('alert')).toHaveCount(0);
});
