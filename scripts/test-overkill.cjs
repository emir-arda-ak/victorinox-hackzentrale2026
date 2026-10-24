/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript test runner. */
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('jiti').createJiti(__filename, { alias: { '@': root } }).import(path.join(root, 'scripts/test-overkill.ts'))
  .then(m => m.main()).catch(error => { console.error(error); process.exitCode = 1; });
