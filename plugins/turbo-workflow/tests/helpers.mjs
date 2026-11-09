// Shared fixtures for the plugin's tests (not a test file).
export const validConfig = () => ({
  version: 1,
  packageManager: 'npm',
  git: { remote: 'origin', baseBranch: 'main', protected: ['main'] },
  tracker: { type: 'none' },
  autofix: 'none',
  specsDir: 'docs/specs',
  apps: {
    web: {
      dir: 'apps/web',
      runner: 'Jest',
      coverage: 'npm run test:cov',
      e2e: false,
      planChanges: [],
      security: [],
      ui: ['src/**'],
    },
  },
  shared: ['packages/ui'],
});
