import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify } from '../scripts/changed-apps.mjs';
import { validConfig } from './helpers.mjs';

const config = () => ({
  ...validConfig(),
  apps: {
    web: { ...validConfig().apps.web, dir: 'apps/web' },
    'web-admin': { ...validConfig().apps.web, dir: 'apps/web-admin' },
  },
  shared: ['packages/ui', 'pnpm-workspace.yaml'],
});

test('counts an app file', () => {
  assert.deepEqual(classify(['apps/web/src/a.ts'], config()), {
    apps: ['web'],
    rebuild: false,
    noApp: false,
  });
});

test('ignores <dir>/.claude and *.md', () => {
  assert.deepEqual(
    classify(
      [
        'apps/web/.claude/rules/coding.md',
        'apps/web/.claude/x.json',
        'apps/web/README.md',
      ],
      config(),
    ),
    { apps: [], rebuild: false, noApp: true },
  );
});

test('shared path counts every app and sets rebuild', () => {
  assert.deepEqual(classify(['packages/ui/src/button.ts'], config()), {
    apps: ['web', 'web-admin'],
    rebuild: true,
    noApp: false,
  });
  assert.equal(classify(['pnpm-workspace.yaml'], config()).rebuild, true);
});

test('does not match a dir prefix', () => {
  assert.deepEqual(classify(['apps/web-admin/x.ts'], config()).apps, [
    'web-admin',
  ]);
  assert.deepEqual(classify(['packages/ui-kit/x.ts'], config()).apps, []);
});

test('no app', () => {
  assert.deepEqual(
    classify(['.github/workflows/ci.yml', 'docs/x.ts'], config()),
    {
      apps: [],
      rebuild: false,
      noApp: true,
    },
  );
});
