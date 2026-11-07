import { defineConfig } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export default defineConfig({
  resolve: {
    alias: { buffer: require.resolve('buffer/') },
  },
});
