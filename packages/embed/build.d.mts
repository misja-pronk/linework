/** Builds dist/ and returns the files written with their sizes, raw and gzipped. */
export function buildEmbed(): Promise<{ name: string; bytes: number; gzip: number }[]>;
/** The one-file build as text (built first when it is not there yet). */
export function standaloneScript(): Promise<string>;
