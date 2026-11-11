// Packs dist/ into a .vsix (the zip VS Code installs with "Install from VSIX…" or `code
// --install-extension`), without @vscode/vsce: the format is a zip with a manifest and a content
// types file, and fflate (already in the tree) writes zips. Offline, no account, no Marketplace.
//   node package.mjs            → cartography-<version>.vsix next to this file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

/** The manifest VS Code reads: the workspace name and the build-only fields left out. */
export function extensionManifest(p = pkg) {
  const { devDependencies: _d, dependencies: _deps, scripts: _s, private: _p, ...rest } = p;
  return { ...rest, name: 'cartography' };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function vsixManifest(m) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(m.name)}" Version="${esc(m.version)}" Publisher="${esc(m.publisher)}" />
    <DisplayName>${esc(m.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(m.description)}</Description>
    <Tags>${esc((m.keywords ?? []).join(','))}</Tags>
    <Categories>${esc((m.categories ?? []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(m.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/media/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json" /><Default Extension=".js" ContentType="application/javascript" /><Default Extension=".mjs" ContentType="application/javascript" /><Default Extension=".png" ContentType="image/png" /><Default Extension=".svg" ContentType="image/svg+xml" /><Default Extension=".md" ContentType="text/markdown" /><Default Extension=".txt" ContentType="text/plain" /><Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>
`;

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

export function packVsix() {
  const dist = path.join(here, 'dist');
  if (!fs.existsSync(path.join(dist, 'extension.js'))) throw new Error('Build first: node build.mjs');
  const m = extensionManifest();
  const text = (s) => new TextEncoder().encode(s);
  const files = {
    '[Content_Types].xml': text(CONTENT_TYPES),
    'extension.vsixmanifest': text(vsixManifest(m)),
    'extension/package.json': text(JSON.stringify(m, null, 2) + '\n'),
    'extension/README.md': fs.readFileSync(path.join(root, 'docs/vscode.md')),
    'extension/LICENSE.txt': fs.readFileSync(path.join(root, 'LICENSE')),
    'extension/media/icon.png': fs.readFileSync(path.join(here, 'media/icon.png')),
  };
  for (const f of walk(dist)) files[`extension/dist/${f}`] = fs.readFileSync(path.join(dist, f));
  const out = path.join(here, `cartography-${m.version}.vsix`);
  fs.writeFileSync(out, zipSync(files, { level: 9 }));
  return { out, files: Object.keys(files).length, bytes: fs.statSync(out).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = packVsix();
  console.log(`${path.relative(process.cwd(), r.out)}  ${r.files} files, ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
}
