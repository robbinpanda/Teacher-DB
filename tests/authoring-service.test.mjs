import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync } from 'node:fs';
import path from 'node:path';
test('备课后台端到端：模型协议、持久化、并发冲突、隔离与租约恢复',()=>{
 mkdirSync('tmp',{recursive:true});
 const directory=mkdtempSync(path.resolve('tmp/authoring-verification-'));
 execFileSync(process.execPath,['--import','./server/register.mjs','--import','tsx','scripts/verify-authoring.mts'],{
  env:{...process.env,JIANTI_DATA_DIR:directory,JIANTI_DEPLOYMENT_MODE:'local'},stdio:'pipe',windowsHide:true,timeout:60000,
 });
});

test('逐章编写、独立审校、教师修改、恢复和导出门槛',()=>{
 const directory=mkdtempSync(path.resolve('tmp/authoring-chapters-'));
 execFileSync(process.execPath,['--import','./server/register.mjs','--import','tsx','scripts/verify-authoring-chapters.mts'],{
  env:{...process.env,JIANTI_DATA_DIR:directory,JIANTI_DEPLOYMENT_MODE:'local'},stdio:'pipe',windowsHide:true,timeout:60000,
 });
});
