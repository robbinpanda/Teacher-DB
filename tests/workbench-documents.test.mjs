import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDocuments } from '../lib/workbench-documents.ts';

test('正在识别优先置顶，组内遵循所选排序且不改变原数组', () => {
  const docs = [
    { id: 'new', name: 'A', createdAt: '2026-10-13', status: 'reviewing', completedPageCount: 1, pageCount: 1 },
    { id: 'active', name: 'Z', createdAt: '2026-01-01', status: 'extracting', jobStatus: 'processing', completedPageCount: 0, pageCount: 1 },
    { id: 'paused', name: 'B', createdAt: '2026-10-12', status: 'extracting', jobStatus: 'paused', completedPageCount: 0, pageCount: 1 },
    { id: 'active-new', name: 'Y', createdAt: '2026-10-11', status: 'extracting', jobStatus: 'processing', completedPageCount: 0, pageCount: 1 },
  ];
  assert.deepEqual(filterDocuments(docs, 'all', '', 'newest').map(d => d.id), ['active-new', 'active', 'new', 'paused']);
  assert.deepEqual(filterDocuments(docs, 'all', '', 'oldest').map(d => d.id), ['active', 'active-new', 'paused', 'new']);
  assert.deepEqual(filterDocuments(docs, 'all', '', 'name').map(d => d.id), ['active-new', 'active', 'new', 'paused']);
  assert.deepEqual(filterDocuments(docs, 'preprocessing', 'Z', 'newest').map(d => d.id), ['active']);
  assert.deepEqual(filterDocuments(docs, 'pending_review', '', 'newest').map(d => d.id), ['new']);
  assert.equal(docs[0].id, 'new');
});
