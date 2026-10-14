// Recover the requested 2023–2025 first-mock PDFs via normal, checksum-idempotent APIs.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const source = path.resolve(process.argv[2]);
const apply = process.argv.includes('--apply');
const names = readdirSync(source).filter(name => /^一模_202[345]届.*\.pdf$/i.test(name)).sort();
if (!names.length) throw new Error('No matching requested first-mock PDFs');
const db = new Database('data/teacher-question-bank.sqlite3');
const backup = path.resolve('backups', `first-mock-recovery-${new Date().toISOString().replace(/[:.]/g,'-')}`);
mkdirSync(backup,{recursive:true});
if(apply) await db.backup(path.join(backup,'before.sqlite3'));
const report = [];
const profileId = db.prepare("SELECT selected_model_profile_id id FROM app_settings WHERE owner_id='local-demo'").get()?.id;
async function post(url,body) {
  const response=await fetch(`http://127.0.0.1:3051${url}`,{method:'POST',body,headers:typeof body==='string'?{'content-type':'application/json'}:undefined});
  const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;
}
try {
  for(const name of names) {
    const bytes=readFileSync(path.join(source,name));const checksum=createHash('sha256').update(bytes).digest('hex');
    const existing=db.prepare("SELECT id,status,page_count FROM documents WHERE owner_id='local-demo' AND checksum=? AND source_removed_at IS NULL").get(checksum);
    const job=existing&&db.prepare('SELECT status FROM document_jobs WHERE document_id=?').get(existing.id);
    if(job||existing?.status==='complete') {report.push({name,id:existing.id,status:job?.status??existing.status,action:'retained'});continue;}
    if(!apply){report.push({name,id:existing?.id,action:'needs-recovery'});continue;}
    const task=getDocument({data:Uint8Array.from(bytes),useSystemFonts:true});
    try {
      const pdf=await task.promise;
      let id=existing?.id;
      if(!id||!existing.page_count){const form=new FormData();form.set('file',new File([bytes],name,{type:'application/pdf'}));form.set('pageCount',String(pdf.numPages));form.set('subject','数学');form.set('grade','高三');form.set('sourceYear',name.slice(3,7));form.set('sourceExamType','一模');if(profileId)form.set('profileId',profileId);id=(await post('/api/documents',form)).id;}
      const saved=new Set(db.prepare('SELECT page_number FROM pages WHERE document_id=?').all(id).map(p=>p.page_number));
      for(let n=1;n<=pdf.numPages;n++){
        if(saved.has(n))continue;
        const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1.65});
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;
        const form=new FormData();form.set('page',new File([canvas.toBuffer('image/jpeg',90)],`page-${n}.jpg`,{type:'image/jpeg'}));form.set('pageNumber',String(n));form.set('width',String(canvas.width));form.set('height',String(canvas.height));
        await post(`/api/documents/${id}/pages`,form);page.cleanup();
      }
      // Another uploader may have finished the same checksum while we prepared pages.
      if(!db.prepare('SELECT 1 FROM document_jobs WHERE document_id=?').get(id))await post(`/api/documents/${id}/queue`,JSON.stringify({retry:true,profileId}));
      report.push({name,id,action:'recovered',pages:pdf.numPages});console.log(JSON.stringify(report.at(-1)));
    } catch(error) {report.push({name,id:existing?.id,action:'error',error:String(error)});console.error(JSON.stringify(report.at(-1)));}
    finally{await task.destroy();writeFileSync(path.join(backup,'report.json'),JSON.stringify(report,null,2));}
  }
  writeFileSync(path.join(backup,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({total:names.length,recovered:report.filter(r=>r.action==='recovered').length,retained:report.filter(r=>r.action==='retained').length,errors:report.filter(r=>r.action==='error'),backup}));
}finally{db.close();}
