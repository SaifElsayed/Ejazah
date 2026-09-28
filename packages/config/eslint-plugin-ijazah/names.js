// How a rule reads a name (T035, T040, T131).
//
// `boundaries/no-money-vocabulary` splits an identifier into words so `grossPiasters`,
// `gross_piasters` and `GROSS_PIASTERS` read alike; `sec/no-body-logging` and
// `money/no-number-in-money-position` need the same split for the same reason, so it lives here
// once. Words are compared lowercase.

/** `priceInPiasters` -> ['price', 'in', 'piasters']; `gross_piasters` -> ['gross', 'piasters']. */
function wordsOf(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

module.exports = { wordsOf };
