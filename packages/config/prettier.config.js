// The single formatter configuration for the workspace (T003). Root `prettier.config.js`
// re-exports this file so editors and `pnpm exec prettier` resolve the same options.
// CommonJS on purpose: `@ijazah/config` declares no `type`, and the ESLint flat configs
// in this package are required() by the root configs.

/** @type {import('prettier').Config} */
module.exports = {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  semi: true,
  // The repository is developed on Windows and normalised by `.gitattributes` (`* text=auto eol=lf`).
  // Stating it here keeps a checkout with autocrlf from reformatting every line back and forth.
  endOfLine: 'lf',
};
