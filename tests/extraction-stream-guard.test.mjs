import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRunawayFiller } from '../lib/extraction-stream-guard.ts';
test('repeated escaped filler aborts while ordinary math and answer blanks remain valid',()=>{
 assert.equal(hasRunawayFiller('题干'+'\\\\_'.repeat(600)),true);
 assert.equal(hasRunawayFiller('题干'+'_'.repeat(600)),true);
 assert.equal(hasRunawayFiller('题干_______ $x_1+x_2$'),false);
 assert.equal(hasRunawayFiller('各步骤不同的数学证明'.repeat(600)),false);
});
