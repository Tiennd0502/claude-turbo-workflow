import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'coverage-diff.mjs');

const metrics = (pct) =>
  Object.fromEntries(
    ['statements', 'branches', 'functions', 'lines'].map((m) => [
      m,
      { total: 10, covered: pct / 10, pct },
    ]),
  );

function writeSummary(dir, files) {
  const summary = { total: metrics(files.total) };
  for (const [name, pct] of Object.entries(files))
    if (name !== 'total') summary[join(dir, name)] = metrics(pct);
  writeFileSync(
    join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify(summary),
  );
}

test('snapshot then diff shows a drop and a new file', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tw-cov-')));
  mkdirSync(join(dir, 'coverage'));
  const run = (...args) =>
    execFileSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });

  writeSummary(dir, { total: 80, 'src/a.ts': 90 });
  assert.match(run('snapshot', 'base.json'), /Baseline saved to base\.json/);
  assert.ok(
    JSON.parse(readFileSync(join(dir, 'base.json'), 'utf8'))['src/a.ts'],
  );

  writeSummary(dir, { total: 75, 'src/a.ts': 50, 'src/b.ts': 100 });
  const out = run('diff', 'base.json');
  assert.match(
    out,
    /^\| File \| Statements \| Branches \| Functions \| Lines \|$/m,
  );
  assert.match(out, /\| \*\*Total\*\* \| 80% → 75% \(-5\) \|/);
  assert.match(out, /\| `src\/a\.ts` \| 90% → 50% \(-40\) \|/);
  assert.match(
    out,
    /\| `src\/b\.ts` \| 100% \| 100% \| 100% \| 100% \(no baseline\) \|/,
  );
  assert.match(out, /- src\/a\.ts statements 90% → 50%/);
});

test('names the changed files no test measures', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tw-cov-')));
  mkdirSync(join(dir, 'coverage'));
  writeSummary(dir, { total: 80, 'src/a.ts': 90 });
  execFileSync('node', [SCRIPT, 'snapshot', 'base.json'], { cwd: dir });
  const out = execFileSync(
    'node',
    [SCRIPT, 'diff', 'base.json', 'src/a.ts', 'src/c.ts'],
    {
      cwd: dir,
      encoding: 'utf8',
    },
  );
  assert.match(out, /Changed files not measured[^\n]*\n- `src\/c\.ts`/);
});

test('missing summary names the coverage command, not a package manager', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tw-cov-')));
  let stderr = '';
  try {
    execFileSync('node', [SCRIPT, 'snapshot', 'base.json'], {
      cwd: dir,
      stdio: 'pipe',
    });
  } catch (error) {
    stderr = error.stderr.toString();
  }
  assert.match(stderr, /Not found: .*coverage-summary\.json/);
  assert.match(stderr, /coverage/);
  assert.doesNotMatch(stderr, /pnpm/);
});
