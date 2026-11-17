import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

test('HTML packaging preserves JavaScript replacement sequences and escapes script termination', async () => {
  const { inlineUI } = await import(pathToFileURL(resolve('scripts/inline-ui.mjs')).href);
  const value = "$& $` $' </script> &";
  const script = `result = ${JSON.stringify(value)};`;
  const html = inlineUI(
    '<style>/* INLINE_CSS */</style><script>/* INLINE_JS */</script>',
    '/* $& */',
    script,
  );
  const extracted = /<script>([\s\S]*)<\/script>/.exec(html)![1];
  const context = { result: '' };
  runInNewContext(extracted, context);
  assert.equal(context.result, value);
  assert(html.includes('<style>/* $& */</style>'));
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
});
