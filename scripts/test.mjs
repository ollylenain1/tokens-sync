import * as esbuild from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const tests = (await readdir('tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => `tests/${f}`);
await mkdir('.test-build', { recursive: true });
await esbuild.build({
  entryPoints: tests,
  outdir: '.test-build',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  packages: 'external',
});
const child = spawn(
  process.execPath,
  ['--test', ...tests.map((f) => f.replace('tests/', '.test-build/').replace('.ts', '.js'))],
  { stdio: 'inherit' },
);
child.on('exit', (code) => (process.exitCode = code ?? 1));
