// Which YAML files are Cartography diagrams: a `*.carto.yaml` name, or a top-level `type:` naming
// one of the engine's types (or `model`). Plain text work, so it runs on every open without parsing.

/** The value of the first top-level `type:` line, quotes and comment removed. */
export function typeLine(text: string): string | undefined {
  const m = /^type:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#][^#\n]*?))[ \t]*(?:#.*)?$/m.exec(text);
  return m ? (m[1] ?? m[2] ?? m[3])?.trim() : undefined;
}

export const isCartoName = (fileName: string) => /\.carto\.ya?ml$/i.test(fileName);

/** A diagram by its name, or by a `type:` the engine knows. `ids` are the type ids (`model` is added). */
export function isDiagram(fileName: string, text: string, ids: readonly string[]): boolean {
  if (isCartoName(fileName)) return true;
  if (!/\.ya?ml$/i.test(fileName) && !/^untitled:/i.test(fileName)) return false;
  const t = typeLine(text);
  return !!t && (t === 'model' || ids.includes(t));
}

/** The sidecar with hand-placed positions, as the CLI and the web app name it: a.yaml → a.layout.json. */
export const sidecarName = (file: string) => file.replace(/\.ya?ml$/i, '') + '.layout.json';
