// Access exports (az role assignments, Microsoft Graph, AzureHound) and saved `gh api` responses, picked,
// dropped on the page or found in the open folder, become one access or GitHub diagram, as
// `carto import <folder>` makes it. Nothing leaves the browser, and nothing is fetched.
import { importAccess, importGithub, isAccessExport, isGithubExport, type ExportFile, type ImportedExport } from '@cartography/import';

export type ExportKind = 'access' | 'github';

export interface Exported extends ImportedExport {
  kind: ExportKind;
  /** Where the diagram goes in a folder: access.yaml or github.yaml. */
  file: string;
}

/** What these files are, by what most of their JSON is: gh api responses, or access exports. Nothing when neither. */
export function exportKind(files: ExportFile[]): ExportKind | undefined {
  let github = 0;
  let access = 0;
  for (const f of files) {
    if (!/\.json$/i.test(f.path) || /\.layout\.json$/i.test(f.path)) continue;
    if (isGithubExport(f.text)) github++;
    else if (isAccessExport(f.text)) access++;
  }
  return github > access ? 'github' : access ? 'access' : undefined;
}

/** The diagram of these files; nothing when they are not access exports or gh api responses. */
export function exportFrom(files: ExportFile[], options: { existing?: string; title?: string } = {}): Exported | undefined {
  const kind = exportKind(files);
  if (!kind) return undefined;
  const input = files.filter((f) => (/\.json$/i.test(f.path) && !/\.layout\.json$/i.test(f.path)) || /(^|\/)codeowners$/i.test(f.path));
  const r = kind === 'github' ? importGithub(input, options) : importAccess(input, options);
  return { ...r, kind, file: `${kind}.yaml` };
}

/** Everything an import has to say, problems first: the toast says the first, the problems list shows them all. */
export const exportNotes = (r: ImportedExport): string[] => [
  ...r.problems.map((p) => (p.file ? `${p.file}: ${p.message}` : p.message)),
  ...r.warnings,
  ...r.skipped.filter((k) => !r.problems.some((p) => p.file === k.file)).map((k) => `${k.file}: left out, ${k.why}`),
];

/** The first thing worth saying of an import besides what it holds: a problem, else a warning, else a file left out. */
export const exportRemark = (r: ImportedExport): string => {
  const [first, ...more] = exportNotes(r);
  return first ? `. ${first}${more.length ? ` (and ${more.length} more)` : ''}` : '';
};
