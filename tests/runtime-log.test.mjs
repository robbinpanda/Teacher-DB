import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRuntimeLogger } from '../lib/runtime-log.mjs';

test('runtime logs rotate, redact secrets and tolerate a broken log destination', () => {
  mkdirSync('tmp',{recursive:true});
  const directory=mkdtempSync(path.resolve('tmp/runtime-log-'));
  const log=createRuntimeLogger(directory,'api',500);
  for(let n=0;n<20;n++) log('sample',{n,apiKey:'sensitive-key',error:new Error('Authorization: Bearer sensitive-bearer'),body:'private document',rss:123});
  const files=readdirSync(directory);
  assert.ok(files.length<=4);
  assert.ok(files.includes('api.ndjson.3'));
  for(const file of files) {
    const content=readFileSync(path.join(directory,file),'utf8');
    assert.ok(!content.includes('sensitive-key')&&!content.includes('sensitive-bearer')&&!content.includes('private document'));
    for(const line of content.trim().split('\n')) assert.equal(JSON.parse(line).event,'sample');
  }
  const blocked=path.join(directory,'blocked');writeFileSync(blocked,'file');
  assert.doesNotThrow(()=>createRuntimeLogger(blocked,'api')('test'));
});
