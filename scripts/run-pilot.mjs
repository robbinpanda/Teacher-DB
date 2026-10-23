import assert from 'node:assert/strict';
import path from 'node:path';
import { assertPilotCopy } from './prepare-pilot.mjs';
import { loadEnvironment } from './env.mjs';

const root = path.resolve(import.meta.dirname, '..');
loadEnvironment(root, 'production');
assert.ok(process.env.JIANTI_PILOT_DATA_DIR, '请先创建试用副本并设置 JIANTI_PILOT_DATA_DIR');
const directory = path.resolve(process.env.JIANTI_PILOT_DATA_DIR);
await assertPilotCopy(directory);
process.env.JIANTI_DATA_DIR = directory;
process.env.JIANTI_PILOT_COPY = '1';
process.env.JIANTI_WEB_PORT = '3070';
process.env.JIANTI_API_PORT = '3170';
process.env.APP_BASE_URL = 'http://127.0.0.1:3070';
process.env.JIANTI_WEB_HOST = '127.0.0.1';
process.env.JIANTI_API_HOST = '127.0.0.1';
// Never reuse another running instance's document processor or trace directory.
delete process.env.JIANTI_DOCUMENT_PROCESSOR_URL;
delete process.env.JIANTI_PROCESSOR_TOKEN;
process.env.JIANTI_WITH_PYTHON = '0';
process.env.JIANTI_RUNTIME_LOG_DIR = path.join(directory, 'runtime-logs');
process.env.JIANTI_NEXT_DIST_DIR = 'tmp/teacher-pilot/next';
assert.ok(!process.argv.slice(2).some(arg => /port=|with-python|--dev/.test(arg)), '试用环境端口固定；使用默认生产模式');
process.chdir(root);
await import('./run-local.mjs');
