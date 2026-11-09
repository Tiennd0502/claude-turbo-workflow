import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const TEMPLATE = join(
  import.meta.dirname,
  '..',
  'trackers',
  'trello',
  'trello.yml',
);
// The repo the plugin was built in; absent once the plugin lives in its own repo.
const ORIGINAL = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'trello.yml',
);

test(
  'template with the PR target filled in equals the original workflow',
  { skip: !existsSync(ORIGINAL) },
  () => {
    const filled = readFileSync(TEMPLATE, 'utf8').replaceAll(
      '__PR_TARGET__',
      'develop',
    );
    assert.equal(filled, readFileSync(ORIGINAL, 'utf8'));
  },
);

test('template has only the PR target placeholder', () => {
  const text = readFileSync(TEMPLATE, 'utf8');
  assert.deepEqual([...new Set(text.match(/__[A-Z_]+__/g))], ['__PR_TARGET__']);
  assert.doesNotMatch(text, /\bdevelop\b/);
});
