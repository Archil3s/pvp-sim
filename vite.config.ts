import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const buildId = `${Date.now()}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-build-meta',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-meta.json',
          source: JSON.stringify({ buildId }),
        });
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
