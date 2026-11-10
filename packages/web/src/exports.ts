// Access exports (az role assignments, Microsoft Graph, AzureHound), saved `gh api` responses and Azure
// resources (az graph query, az bicep build, terraform show -json), picked, dropped on the page or found
// in the open folder, become one access, GitHub or Azure diagram, as
// `carto import <folder>` makes it. Nothing leaves the browser, and nothing is fetched.
import { importAccess, importAzure, importGithub, isAccessExport, isAzureContainers, isAzureExport, isGithubExport, type ExportFile, type ImportedExport } from '@cartography/import';

export type ExportKind = 'access' | 'github' | 'azure';

export interface Exported extends ImportedExport {
  kind: ExportKind;
  /** Where the diagram goes in a folder: access.yaml, github.yaml or azure.yaml. */
  file: string;
}

/** What these files are, by what most of their JSON is: gh api responses, access exports or Azure resources. Nothing when none. */
export function exportKind(files: ExportFile[]): ExportKind | undefined {
  let github = 0;
  let access = 0;
  let azure = 0;
  for (const f of files) {
    if (!/\.json$/i.test(f.path) || /\.layout\.json$/i.test(f.path)) continue;
    if (isAzureExport(f.text)) azure++;
    else if (isGithubExport(f.text)) github++;
    // Subscriptions and resource groups name what Azure resources are in, as much as whose roles are on them.
    else if (isAccessExport(f.text) && !isAzureContainers(f.text)) access++;
  }
  return azure > access && azure >= github ? 'azure' : github > access ? 'github' : access ? 'access' : undefined;
}

/** The diagram of these files; nothing when they are not access exports, gh api responses or Azure resources. */
export function exportFrom(files: ExportFile[], options: { existing?: string; title?: string } = {}): Exported | undefined {
  const kind = exportKind(files);
  if (!kind) return undefined;
  const input = files.filter((f) => /\.json$/i.test(f.path) || /(^|\/)codeowners$/i.test(f.path));
  const r = kind === 'azure' ? importAzure(input, options) : kind === 'github' ? importGithub(input, options) : importAccess(input, options);
  return { ...r, kind, file: `${kind}.yaml` };
}

/** The first thing worth saying of an import besides what it holds: a problem, else a warning. */
export const exportRemark = (r: ImportedExport): string => {
  const first = r.problems[0]?.message ?? r.warnings[0];
  const more = r.problems.length + r.warnings.length - 1;
  return first ? `. ${first}${more > 0 ? ` (and ${more} more)` : ''}` : '';
};
