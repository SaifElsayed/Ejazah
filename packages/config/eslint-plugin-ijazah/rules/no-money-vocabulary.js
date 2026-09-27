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
//   (b) confinement, refused OUTSIDE modules/payments, platform/ports/payment and packages/money —
//       the gateway's order, gross, fee and net. Money-carrying records live in the first two
//       folders, and packages/money is the money type's own package (R-MONEY-5); every other
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
// Half (b) reads identifiers, property names and quoted names, never a specifier and never prose:
// `it.todo('a duplicate payments.gateway_order_id is refused')` in `tests/db-integrity/` describes
// a constraint, and describing where money lives is not reading an amount. Half (a) is the half
// that reads a specifier, and it reads every syntax that names a module (`../specifiers.js`), so
// `require('./wallet-ledger')` and `import w = require('./wallet-ledger')` are refused alongside
// the `import`, `export … from` and `import()` forms.
//
// WHICH IDENTIFIERS half (b) confines (T035, review of PR #20): the ERD's own money columns on the
// `payments` row — `amount_piasters` (the gross), `gateway_fee_piasters`, `net_piasters` — plus any
// name pairing a gateway word with an amount marker. A gateway *order* reference is not an amount
// and is not confined: ARCHITECTURE hands the client a `CheckoutRef` carrying the order id, so
// `packages/contracts` and the checkout screen name it legitimately.
//
// Names are split into words on camelCase and on any non-alphanumeric run, compared lowercase, so
// `grossPiasters`, `gross_piasters` and `GROSS_PIASTERS` read alike. A trailing "s" is ignored on
// either side of the comparison, because `wallets` is the table a `wallet` concept creates and
// `heldFund` is the same idea as `held_funds`.
//
// WHERE IT REPORTS: at the binding, once — a declaration, a parameter, a property name, an import
// specifier — and not at every later use of a name already reported in the same file, because a
// build log listing one prohibition twenty times is a log nobody reads to the end. A name with no
// binding in the file (a member access, a type imported from elsewhere) is reported where it is
// written, which is the only place there is.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { onEverySpecifier, segmentsOf, settingsFor } = require('../specifiers');

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

/**
 * Both sides singular: the name's words carry their own singular already, and a configured word
 * is compared singular too, so `held_funds` catches `heldFund` the way it catches `fundsHeld`.
 */
function carries(wordSet, word) {
  const lower = String(word).toLowerCase();
  if (wordSet.has(lower)) return true;
  return lower.endsWith('s') && wordSet.has(lower.slice(0, -1));
}

/** A configured term, kept beside the words it is made of, so the report can quote it as written. */
function termsOf(configured) {
  return configured.map((term) => ({ term, words: wordsOf(term) }));
}

function matchingTerm(wordSet, terms) {
  return terms.find(
    ({ words }) => words.length > 0 && words.every((word) => carries(wordSet, word)),
  );
}

function matchingWord(wordSet, configured) {
  return configured.find((word) => carries(wordSet, word));
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
      '"{{name}}" names a gateway amount outside the payments module, the payment port and the money package — money-carrying records live only there, and every other module speaks to the port or to the payments public entry rather than reading an amount (ADR 0007)',
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

    // True where this name is declared, or nowhere in this file. A plain reference to a binding
    // the file already declares is skipped: the prohibition was reported at the declaration, and
    // repeating it at every use turns one wall into a wall of text.
    function isBindingOrUnbound(node) {
      const scope = context.sourceCode.getScope(node);
      const reference = scope.references.find((candidate) => candidate.identifier === node);
      if (reference === undefined) return true;

      const resolved = reference.resolved;
      if (resolved === null || resolved === undefined || resolved.defs.length === 0) return true;
      return resolved.identifiers.includes(node);
    }

    function checkName(node, name) {
      if (!isBindingOrUnbound(node)) return;
      check(node, name, 'both');
    }

    return {
      // Half (a) reads every syntax that names a module, the five path rules' list.
      ...onEverySpecifier(checkSpecifier),
      Identifier: (node) => checkName(node, node.name),
      // `<WalletBalance />` in a screen names the same banned concept as `const WalletBalance`.
      JSXIdentifier: (node) => checkName(node, node.name),
      Literal: (node) => {
        if (typeof node.value === 'string' && isNamePosition(node)) {
          check(node, node.value, 'both');
        }
      },
    };
  },
});
