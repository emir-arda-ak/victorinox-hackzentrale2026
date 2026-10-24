/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS runner for offline TypeScript tests. */
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('jiti').createJiti(__filename, { alias: { '@': root } }).import(path.join(root, 'scripts/test-embeddings.ts'))
  .then(m => m.main()).catch(error => { console.error(error); process.exitCode = 1; });
