import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDiagnostics } from '../src/ui/diagnostics';

test('diagnostics consolidate modes without hiding distinct severity, codes or messages', () => {
  const groups = groupDiagnostics([
    {
      level: 'warning',
      code: 'BORDER',
      token: 'border',
      theme: 'light',
      message: 'Partial conversion',
    },
    {
      level: 'warning',
      code: 'BORDER',
      token: 'border',
      theme: 'dark',
      message: 'Partial conversion',
    },
    {
      level: 'warning',
      code: 'BORDER',
      token: 'border',
      theme: 'dark',
      message: 'Additional detail',
    },
    { level: 'error', code: 'BORDER', token: 'border', theme: 'dark', message: 'Blocked' },
    { level: 'info', code: 'FALLBACK', token: 'border', message: 'Fallback used' },
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].themes, ['light', 'dark']);
  assert.deepEqual(groups[0].messages, ['Partial conversion', 'Additional detail']);
  assert.equal(groups[1].level, 'error');
  assert.equal(groups[2].level, 'info');
});
