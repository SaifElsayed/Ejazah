// T022 fixture support — the shared primitives a feature file is supposed to compose
// (R-MOBILE-6). Declarations only: a fixture needs a name to import, not a renderer, and
// `design/` is the one place a colour may live so nothing here carries one.
export interface PrimitiveProps {
  readonly className?: string;
  readonly value?: string;
  readonly children?: unknown;
}

export declare function Screen(props: PrimitiveProps): unknown;
export declare function Text(props: PrimitiveProps): unknown;
export declare function Field(props: PrimitiveProps): unknown;
