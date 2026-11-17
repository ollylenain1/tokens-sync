import { Diagnostic } from '../core/model';

/** Preserve distinct messages while consolidating repeated mode diagnostics. */
export function groupDiagnostics(diagnostics: Diagnostic[]) {
  const groups = new Map<
    string,
    {
      level: Diagnostic['level'];
      code: string;
      token?: string;
      themes: string[];
      messages: string[];
    }
  >();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([diagnostic.level, diagnostic.code, diagnostic.token]);
    let group = groups.get(key);
    if (!group) {
      group = {
        level: diagnostic.level,
        code: diagnostic.code,
        token: diagnostic.token,
        themes: [],
        messages: [],
      };
      groups.set(key, group);
    }
    if (diagnostic.theme && !group.themes.includes(diagnostic.theme))
      group.themes.push(diagnostic.theme);
    if (!group.messages.includes(diagnostic.message)) group.messages.push(diagnostic.message);
  }
  return [...groups.values()];
}
