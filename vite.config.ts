import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Ruta base de GitHub Pages: https://<usuario>.github.io/<repo>/
// Si se renombra el repositorio, basta con cambiar BASE_PATH en el workflow.
const base = process.env.BASE_PATH ?? '/Web-personal/';

// CSP estricta solo en producción: el servidor de desarrollo de Vite
// inyecta scripts en línea que la romperían. GitHub Pages no permite
// cabeceras HTTP, así que va en una etiqueta <meta>.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'kyl-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), cspPlugin()],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
