import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredModelJson } from '../lib/model-json.ts';
test('模型 JSON 可包含单一明确代码块，拒绝多个结果及损坏正文',()=>{
 assert.deepEqual(parseStructuredModelJson('{"ok":true}'),{ok:true});
 assert.deepEqual(parseStructuredModelJson('```json\n{"ok":true}\n```\n说明：逐项核对完成。'),{ok:true});
 assert.throws(()=>parseStructuredModelJson('```json\n{"ok":true}\n```\n```json\n{"ok":false}\n```'));
 assert.throws(()=>parseStructuredModelJson('```json\n{"ok":true}\n```\n另一个 {"ok":false}'));
 assert.throws(()=>parseStructuredModelJson('```json\n{"ok":\n```'));
 assert.throws(()=>parseStructuredModelJson('{"ok":true}\n{"ok":false}'));
});
