import { readFileSync } from 'node:fs';
import { parseRepository } from '../src/core/parser';
export const fixture = JSON.parse(readFileSync('fixtures/single-file/tokens.json', 'utf8'));
export function project(input: unknown = fixture) {
  return parseRepository({
    identity: 'repo',
    revision: 'abc123',
    fetchedAt: '2026-11-11T12:00:00Z',
    files: { 'tokens.json': JSON.stringify(input) },
    singleFile: 'tokens.json',
    layout: 'auto',
  });
}
