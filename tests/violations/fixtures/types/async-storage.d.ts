// T022 — a stand-in for `@react-native-async-storage/async-storage`, so the fixture program
// compiles. The R-MOBILE-10 fixture imports it to write a token outside the secure storage
// layer; the case is `fast` and never needs the type. Declared for the same reason as
// `temporal-polyfill.d.ts`: a fixture is broken by one lint rule, not by the compiler.
declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
  };
  export default AsyncStorage;
}
