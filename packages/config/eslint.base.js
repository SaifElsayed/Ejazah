// Two rule sets, split by what they need (research R-10):
//   fast      - syntax only; editor and pre-commit hook
//   typeAware - needs the program; pipeline only
// Both consume the internal plugin, in which every rule is named for a constitution rule
// and every message ends with that identifier (FR-011). Wired fully by T004 and T043.
const ijazah = require('./eslint-plugin-ijazah');
const boundaries = require('./eslint.boundaries');

const fast = [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.expo/**', '**/coverage/**'] },
  ...boundaries,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { ijazah },
    rules: ijazah.configs.fast.rules,
  },
];

const typeAware = [
  ...fast,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: { ijazah },
    rules: ijazah.configs.typeAware.rules,
  },
];

module.exports = { fast, typeAware };
