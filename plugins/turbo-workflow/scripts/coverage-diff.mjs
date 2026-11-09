#!/usr/bin/env node
// Coverage baseline + diff for the test report.
//
//   node <plugin>/scripts/coverage-diff.mjs snapshot <out.json>
//     Save coverage/coverage-summary.json with repo-relative paths.
//
//   node <plugin>/scripts/coverage-diff.mjs diff <baseline.json> [file ...]
//     Print the report's Coverage table: rows for the given files (default: every
//     file whose numbers changed or that is new), then the drop warnings.
//
// Run from the app directory, after the app's `coverage` command in
// .claude/workflow.json, which writes coverage/coverage-summary.json with a
// json-summary reporter (Vitest: --coverage.reporter=json-summary,
// Jest: --coverageReporters=json-summary).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const SUMMARY = resolve('coverage/coverage-summary.json');

function load(path) {
  if (!existsSync(path)) {
    console.error(
      `Not found: ${path}. Run from the app directory, after the app's \`coverage\` command in .claude/workflow.json ` +
        '(Vitest: --coverage.reporter=json-summary, Jest: --coverageReporters=json-summary).',
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function relativize(summary) {
  const out = {};
  for (const [key, value] of Object.entries(summary)) {
    out[key === 'total' ? 'total' : relative(process.cwd(), key)] = value;
  }
  return out;
}

const fmt = (n) => `${Number(n.toFixed(2))}%`;
const delta = (d) =>
  d === 0 ? '0' : `${d > 0 ? '+' : ''}${Number(d.toFixed(2))}`;

const [cmd, arg, ...files] = process.argv.slice(2);

if (cmd === 'snapshot' && arg) {
  writeFileSync(arg, JSON.stringify(relativize(load(SUMMARY)), null, 2) + '\n');
  console.log(`Baseline saved to ${arg}`);
} else if (cmd === 'diff' && arg) {
  const base = load(arg);
  const now = relativize(load(SUMMARY));
  const changed = (f) =>
    !base[f] || METRICS.some((m) => base[f][m].pct !== now[f][m].pct);
  const targets = files.length
    ? files
        .map((f) => relative(process.cwd(), resolve(f)))
        .filter((f) => now[f])
    : Object.keys(now).filter((f) => f !== 'total' && changed(f));
  const notCovered = files.length
    ? files
        .map((f) => relative(process.cwd(), resolve(f)))
        .filter((f) => !now[f])
    : [];

  const rows = ['total', ...targets.filter((f) => f !== 'total')];
  console.log('| File | Statements | Branches | Functions | Lines |');
  console.log('| --- | --- | --- | --- | --- |');
  const drops = [];
  for (const f of rows) {
    const cells = METRICS.map((m) => {
      const after = now[f][m].pct;
      if (!base[f]) return fmt(after);
      const before = base[f][m].pct;
      if (after < before)
        drops.push(`${f} ${m} ${fmt(before)} → ${fmt(after)}`);
      return `${fmt(before)} → ${fmt(after)} (${delta(after - before)})`;
    });
    if (!base[f]) cells[3] += ' (no baseline)';
    console.log(
      `| ${f === 'total' ? '**Total**' : '`' + f + '`'} | ${cells.join(' | ')} |`,
    );
  }
  console.log('');
  console.log('Coverage drops (warning only, not a failure):');
  console.log(drops.length ? drops.map((d) => `- ${d}`).join('\n') : '- none');
  if (notCovered.length) {
    console.log('');
    console.log(
      'Changed files not measured (outside the coverage include, or not imported by any test):',
    );
    console.log(notCovered.map((f) => `- \`${f}\``).join('\n'));
  }
} else {
  console.error(
    'Usage: coverage-diff.mjs snapshot <out.json> | diff <baseline.json> [file ...]',
  );
  process.exit(2);
}
