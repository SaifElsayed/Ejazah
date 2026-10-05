// How a syntax rule reads the words in a name (T040).
//
// `sec/no-body-logging` (R-SEC-2) and `money/no-number-in-money-position` (R-MONEY-1) both decide
// from what a name says: `refreshToken`, `refresh_token` and `REFRESH_TOKEN` are one name, and so
// are `pricePiasters` and `price_piasters`. A name is split on camelCase humps and on every run of
// characters that is not a letter or a digit, and compared lower-case.
//
// Words are compared whole, never as substrings: `tokenize` is not `token` and `network` is not
// `net`. A trailing "s" is dropped on request so a plural reads as its singular.
//
// `boundaries/no-money-vocabulary` (T035) splits names the same way inside its own file; that file
// belongs to its own task and is left as it is.

/** The lower-case words of a name: `gatewayFeePiasters` -> `['gateway', 'fee', 'piasters']`. */
function wordsOf(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/** The words of a name as a set, each also in its singular, so `tokens` answers to `token`. */
function wordSetOf(name) {
  const words = new Set();
  for (const word of wordsOf(name)) {
    words.add(word);
    if (word.length > 1 && word.endsWith('s')) words.add(word.slice(0, -1));
  }
  return words;
}

/** True when the set carries at least one of the given words. */
function hasAny(words, candidates) {
  for (const candidate of candidates) {
    if (words.has(candidate)) return true;
  }
  return false;
}

module.exports = { hasAny, wordSetOf, wordsOf };
