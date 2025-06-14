// vite.config.ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

const externalDependencies = [
  '@hashgraph/proto',
  '@hashgraph/sdk',
  'fs',
  'path',
  'url',
  'crypto',
];

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'HashgraphOnlineAgentKit',
      fileName: (format) => `index.${format}.js`,
      formats: ['es'],
    },
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      external: externalDependencies,
      output: {
        preserveModules: false,
        preserveModulesRoot: 'src'
      },
    },
    emptyOutDir: false,
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      outDir: 'dist',
      tsconfigPath: './tsconfig.json',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: externalDependencies,
  },
});
