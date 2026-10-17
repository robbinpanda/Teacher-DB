// Run with: node --import ./server/register.mjs --import tsx scripts/verify-education-scope.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
process.env.JIANTI_DATA_DIR = path.resolve('tmp', `education-scope-${crypto.randomUUID()}`);
const { ensureDatabase } = await import('../db/bootstrap.ts');
const { getSqlite } = await import('../db/index.ts');
const { readModel } = await import('../server/http/read-models.ts');
const documents = await import('../server/http/handlers/documents/route.ts');
const documentDetail = await import('../server/http/handlers/documents/[documentId]/route.ts');
const questions = await import('../server/http/handlers/questions/route.ts');
const folders = await import('../server/http/handlers/question-folders/route.ts');
const paperFolders = await import('../server/http/handlers/paper-folders/route.ts');
const moves = await import('../server/http/handlers/questions/folder/route.ts');
const papers = await import('../server/http/handlers/papers/route.ts');
const bulk = await import('../server/http/handlers/documents/bulk/route.ts');
const { uploadDocument } = await import('../server/services/document-upload.ts');
await ensureDatabase();
const db = getSqlite(), stamp = new Date().toISOString();
const scopes = [{subject:'数学',stage:'middle',grade:'初三'}, {subject:'英语',stage:'middle',grade:'九年级'}, {subject:'数学',stage:'high',grade:'高三'}, {subject:'数学',stage:'primary',grade:'六年级'}];
function request(scope, route, data) {
  return new Request(`http://localhost${route}`, {method:data ? 'POST':'GET',headers:{'content-type':'application/json','oai-authenticated-user-id':'scope-test',cookie:`teacher-db-scope=${encodeURIComponent(JSON.stringify(scope))}`},body:data ? JSON.stringify(data):undefined});
}
try {
  for (const [i, scope] of scopes.entries()) {
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,grade,created_at,updated_at) VALUES (?,'scope-test',?,'application/pdf','reviewing',0,?,?,?,?)").run(`d${i}`,`试卷${i}`,scope.subject,scope.grade,stamp,stamp);
    for (const status of ['approved','pending']) db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,page_number,bbox_json,status,needs_human_review,created_at,updated_at) VALUES (?,?,?,'fill',?,'1',1,'{}',?,0,?,?)").run(`${status}${i}`,`d${i}`,status,`题目${i}`,status,stamp,stamp);
    const folderResponse = await folders.POST(request(scope,'/api/question-folders',{name:'同名文件夹'}));
    assert.equal(folderResponse.status,201);
    scope.folderId = (await folderResponse.json()).folder.id;
    const paperFolderResponse = await paperFolders.POST(request(scope,'/api/paper-folders',{name:'同名文件夹'}));
    assert.equal(paperFolderResponse.status,201);
    scope.paperFolderId = (await paperFolderResponse.json()).folder.id;
    const response = await papers.POST(request(scope,'/api/papers',{title:`组卷${i}`,questionIds:[`approved${i}`]}));
    assert.equal(response.status,201,await response.text());
  }
  for (const [i, scope] of scopes.entries()) {
    const docs = await (await documents.GET(request(scope,'/api/documents'))).json();
    assert.deepEqual(docs.documents.map(d=>d.id),[`d${i}`]);
    assert.equal(docs.stats.approvedQuestions,1);
    const result = await (await questions.GET(request(scope,'/api/questions'))).json();
    assert.deepEqual(result.questions.map(q=>q.id),[`approved${i}`]);
    const bank = (await (await readModel(request(scope,'/api/view',{resource:'bank'}))).json()).data;
    assert.equal(bank.stats.approved,1); assert.equal(bank.stats.papers,1);
    assert.deepEqual(bank.sources.map(s=>s.id),[`d${i}`]);
    assert.deepEqual(bank.folders.map(f=>f.id),[scope.folderId]);
    assert.deepEqual(bank.facets.grades.map(g=>g.value),[scope.grade]);
    const library = (await (await readModel(request(scope,'/api/view',{resource:'paper-library'}))).json()).data;
    assert.equal(library.papers.length,2); assert.deepEqual(library.folders.map(f=>f.id),[scope.paperFolderId]);
    const initial = (await (await readModel(request(scope,'/api/view',{resource:'document-page'}))).json()).data;
    assert.equal(initial.pagination.total,1);
  }
  const cross = await (await questions.GET(request(scopes[0],'/api/questions?documentId=d1'))).json();
  assert.equal(cross.pagination.total,0,'document links cannot bypass scope');
  assert.equal((await moves.PATCH(request(scopes[0],'/api/questions/folder',{ids:['approved0'],folderId:scopes[1].folderId}))).status,404);
  assert.equal((await papers.POST(request(scopes[0],'/api/papers',{title:'混合试卷',questionIds:['approved0','approved1']}))).status,400);
  const approval = await bulk.POST(request(scopes[0],'/api/documents/bulk',{action:'approve_all_without_review'}));
  const approvalResult = await approval.json();
  assert.equal(approval.status,200,JSON.stringify(approvalResult));
  assert.equal(approvalResult.selectedDocuments,1);
  assert.equal(db.prepare("SELECT status FROM questions WHERE id='pending1'").get().status,'pending','bulk approval cannot affect another subject');
  assert.equal(db.prepare("SELECT status FROM questions WHERE id='pending2'").get().status,'pending','bulk approval cannot affect another stage');
  db.prepare('UPDATE documents SET paper_folder_id = ? WHERE id = ?').run(scopes[3].paperFolderId, 'd3');
  db.prepare('UPDATE questions SET folder_id = ? WHERE document_id = ?').run(scopes[3].folderId, 'd3');
  const corrected = await documentDetail.PATCH(request(scopes[3],'/api/documents/d3',{grade:'高三'}),{params:Promise.resolve({documentId:'d3'})});
  assert.equal(corrected.status,200,await corrected.text());
  assert.equal(db.prepare("SELECT paper_folder_id FROM documents WHERE id='d3'").get().paper_folder_id,null);
  assert.equal(db.prepare("SELECT folder_id FROM questions WHERE id='approved3'").get().folder_id,null);
  const uploadedIds = new Set();
  for (const scope of scopes.slice(0,3)) {
    const form = new FormData();
    form.set('file',new File(['%PDF-1.4\nsame fixture'], 'same.pdf', {type:'application/pdf'}));
    form.set('subject',scope.subject); form.set('grade',scope.grade); form.set('pageCount','1');
    const uploaded = await uploadDocument('scope-test',form);
    assert.ok(uploaded.status < 300,JSON.stringify(uploaded));
    uploadedIds.add(uploaded.body.id);
    const repeated = await uploadDocument('scope-test',form);
    assert.equal(repeated.body.id,uploaded.body.id);
  }
  assert.equal(uploadedIds.size,3,'same PDF must create independent documents across scopes');
  const makeUploadRequest = (fields = {}, query = '') => {
    const form = new FormData();
    form.set('file',new File(['%PDF-1.4\ntarget fixture'], 'target.pdf', {type:'application/pdf'}));
    form.set('pageCount','1');
    for (const [key,value] of Object.entries(fields)) form.set(key,value);
    return new Request(`http://localhost/api/documents${query}`, {method:'POST',headers:{'oai-authenticated-user-id':'scope-test',cookie:`teacher-db-scope=${encodeURIComponent(JSON.stringify({subject:'英语',stage:'primary'}))}`},body:form});
  };
  const automatic = await documents.POST(makeUploadRequest());
  assert.equal(automatic.status,201);
  const automaticId = (await automatic.json()).id;
  assert.deepEqual(db.prepare('SELECT subject,grade FROM documents WHERE id=?').get(automaticId),{subject:'英语',grade:'六年级'});
  assert.equal((await documents.POST(makeUploadRequest({subject:'数学',grade:'六年级'}))).status,409);
  assert.equal((await documents.POST(makeUploadRequest({subject:'英语',grade:'高三'}))).status,409);
  const pinned = await documents.POST(makeUploadRequest({subject:'数学',grade:'高二'},'?subject='+encodeURIComponent('数学')+'&stage=high'));
  assert.equal(pinned.status,201);
  assert.deepEqual(db.prepare('SELECT subject,grade FROM documents WHERE id=?').get((await pinned.json()).id),{subject:'数学',grade:'高二'});
  console.log('PASS: scoped SSR/API lists, counts, facets, folders, paper saves, source links and bulk approval');
} finally { db.close(); }
