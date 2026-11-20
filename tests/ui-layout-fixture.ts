import { readFileSync } from 'node:fs';

const html = readFileSync('src/ui/ui.html', 'utf8');
const templates = new Map(
  Array.from(
    html.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g),
    ([, id, innerHTML]) => [id, { innerHTML }] as const,
  ),
);

export function layoutElement(id: string) {
  return templates.get(id) ?? null;
}
