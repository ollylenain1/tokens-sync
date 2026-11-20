import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inlineUI } from './inline-ui.mjs';
const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
const layoutFile = 'src/ui/ui.html';
const bundleUI = {
  entryPoints: ['src/ui/app.ts'],
  bundle: true,
  write: false,
  minify: false,
  target: 'es2020',
  format: 'iife',
  plugins: [
    {
      name: 'html',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          const script =
            result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ??
            result.outputFiles[0].text;
          const [html, css] = await Promise.all([
            readFile(layoutFile, 'utf8'),
            readFile('src/ui/style.css', 'utf8'),
          ]);
          await writeFile('dist/ui.html', inlineUI(html, css, script));
        });
      },
    },
  ],
  outfile: 'dist/ui.js',
};
const plugin = {
  entryPoints: ['src/plugin.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  target: 'es2017',
  format: 'iife',
  minify: !watch,
};
if (watch) {
  const contexts = await Promise.all([esbuild.context(plugin), esbuild.context(bundleUI)]);
  await Promise.all(contexts.map((c) => c.watch()));
  // UI CSS and HTML are not imported in JS, so watch these source files explicitly.
  const { watch: watchFiles } = await import('node:fs');
  for (const file of ['src/ui/style.css', layoutFile])
    watchFiles(file, () => contexts[1].rebuild().catch(console.error));
  console.log('Watching plugin and UI source. Re-run the development plugin in Figma after edits.');
} else {
  await Promise.all([esbuild.build(plugin), esbuild.build(bundleUI)]);
  console.log('Built dist/code.js and dist/ui.html. Import manifest.json in Figma.');
}
