import type { Page } from '@playwright/test';
import { GitHubFalso, type OpcionesFalso } from '../fixtures/githubFalso';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, PUT, POST, PATCH, OPTIONS',
  'access-control-expose-headers': 'etag, x-ratelimit-remaining, x-ratelimit-reset',
};

/** Conecta la página a un GitHub simulado y bloquea cualquier otra red externa. */
export async function conGitHubFalso(page: Page, opciones: OpcionesFalso = {}): Promise<GitHubFalso> {
  const falso = new GitHubFalso({ owner: 'yo', repo: 'datos', ...opciones });
  await page.route(
    (url) => url.hostname !== 'localhost',
    async (route) => {
      const req = route.request();
      if (new URL(req.url()).hostname !== 'api.github.com') return route.abort();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const r = falso.manejar({ metodo: req.method(), url: req.url(), cabeceras: await req.allHeaders(), cuerpo: req.postData() ?? undefined });
      if (r === 'sin-conexion') return route.abort('internetdisconnected');
      return route.fulfill({ status: r.status, headers: { ...CORS, ...r.cabeceras }, body: r.cuerpo });
    },
  );
  return falso;
}

export async function configurar(page: Page, token = 'tk') {
  await page.addInitScript((t) => {
    if (!localStorage.getItem('kyl.ajustes')) {
      localStorage.setItem('kyl.ajustes', JSON.stringify({ owner: 'yo', repo: 'datos', rama: 'main', token: t }));
    }
  }, token);
}
