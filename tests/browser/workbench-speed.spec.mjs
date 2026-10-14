import { test, expect } from '@playwright/test';

test('overview follows processing/review/bank order and displays monitored speed', async ({page}) => {
  let rate=0.5;
  await page.route('**/api/extraction-queue?summary=1',route=>route.fulfill({json:{
    concurrency:10,activeCount:10,queuedCount:2,paused:false,
    speed:{questionsPerSecond:rate,completedQuestions:rate*10,windowSeconds:10,sampledAt:new Date().toISOString()},
  }}));
  await page.goto('/');
  const cards=page.locator('.wb-overview > button');
  await expect(cards.locator('.wb-metric-label')).toHaveText(['处理中','待审核','已入库']);
  await expect(cards.first().getByLabel('AI 处理速度')).toContainText('≈ 0.50 题/s');
  await expect(cards.first().getByLabel('AI 处理速度')).toHaveAttribute('title',/最近 10 秒新增完成识别 5 题/);
  await cards.first().click();
  await expect(page.getByRole('tab',{name:/^待处理/})).toHaveAttribute('aria-selected','true');
  rate=0;
  await expect(cards.first().getByLabel('AI 处理速度')).toContainText('≈ 0.00 题/s',{timeout:3500});
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const boxes=await cards.evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width,right:r.right};}));
    expect(boxes[0].x).toBeLessThan(boxes[1].x);expect(boxes[1].x).toBeLessThan(boxes[2].x);
    await page.screenshot({path:`tmp/workbench-speed-${width}.png`});
  }
});
