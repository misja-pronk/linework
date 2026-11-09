"""Cartography diagrams in MkDocs.

MkDocs is Python and Cartography is Node, so this hook does the plain thing: for every diagram in a
page it runs `carto embed --fragment` and puts the figure that comes back into the page. One process
per diagram, about a second each. No browser, no server.

In a page:

    ```cartography
    type: systems
    ...
    ```

    ![Web shop](diagrams/shop.yaml)
    ![Web shop](diagrams/shop.yaml#containers "interactive")

Set CARTO to the command when `carto` is not on the path, for example
CARTO="node --import tsx /path/to/cartography/packages/cli/src/main.ts".
"""

import logging
import os
import re
import shlex
import shutil
import subprocess

log = logging.getLogger('mkdocs.hooks.cartography')
CARTO = shlex.split(os.environ.get('CARTO', 'carto'))
# Where the built component lives, for diagrams marked interactive. Left out when it is not there.
COMPONENT = os.environ.get('CARTO_COMPONENT', os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'packages', 'embed', 'dist'))

FENCE = re.compile(r'^ {0,3}(```+|~~~+)[ \t]*([^\n`]*)$')
DIAGRAM = re.compile(r'(?:cartography|carto)(?:\s+(.*))?$')
CODE = re.compile(r'(`+[^`\n]*`+)')
IMAGE = re.compile(r'!\[([^\]]*)\]\(\s*([^)\s#]+\.ya?ml)(?:#([\w.-]+))?(?:\s+"([^"]*)")?\s*\)')
WORD = re.compile(r'(\w+)(?:=("[^"]*"|\S+))?')

# The figures of the page being built, by the placeholder that stands in for them while Markdown runs.
figures = {}


def flags(text):
    """`view=ordering theme=dark interactive` on a fence line or in an image's title."""
    args, interactive = [], False
    for name, value in WORD.findall(text or ''):
        value = value.strip('"')
        if name in ('view', 'theme', 'title') and value:
            args += ['--' + name, value]
        elif name == 'interactive':
            interactive = True
    return args + ([] if interactive else ['--static'])


def run(args, where, cwd, text=None):
    try:
        done = subprocess.run(CARTO + ['embed', '--fragment'] + args, cwd=cwd, input=text, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as problem:
        log.warning('%s: could not run %s: %s', where, ' '.join(CARTO), problem)
        return '<p role="alert">This diagram could not be drawn: the carto command did not run.</p>'
    # Problems come back on standard error with file, line and column; `mkdocs build --strict` stops on them.
    for line in done.stderr.strip().splitlines():
        log.warning('%s: %s', where, re.sub(r'\x1b\[[0-9;]*m', '', line))
    return done.stdout


def on_page_markdown(markdown, page, config, files):
    folder = os.path.dirname(page.file.abs_src_path)
    figures.clear()

    def keep(html):
        key = 'carto-figure-%d' % len(figures)
        figures[key] = html
        return '\n\n<div id="%s"></div>\n\n' % key

    def image(match, number):
        alt, target, view, title = match.groups()
        if re.match(r'[a-z][a-z0-9+.-]*:|//', target, re.I):
            return match.group(0)
        args = [os.path.normpath(os.path.join(folder, target))] + (['--view', view] if view else []) + (['--title', alt] if alt.strip() else [])
        return keep(run(args + flags(title), '%s:%d' % (page.file.src_path, number), folder))

    # Line by line, so that a diagram shown as an example inside a longer fence or in `code` stays text.
    out, lines, i = [], markdown.split('\n'), 0
    while i < len(lines):
        opening = FENCE.match(lines[i])
        if not opening:
            parts = CODE.split(lines[i])
            out.append(''.join(part if n % 2 else IMAGE.sub(lambda m: image(m, i + 1), part) for n, part in enumerate(parts)))
            i += 1
            continue
        marker, info = opening.group(1), opening.group(2).strip()
        end = i + 1
        while end < len(lines) and not re.match(r'^ {0,3}%s%s*[ \t]*$' % (re.escape(marker), re.escape(marker[0])), lines[end]):
            end += 1
        diagram = DIAGRAM.match(info)
        if diagram:
            out.append(keep(run(['-'] + flags(diagram.group(1)), '%s:%d' % (page.file.src_path, i + 1), folder, '\n'.join(lines[i + 1:end]) + '\n')))
        else:
            out.extend(lines[i:end + 1])
        i = end + 1
    return '\n'.join(out)


def on_page_content(html, page, config, files):
    for key, figure in figures.items():
        html = html.replace('<div id="%s"></div>' % key, figure)
    return html


def on_post_build(config):
    """The stylesheet that shows the light or the dark drawing, and the component for interactive diagrams."""
    target = os.path.join(config['site_dir'], 'carto')
    os.makedirs(target, exist_ok=True)
    try:
        css = subprocess.run(CARTO + ['embed', '--css'], capture_output=True, text=True, timeout=120).stdout
    except (OSError, subprocess.TimeoutExpired) as problem:
        log.warning('could not run %s: %s', ' '.join(CARTO), problem)
        css = ''
    with open(os.path.join(target, 'carto.css'), 'w', encoding='utf-8') as out:
        out.write(css)
    for name in ('carto-diagram.js', 'carto-engine.js'):
        source = os.path.join(COMPONENT, name)
        if os.path.exists(source):
            shutil.copy(source, os.path.join(target, name))
