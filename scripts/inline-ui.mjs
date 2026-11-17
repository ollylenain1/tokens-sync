/** Use replacement callbacks: compiled JS can legitimately contain $&, $` and $'. */
export function inlineUI(html, css, script) {
  return html
    .replace('/* INLINE_CSS */', () => css)
    .replace('/* INLINE_JS */', () => script.replace(/<\/script/gi, '<\\/script'));
}
