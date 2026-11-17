"""Build a self-contained source + compiled development-plugin archive."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / "release" / "blueprint-token-sync.zip"
output.parent.mkdir(exist_ok=True)
folders = ("src", "tests", "fixtures", "docs", "scripts", "dist", ".github")
files = [root / name for name in ("manifest.json", "package.json", "package-lock.json", "tsconfig.json", "README.md", "THIRD_PARTY.md", ".gitignore", ".prettierrc.json", ".prettierignore")]
for folder in folders:
    files.extend(p for p in (root / folder).rglob("*") if p.is_file() and p.name != ".DS_Store")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, Path("blueprint-token-sync") / file.relative_to(root))
print(output)
