// T022 fixture support — the translation lookup a feature file is supposed to use. Fixtures for
// R-MOBILE-7 and R-MOBILE-8 need a real `t` to reference so the violation is the concatenation
// and the literal, not a missing import.
export declare function t(key: string, values?: Readonly<Record<string, string>>): string;
