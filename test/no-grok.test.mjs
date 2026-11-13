import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The kit never offers, installs or requires Grok. The one allowed mention is the guide sentence saying so.
const root = fileURLToPath(new URL('..', import.meta.url));
const paths = ['src', 'bin', 'templates', 'manifests', 'install.sh', 'install.ps1', 'windows', 'README.md', 'docs'];
const allowed = 'Grok is not part of the teammate setup';
const files = path => {
  const full = join(root, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  return statSync(full).isDirectory() ? readdirSync(full).flatMap(name => files(join(path, name))) : [path];
};

test('the kit ships no Grok references outside the one guide sentence', () => {
  const found = [];
  for (const file of paths.flatMap(files)) {
    if (/(^|\/)package-lock\.json$/.test(file)) continue; // integrity hashes can contain any letters
    readFileSync(join(root, file), 'utf8').split('\n').forEach((line, i) => {
      if (/grok/i.test(line) && !(file === 'docs/user-guide.md' && line.includes(allowed))) found.push(`${relative('.', file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
