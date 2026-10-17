// The primitive contracts (ARCHITECTURE §6.3, docs/design/components.md, ADR 0020). Features
// compose primitives; they do not build buttons (R-MOBILE-6). Every file here is a contract: the
// props a primitive accepts and the decisions it refuses to delegate. The components themselves
// arrive with Phase 1 and are implemented against these types.
export type * from './types';
export type * from './Text';
export type * from './Icon';
export type * from './Button';
export type * from './Selection';
export type * from './Status';
export type * from './Containers';
export type * from './Forms';
export type * from './Progress';
export type * from './Overlays';
export type * from './Chrome';
