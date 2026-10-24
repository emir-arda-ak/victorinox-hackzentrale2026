// Run the existing TypeScript suite using the same offline runtime as cached evaluation.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test entry point. */
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('jiti').createJiti(__filename, { alias: { '@': root } })(path.join(root, 'scripts/test-score.ts'));
