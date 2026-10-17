import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
test.use({extraHTTPHeaders:{'oai-authenticated-user-id':'pagination-fixture'}});

test('papers past 100 remain visible through tabs, global search and page navigation', async ({page})=>{
  const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
  const timestamp=new Date().toISOString();
  db.transaction(()=>{
    for(let i=0;i<127;i++){
      const id=`pagination-${String(i).padStart(3,'0')}`;
      db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES(?,'pagination-fixture',?,'application/pdf','complete',1,?,?)").run(id,i===0?'2023一模最早试卷.pdf':`分页试卷${i}.pdf`,timestamp,timestamp);
      db.prepare("INSERT INTO extraction_runs(id,document_id,page_number,provider,model,status,created_at) VALUES(?,?,1,'pending','pending','complete',?)").run(`${id}-run`,id,timestamp);
      db.prepare("INSERT INTO questions(id,document_id,number,type,stem,status,page_number,bbox_json,created_at,updated_at) VALUES(?,?,'1','fill','完整题干','approved',1,'{}',?,?)").run(`${id}-q`,id,timestamp,timestamp);
    }
  })();
  try{
    await page.goto('/');
    await expect(page.getByRole('tab',{name:/^已入库\s*127/})).toBeVisible();
    await expect(page.locator('.wb-table tbody tr')).toHaveCount(50);
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(page.locator('.wb-pagination')).toContainText('第 2 / 3 页');
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await expect(page.locator('.wb-table tbody tr')).toHaveCount(27);
    await expect(page.getByRole('link',{name:'2023一模最早试卷.pdf',exact:true})).toBeVisible();
    await page.getByRole('searchbox',{name:'搜索试卷名称'}).fill('2023一模');
    await expect(page.locator('.wb-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.wb-pagination')).toContainText('共 1 份');
    expect(db.prepare("SELECT COUNT(*) n FROM documents WHERE owner_id='pagination-fixture'").get().n).toBe(127);
    await page.screenshot({path:'tmp/workbench-pagination.png',fullPage:true});
    // A durable file selected before reload remains recoverable on the next visit.
    await page.evaluate(async()=>{
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('jianti-pending-uploads',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,t=db.transaction('files','readwrite');
          t.objectStore('files').put({id:'pending-fixture',fileName:'未上传一模.pdf',file:new File(['%PDF-fixture'],'未上传一模.pdf',{type:'application/pdf'}),metadata:{subject:'数学',grade:'九年级'}});
          t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};
      });
    });
    await page.reload();
    await expect(page.getByRole('button',{name:'恢复未完成导入（1）'})).toBeVisible();
  }finally{db.pragma('foreign_keys=ON');db.prepare("DELETE FROM documents WHERE owner_id='pagination-fixture'").run();db.close();}
});
