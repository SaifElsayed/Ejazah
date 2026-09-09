// boundaries/no-money-vocabulary  ->  R-MONEY-6  (fast)
//
// R-MONEY-6 as ADR 0007 redefines it (FR-016). The platform never holds money: the student pays
// the gateway, the gateway deducts its fee and settles the net straight to the teacher, and the
// platform keeps records only. Two prohibitions follow, and this one rule carries both, so each
// message says which half broke.
//
//   (a) vocabulary, refused ANYWHERE — wallet, ledger, balance, escrow and platform-held-funds
//       words. There is no account to credit and no balance to compute, so a name carrying one of
//       these describes a system this one is not. T023's fixture: booking/wallet-ledger.ts.
//   (b) confinement, refused OUTSIDE modules/payments and platform/ports/payment — the gateway's
//       order, gross, fee and net. Money-carrying records live in those two folders; every other
//       module speaks to the port or to the payments module's public entry and never reads an
//       amount. T023's fixture: sessions/gateway-settlement.ts.
//
// `payout` on its own is legal: a teacher payout account is part of the ADR 0007 model, and
// `teacher_profiles.payout_verified_at` is the discovery gate. It is in neither list.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js`. The word lists live in `packages/config/eslint.boundaries.js` and
// reach this rule through flat-config `settings`.
//
// WHAT IS READ, and what is deliberately not (note under T035). Identifiers, property names and
// import specifiers, never comments or prose: the word "balance" in a sentence explaining why
// there is no balance must not fail a build, and this file, the contract and several READMEs are
// full of exactly that. String literals are read only where one names a thing rather than says
// something — a computed member access (`db['wallets']`) or a quoted property key — which is the
// "table access" half of the note and keeps a configured word list, including the one below, from
// reporting itself.
//
// Half (b) reads identifiers and property names only, never a string literal: `it.todo('a
// duplicate payments.gateway_order_id is refused')` in `tests/db-integrity/` describes a
// constraint, and describing where money lives is not reading an amount.
//
// Names are split into words on camelCase and on any non-alphanumeric run, compared lowercase, so
// `grossPiasters`, `gross_piasters` and `GROSS_PIASTERS` read alike. A trailing "s" is stripped
// when the singular is a listed word, because `wallets` is the table a `wallet` concept creates.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');

const DEFAULTS = {
  // (a) Refused anywhere. A term of several words matches when the name carries all of them.
  bannedVocabulary: ['wallet', 'ledger', 'balance', 'escrow', 'held_funds', 'platform_funds'],
  // (b) Refused outside the two folders below.
  gatewayAmountWords: ['gross', 'fee', 'net'],
  amountMarkerWords: ['piasters', 'amount', 'total', 'cents'],
  gatewayAmountIdentifiers: [
    'gross_piasters',
    'fee_piasters',
    'net_piasters',
    'gatewayOrderId',
    'gateway_order_id',
    'order_amount',
  ],
  paymentFolders: ['apps/api/src/modules/payments', 'apps/api/src/platform/ports/payment'],
};

function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return {
    bannedVocabulary: configured.bannedVocabulary ?? DEFAULTS.bannedVocabulary,
    gatewayAmountWords: configured.gatewayAmountWords ?? DEFAULTS.gatewayAmountWords,
    amountMarkerWords: configured.amountMarkerWords ?? DEFAULTS.amountMarkerWords,
    gatewayAmountIdentifiers:
      configured.gatewayAmountIdentifiers ?? DEFAULTS.gatewayAmountIdentifiers,
    paymentFolders: configured.paymentFolders ?? DEFAULTS.paymentFolders,
  };
}

function segmentsOf(value) {
  return String(value)
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.');
}

function containsSegments(segments, needle) {
  for (let start = 0; start + needle.length <= segments.length; start += 1) {
    if (needle.every((part, offset) => segments[start + offset] === part)) return true;
  }
  return false;
}

function wordsOf(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/** Every word of a name, plus the singular of each, so `wallets` reads as `wallet`. */
function wordSetOf(name) {
  const set = new Set();
  for (const word of wordsOf(name)) {
    set.add(word);
    if (word.endsWith('s')) set.add(word.slice(0, -1));
  }
  return set;
}

/** A configured term, kept beside the words it is made of, so the report can quote it as written. */
function termsOf(configured) {
  return configured.map((term) => ({ term, words: wordsOf(term) }));
}

function matchingTerm(wordSet, terms) {
  return terms.find(({ words }) => words.length > 0 && words.every((word) => wordSet.has(word)));
}

function matchingWord(wordSet, configured) {
  return configured.find((word) => wordSet.has(String(word).toLowerCase()));
}

module.exports = defineRule({
  constitutionId: 'R-MONEY-6',
  description:
    'Bans held-funds vocabulary anywhere, and gateway amounts outside the payments module and the payment port',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011). Each message names which
    // of the two halves this identifier carries was broken.
    vocabulary:
      '"{{name}}" carries "{{term}}" vocabulary — the platform holds no funds and computes no share, so there is nothing to credit, settle or reconcile anywhere in the applications (ADR 0007)',
    confinement:
      '"{{name}}" names a gateway amount outside the payments module and the payment port — money-carrying records live only there, and every other module speaks to the port or to the payments public entry rather than reading an amount (ADR 0007)',
  },
  create(context) {
    const configured = settingsFor(context);
    const vocabulary = termsOf(configured.bannedVocabulary);
    const gatewayIdentifiers = termsOf(configured.gatewayAmountIdentifiers);

    const fileSegments = segmentsOf(context.filename);
    const confined = configured.paymentFolders.some((folder) =>
      containsSegments(fileSegments, segmentsOf(folder)),
    );

    function isGatewayAmount(wordSet) {
      if (matchingTerm(wordSet, gatewayIdentifiers) !== undefined) return true;
      return (
        matchingWord(wordSet, configured.gatewayAmountWords) !== undefined &&
        matchingWord(wordSet, configured.amountMarkerWords) !== undefined
      );
    }

    /** @param {'both'|'vocabularyOnly'} halves — an import specifier is read for half (a) only. */
    function check(node, name, halves) {
      if (typeof name !== 'string' || name === '') return;
      const wordSet = wordSetOf(name);

      const found = matchingTerm(wordSet, vocabulary);
      if (found !== undefined) {
        context.report({ node, messageId: 'vocabulary', data: { name, term: found.term } });
        return;
      }

      if (halves !== 'both' || confined) return;
      if (!isGatewayAmount(wordSet)) return;
      context.report({ node, messageId: 'confinement', data: { name } });
    }

    // A quoted name: `{ 'wallet_id': … }`, `class X { 'wallet_id' = … }`, `db['wallets']`.
    // Anywhere else a string is prose or configuration, and prose is not a declaration.
    function isNamePosition(node) {
      const parent = node.parent;
      if (parent === null || parent === undefined) return false;
      if (parent.type === 'MemberExpression') return parent.computed && parent.property === node;
      return (
        (parent.type === 'Property' ||
          parent.type === 'PropertyDefinition' ||
          parent.type === 'MethodDefinition' ||
          parent.type === 'TSPropertySignature' ||
          parent.type === 'TSMethodSignature') &&
        parent.key === node
      );
    }

    function checkSpecifier(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      if (typeof sourceNode.value !== 'string') return;
      check(sourceNode, sourceNode.value, 'vocabularyOnly');
    }

    return {
      Identifier: (node) => check(node, node.name, 'both'),
      Literal: (node) => {
        if (typeof node.value === 'string' && isNamePosition(node)) {
          check(node, node.value, 'both');
        }
      },
      ImportDeclaration: (node) => checkSpecifier(node.source),
      ExportNamedDeclaration: (node) => checkSpecifier(node.source),
      ExportAllDeclaration: (node) => checkSpecifier(node.source),
      ImportExpression: (node) =>
        checkSpecifier(node.source.type === 'Literal' ? node.source : null),
    };
  },
});
