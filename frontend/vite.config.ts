import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = process.env.VITE_API_URL || env.VITE_API_URL || '';
  // The Google Client ID is a public identifier: Google requires the browser to present it, and
  // it grants nothing on its own. No secret belongs in this block — everything defined here is
  // inlined into the shipped bundle and readable by anyone.
  const googleClientId = process.env.VITE_GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || '';
  return {
    plugins: [react()],
    define: {
      'process.env.VITE_API_URL': JSON.stringify(apiUrl),
      'process.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(googleClientId),
    },
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_URL || 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  };
});
