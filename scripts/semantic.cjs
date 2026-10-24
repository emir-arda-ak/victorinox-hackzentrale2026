/* eslint-disable @typescript-eslint/no-require-imports -- Offline/CLI entry point for TypeScript modules. */
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const jiti = require('jiti').createJiti(__filename, { alias: { '@': root } });
// Use Next's environment precedence, but never print environment values.
require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
process.chdir(root);
jiti.import(path.join(root, 'scripts/semantic-cli.ts')).then(m => m.main(process.argv.slice(2))).catch(() => {
  console.error('Semantic command failed. Check arguments, configuration, index and API access.');
  process.exitCode = 1;
});
