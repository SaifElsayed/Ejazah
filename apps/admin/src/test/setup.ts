// The admin project's setup (B8): every render is removed after its test, and the panel's two
// stores start empty, so no test sees the language or the session another left behind.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
