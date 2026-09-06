// Root re-export so editors and `pnpm exec prettier` find the workspace formatter
// configuration without a per-package copy. The options live in packages/config (T003).
module.exports = require('./packages/config/prettier.config.js');
