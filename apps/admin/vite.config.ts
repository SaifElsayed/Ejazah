import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // `tsc --build` owns `dist/` for this project's declarations and build info, and `vite build`
  // empties whatever directory it is given. The bundle therefore goes to `build/`, which
  // `.gitignore` already excludes, so the two outputs never fight over one directory.
  build: { outDir: 'build' },
});
