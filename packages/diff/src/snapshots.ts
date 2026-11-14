// Where snapshots of a diagram live as files: next to it, <name>.snapshots/<label>.yaml, the label
// made safe for a file name. The editor writes them, `linework diff --snapshot <label>` reads them.

/** A label as a file name: letters, digits, dot, dash and underscore; the rest becomes a dash. */
export function snapshotSlug(label: string): string {
  return (
    label
      .trim()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '')
      .slice(0, 80) || 'snapshot'
  );
}

/** The folder of a diagram's snapshots: shop.yaml → shop.snapshots/ (next to it). */
export const snapshotDir = (diagram: string) => diagram.replace(/\.ya?ml$/i, '') + '.snapshots/';
export const snapshotPath = (diagram: string, label: string) => `${snapshotDir(diagram)}${snapshotSlug(label)}.yaml`;
/** A path inside some diagram's snapshots folder: not a diagram of its own. */
export const isSnapshotPath = (path: string) => /(^|[/\\])[^/\\]+\.snapshots[/\\]/.test(path);
