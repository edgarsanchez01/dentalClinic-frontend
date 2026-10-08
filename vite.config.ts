import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Stack oficial: Architecture.md 5.2 (React + TypeScript estricto + Vite + Tailwind).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // El cliente HTTP central (Architecture.md 14.4) usara VITE_API_BASE_URL.
      // El proxy solo existe para que el shell tecnico pueda consultar
      // /actuator/health sin CORS en desarrollo.
      proxy: {
        '/actuator': { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});