import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inlineUI } from './inline-ui.mjs';
const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
const html = await readFile('src/ui/index.html', 'utf8');
const bundleUI = {
  entryPoints: ['src/ui/app.ts'],
  bundle: true,
  write: false,
  minify: !watch,
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
          const css = await readFile('src/ui/style.css', 'utf8');
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
  for (const file of ['src/ui/style.css', 'src/ui/index.html'])
    watchFiles(file, async () => {
      const updated = await readFile('src/ui/index.html', 'utf8');
      const js = await esbuild.build({ ...bundleUI, plugins: [] });
      await writeFile(
        'dist/ui.html',
        inlineUI(updated, await readFile('src/ui/style.css', 'utf8'), js.outputFiles[0].text),
      );
    });
  console.log('Watching plugin and UI source. Re-run the development plugin in Figma after edits.');
} else {
  await Promise.all([esbuild.build(plugin), esbuild.build(bundleUI)]);
  console.log('Built dist/code.js and dist/ui.html. Import manifest.json in Figma.');
}
