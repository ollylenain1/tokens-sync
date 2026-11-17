# Sample token repositories

- `single-file/tokens.json`: legacy Tokens Studio bundle, ordered core/theme/component sets, Foundations collection and Interface Light/Dark modes, cross-set aliases, typography, multiple shadows, a gradient, blur and a border.
- `multi-file/`: the same data split into paths matching Tokens Studio token set names, with `$themes.json` and `$metadata.json`. Configure the provider path to this directory.
- `dtcg/tokens.json`: DTCG group type inheritance, structured sRGB, rem dimensions, typography, shadow and gradient-stop array.

Upload a fixture to a test repository with your normal Git workflow. Blueprint never creates or updates repository files. The UI’s sample mode uses the single-file fixture directly, without network access.

Tests also generate malformed JSON, circular/missing references, wrong types, missing mapping targets, unavailable fonts, failed API responses, truncated trees, enterprise restrictions and a 5,000-token design system. These synthetic failures are test-owned; they are not presented as valid production token structures.

## UI stress preview

`ui-stress.ts` generates 5,000 tokens across six modes for `npm run preview` at
`http://127.0.0.1:4174/?demo=stress`. It covers long names, strings, alpha colors, booleans,
and small numeric values. It is available only through the standalone preview path and never
reads a repository or writes to Figma.
