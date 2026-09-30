// File type → CodeMirror language
import { StreamLanguage } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import { php } from '@codemirror/lang-php';
import { csharp, kotlin, scala, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { r } from '@codemirror/legacy-modes/mode/r';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';

const sl = m => () => StreamLanguage.define(m);

// id: [display name, factory, extensions]
export const LANGS = {
  markdown: ['Markdown', () => markdown({ base: markdownLanguage, codeLanguages: codeLang }), ['md', 'markdown', 'mdown', 'mkd', 'mdx']],
  text: ['Текст', null, ['txt', 'text', 'log', 'nfo', 'me', '']],
  javascript: ['JavaScript', () => javascript({ jsx: true }), ['js', 'mjs', 'cjs', 'jsx']],
  typescript: ['TypeScript', () => javascript({ typescript: true, jsx: true }), ['ts', 'tsx', 'mts', 'cts']],
  json: ['JSON', () => json(), ['json', 'jsonc', 'json5', 'webmanifest', 'har', 'ipynb']],
  html: ['HTML', () => html(), ['html', 'htm', 'xhtml', 'vue', 'svelte', 'cshtml', 'razor']],
  css: ['CSS', () => css(), ['css', 'scss', 'less', 'sass']],
  python: ['Python', () => python(), ['py', 'pyw', 'pyi']],
  xml: ['XML', () => xml(), ['xml', 'svg', 'csproj', 'vbproj', 'fsproj', 'props', 'targets', 'xaml', 'config', 'resx', 'plist', 'nuspec', 'manifest', 'xsd', 'xsl', 'wsdl', 'rss', 'atom', 'fb2']],
  sql: ['SQL', () => sql(), ['sql', 'ddl', 'dml']],
  yaml: ['YAML', () => yaml(), ['yaml', 'yml']],
  cpp: ['C / C++', () => cpp(), ['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hh', 'hxx', 'ino', 'cu']],
  java: ['Java', () => java(), ['java']],
  rust: ['Rust', () => rust(), ['rs']],
  php: ['PHP', () => php(), ['php', 'phtml']],
  csharp: ['C#', sl(csharp), ['cs', 'csx']],
  kotlin: ['Kotlin', sl(kotlin), ['kt', 'kts']],
  scala: ['Scala', sl(scala), ['scala', 'sc']],
  dart: ['Dart', sl(dart), ['dart']],
  objc: ['Objective-C', sl(objectiveC), ['m', 'mm']],
  go: ['Go', sl(go), ['go']],
  shell: ['Shell', sl(shell), ['sh', 'bash', 'zsh', 'fish', 'ksh', 'bashrc', 'profile', 'env']],
  powershell: ['PowerShell', sl(powerShell), ['ps1', 'psm1', 'psd1']],
  batch: ['Batch', null, ['bat', 'cmd']],
  ini: ['INI', sl(properties), ['ini', 'cfg', 'conf', 'properties', 'reg', 'inf', 'editorconfig', 'gitconfig', 'desktop']],
  toml: ['TOML', sl(toml), ['toml']],
  lua: ['Lua', sl(lua), ['lua']],
  ruby: ['Ruby', sl(ruby), ['rb', 'rake', 'gemspec']],
  swift: ['Swift', sl(swift), ['swift']],
  diff: ['Diff', sl(diff), ['diff', 'patch']],
  dockerfile: ['Dockerfile', sl(dockerFile), ['dockerfile']],
  nginx: ['Nginx', sl(nginx), ['nginx']],
  r: ['R', sl(r), ['r']],
  perl: ['Perl', sl(perl), ['pl', 'pm']],
  vb: ['Visual Basic', sl(vb), ['vb', 'vbs', 'bas']],
  pascal: ['Pascal', sl(pascal), ['pas', 'dpr', 'pp', 'lpr']],
  haskell: ['Haskell', sl(haskell), ['hs']],
  erlang: ['Erlang', sl(erlang), ['erl']],
  clojure: ['Clojure', sl(clojure), ['clj', 'cljs', 'edn']],
  cmake: ['CMake', sl(cmake), ['cmake']],
  fortran: ['Fortran', sl(fortran), ['f', 'f90', 'f95', 'for']],
};

const BY_EXT = new Map();
for (const [id, [, , exts]] of Object.entries(LANGS)) for (const e of exts) if (!BY_EXT.has(e)) BY_EXT.set(e, id);

const SPECIAL = { dockerfile: 'dockerfile', makefile: 'shell', 'cmakelists.txt': 'cmake', '.gitignore': 'ini', '.env': 'shell', 'readme': 'markdown', 'license': 'text' };

export function langForPath(path) {
  if (!path) return 'markdown';
  const base = path.split(/[\\/]/).pop().toLowerCase();
  if (SPECIAL[base]) return SPECIAL[base];
  const i = base.lastIndexOf('.');
  const ext = i > 0 ? base.slice(i + 1) : (base.startsWith('.') ? base.slice(1) : '');
  return BY_EXT.get(ext) || (i < 0 ? 'text' : 'text');
}

export const isProse = id => id === 'markdown' || id === 'text';

const cache = new Map();
export function langExtension(id, mdInTxt = true) {
  if (id === 'text' && mdInTxt) id = 'markdown';
  const def = LANGS[id];
  if (!def || !def[1]) return [];
  if (!cache.has(id)) {
    try { cache.set(id, def[1]()); } catch (e) { console.warn(e); cache.set(id, []); }
  }
  return cache.get(id);
}

export const langName = id => LANGS[id]?.[0] || id;

// Code blocks inside markdown (```lang)
const FENCE = { js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript', json: 'json', html: 'html', css: 'css', py: 'python', python: 'python', xml: 'xml', sql: 'sql', yaml: 'yaml', yml: 'yaml', c: 'cpp', cpp: 'cpp', 'c++': 'cpp', java: 'java', rust: 'rust', rs: 'rust', php: 'php', cs: 'csharp', csharp: 'csharp', 'c#': 'csharp', go: 'go', sh: 'shell', bash: 'shell', shell: 'shell', zsh: 'shell', powershell: 'powershell', ps1: 'powershell', pwsh: 'powershell', ini: 'ini', toml: 'toml', lua: 'lua', ruby: 'ruby', rb: 'ruby', swift: 'swift', diff: 'diff', kotlin: 'kotlin', kt: 'kotlin', dockerfile: 'dockerfile', docker: 'dockerfile' };
function codeLang(info) {
  const id = FENCE[String(info).trim().toLowerCase()];
  if (!id || id === 'markdown') return null;
  const ext = langExtension(id);
  if (!ext || Array.isArray(ext)) return null;
  return ext.language || (ext.parser ? ext : null);
}
