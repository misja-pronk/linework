// A small highlighter for the languages the docs use: YAML, shell, JSON and a little JavaScript.
// Three or four token kinds are enough to read code; anything else is shown plain.

export const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const span = (kind: string, s: string) => `<span class="t-${kind}">${escape(s)}</span>`;

/** Comments from # to the end of a line, outside quotes. */
function splitComment(line: string): [string, string] {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ''];
}

function values(s: string): string {
  // Strings, then keys inside flow maps ({ kind: user }), arrows, numbers.
  return s.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|([\w.-]+)(:)(?=\s|$)|(->|<->|--)|(\b\d+(?:\.\d+)?%?\b)|([^"'\w-]+|[\w.-]+)/g, (m, str, key, colon, arrow, num) => {
    if (str) return span('str', str);
    if (key) return span('key', key) + escape(colon);
    if (arrow) return span('op', arrow);
    if (num) return span('num', num);
    return escape(m);
  });
}

function yamlLine(line: string): string {
  const [code, comment] = splitComment(line);
  const m = /^(\s*(?:- )?)([^\s:{}[\],"'][^:{}[\],]*?|"[^"]*"|'[^']*')(:)(\s|$)(.*)$/.exec(code);
  const body = m ? escape(m[1]!) + span('key', m[2]!) + escape(m[3]!) + m[4] + values(m[5]!) : values(code);
  return body + (comment ? span('com', comment) : '');
}

function shellLine(line: string): string {
  const [code, comment] = splitComment(line);
  const m = /^(\s*)(\S+)(.*)$/.exec(code);
  const body = m ? escape(m[1]!) + span('cmd', m[2]!) + m[3]!.replace(/(\s--?[\w-]+)|("[^"]*"|'[^']*')|([^\s"']+|\s+)/g, (x, flag, str) => (flag ? span('flag', flag) : str ? span('str', str) : escape(x))) : escape(code);
  return body + (comment ? span('com', comment) : '');
}

function jsonLike(code: string): string {
  return code.replace(/(\/\/.*$)|("(?:[^"\\]|\\.)*")(\s*:)?|(\b(?:import|from|export|const|let|await|async|function|return|default|true|false|null)\b)|(\b\d+(?:\.\d+)?\b)|([^"/\w]+|[\w$]+|\/)/gm, (m, com, str, colon, kw, num) => {
    if (com) return span('com', com);
    if (str) return colon ? span('key', str) + escape(colon) : span('str', str);
    if (kw) return span('kw', kw);
    if (num) return span('num', num);
    return escape(m);
  });
}

export function highlight(code: string, lang: string): string {
  const l = lang.trim().split(/\s+/)[0]!.toLowerCase();
  const text = code.replace(/\n$/, '');
  let body: string;
  if (l === 'yaml' || l === 'yml') body = text.split('\n').map(yamlLine).join('\n');
  else if (l === 'sh' || l === 'bash' || l === 'shell' || l === 'console') body = text.split('\n').map(shellLine).join('\n');
  else if (['json', 'js', 'ts', 'javascript', 'typescript', 'mjs', 'jsx', 'tsx'].includes(l)) body = jsonLike(text);
  else body = escape(text);
  const label = l ? `<span class="code-lang">${escape(l)}</span>` : '';
  return `<pre class="code" data-lang="${escape(l)}">${label}<code>${body}\n</code></pre>`;
}
