import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // B8 (watch line under T018): `@ijazah/contracts` publishes its TypeScript source under the
  // `@ijazah/source` condition and its build under `dist/`, which nothing builds before the panel
  // does; naming the condition beside Vite's defaults resolves the source, as Vitest does.
  resolve: { conditions: ['@ijazah/source', ...defaultClientConditions] },
  server: { port: 5173 },
  // `tsc --build` owns `dist/` for this project's declarations and build info, and `vite build`
  // empties whatever directory it is given. The bundle therefore goes to `build/`, which
  // `.gitignore` already excludes, so the two outputs never fight over one directory.
  build: { outDir: 'build' },
});
