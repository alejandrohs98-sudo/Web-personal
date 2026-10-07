// Simulación en memoria de la parte de la API de GitHub que usa la app.
// Se usa en los tests unitarios (como fetch) y en Playwright (con page.route).
// Ninguna prueba toca la red real.
import { base64AUtf8, utf8ABase64 } from '../../src/util/base64';

export interface PeticionFalsa {
  metodo: string;
  url: string;
  cabeceras: Record<string, string>;
  cuerpo?: string;
}

export interface RespuestaFalsa {
  status: number;
  cabeceras: Record<string, string>;
  cuerpo?: string;
}

interface Commit {
  sha: string;
  arbol: string;
  padres: string[];
  mensaje: string;
}

let contador = 0;
function shaDe(texto: string): string {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return ((h >>> 0).toString(16).padStart(8, '0') + (contador++).toString(16).padStart(8, '0')).padEnd(40, '0');
}

export interface OpcionesFalso {
  owner?: string;
  repo?: string;
  privado?: boolean;
  /** Token aceptado. Si se omite, cualquier token vale. */
  token?: string;
  vacio?: boolean;
  archivos?: Record<string, string>;
}

export class GitHubFalso {
  owner: string;
  repo: string;
  privado: boolean;
  token?: string;
  archivos = new Map<string, { texto: string; sha: string }>();
  commits: Commit[] = [];
  arboles = new Map<string, Map<string, string>>();
  cabeza: string | null = null;
  peticiones: PeticionFalsa[] = [];
  /** Inyección de fallos para los tests. */
  sinConexion = false;
  /** Número de PUT que responderán 409 aunque el sha sea correcto. */
  conflictosForzados = 0;
  /** Se ejecuta antes de cada PUT (para simular que otro dispositivo escribe entre medias). */
  antesDePut?: (ruta: string) => void;

  constructor(o: OpcionesFalso = {}) {
    this.owner = o.owner ?? 'yo';
    this.repo = o.repo ?? 'datos';
    this.privado = o.privado ?? true;
    this.token = o.token;
    if (!o.vacio) {
      for (const [ruta, texto] of Object.entries(o.archivos ?? { 'README.md': '# datos\n' })) {
        this.archivos.set(ruta, { texto, sha: shaDe(texto) });
      }
      this.nuevoCommit('Initial commit', this.cabeza);
    }
  }

  get mensajes(): string[] {
    return this.commits.map((c) => c.mensaje);
  }

  leer(ruta: string): unknown {
    const a = this.archivos.get(ruta);
    return a ? JSON.parse(a.texto) : undefined;
  }

  /** Escribe directamente (como si fuera otro dispositivo). */
  escribirDirecto(ruta: string, texto: string, mensaje = 'otro dispositivo') {
    this.archivos.set(ruta, { texto, sha: shaDe(texto) });
    this.nuevoCommit(mensaje, this.cabeza);
  }

  private nuevoCommit(mensaje: string, padre: string | null) {
    const arbol = shaDe('arbol' + mensaje);
    this.arboles.set(arbol, new Map([...this.archivos].map(([r, a]) => [r, a.texto])));
    const sha = shaDe('commit' + mensaje);
    this.commits.push({ sha, arbol, padres: padre ? [padre] : [], mensaje });
    this.cabeza = sha;
  }

  fetch: typeof fetch = async (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const cabeceras: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (cabeceras[k.toLowerCase()] = v));
    const r = this.manejar({ metodo: init?.method ?? 'GET', url, cabeceras, cuerpo: init?.body as string | undefined });
    if (r === 'sin-conexion') throw new TypeError('Failed to fetch');
    return new Response(r.status === 304 ? null : r.cuerpo ?? null, { status: r.status, headers: r.cabeceras });
  };

  manejar(p: PeticionFalsa): RespuestaFalsa | 'sin-conexion' {
    if (this.sinConexion) return 'sin-conexion';
    this.peticiones.push(p);
    const u = new URL(p.url);
    const base = `/repos/${this.owner}/${this.repo}`;
    const auth = p.cabeceras['authorization'];
    const autenticado = !!auth && (!this.token || auth === `Bearer ${this.token}`);
    if (auth && !autenticado) return json(401, { message: 'Bad credentials' });
    if (!u.pathname.startsWith(base)) return json(404, { message: 'Not Found' });
    if (this.privado && !autenticado) return json(404, { message: 'Not Found' });
    const resto = decodeURIComponent(u.pathname.slice(base.length));
    const cuerpo = p.cuerpo ? JSON.parse(p.cuerpo) : undefined;
    const escribe = p.metodo !== 'GET';
    if (escribe && !autenticado) return json(401, { message: 'Requires authentication' });

    if (resto === '' && p.metodo === 'GET') {
      return json(200, {
        private: this.privado,
        size: this.cabeza ? 1 : 0,
        default_branch: 'main',
        permissions: { push: autenticado, pull: true },
      });
    }

    if (resto.startsWith('/contents/')) {
      const ruta = resto.slice('/contents/'.length);
      if (p.metodo === 'GET') return this.getContenido(ruta, p.cabeceras['if-none-match']);
      if (p.metodo === 'PUT') return this.putContenido(ruta, cuerpo);
    }

    if (resto.startsWith('/git/blobs/')) {
      const sha = resto.split('/').at(-1);
      const a = [...this.archivos.values()].find((x) => x.sha === sha);
      return a ? json(200, { sha, content: utf8ABase64(a.texto), encoding: 'base64' }) : json(404, { message: 'Not Found' });
    }

    if (resto === '/git/ref/heads/main' && p.metodo === 'GET') {
      if (!this.cabeza) return json(409, { message: 'Git Repository is empty.' });
      return json(200, { object: { sha: this.cabeza } });
    }
    if (resto.startsWith('/git/commits/') && p.metodo === 'GET') {
      const c = this.commits.find((x) => x.sha === resto.split('/').at(-1));
      return c ? json(200, { sha: c.sha, tree: { sha: c.arbol } }) : json(404, { message: 'Not Found' });
    }
    if (resto === '/git/trees' && p.metodo === 'POST') {
      const baseArbol = this.arboles.get(cuerpo.base_tree);
      if (!baseArbol) return json(422, { message: 'base_tree invalid' });
      const nuevo = new Map(baseArbol);
      for (const e of cuerpo.tree) nuevo.set(e.path, e.content);
      const sha = shaDe('arbol' + JSON.stringify([...nuevo]));
      this.arboles.set(sha, nuevo);
      return json(201, { sha });
    }
    if (resto === '/git/commits' && p.metodo === 'POST') {
      const sha = shaDe('commit' + cuerpo.message);
      // El commit no es visible en la rama hasta el PATCH del ref.
      this.sueltos.set(sha, { sha, arbol: cuerpo.tree, padres: cuerpo.parents, mensaje: cuerpo.message });
      return json(201, { sha });
    }
    if (resto === '/git/refs/heads/main' && p.metodo === 'PATCH') {
      const c = this.sueltos.get(cuerpo.sha);
      if (!c) return json(422, { message: 'Object does not exist' });
      if (c.padres[0] !== this.cabeza) return json(422, { message: 'Update is not a fast forward' });
      this.commits.push(c);
      this.cabeza = c.sha;
      this.archivos.clear();
      for (const [ruta, texto] of this.arboles.get(c.arbol)!) this.archivos.set(ruta, { texto, sha: shaDe(texto) });
      return json(200, { object: { sha: c.sha } });
    }
    return json(404, { message: `No simulado: ${p.metodo} ${resto}` });
  }

  private sueltos = new Map<string, Commit>();

  private getContenido(ruta: string, siNoCoincide?: string): RespuestaFalsa {
    const a = this.archivos.get(ruta);
    if (a) {
      const etag = `"${a.sha}"`;
      if (siNoCoincide === etag) return { status: 304, cabeceras: { etag } };
      return json(200, { type: 'file', path: ruta, name: ruta.split('/').at(-1), sha: a.sha, encoding: 'base64', content: utf8ABase64(a.texto) }, { etag });
    }
    const prefijo = ruta.replace(/\/$/, '') + '/';
    const hijos = new Map<string, { name: string; path: string; sha: string; type: string }>();
    for (const [r, x] of this.archivos) {
      if (!r.startsWith(prefijo)) continue;
      const resto = r.slice(prefijo.length);
      const nombre = resto.split('/')[0];
      const esDir = resto.includes('/');
      hijos.set(nombre, { name: nombre, path: prefijo + nombre, sha: esDir ? 'dir' : x.sha, type: esDir ? 'dir' : 'file' });
    }
    if (hijos.size === 0) return json(404, { message: 'Not Found' });
    const lista = [...hijos.values()].sort((x, y) => x.name.localeCompare(y.name));
    const etag = `"${shaDe(JSON.stringify(lista)).slice(0, 8)}${lista.map((x) => x.sha.slice(0, 4)).join('')}"`;
    if (siNoCoincide === etag) return { status: 304, cabeceras: { etag } };
    return json(200, lista, { etag });
  }

  private putContenido(ruta: string, cuerpo: { message: string; content: string; sha?: string }): RespuestaFalsa {
    this.antesDePut?.(ruta);
    const actual = this.archivos.get(ruta);
    if (this.conflictosForzados > 0) {
      this.conflictosForzados--;
      return json(409, { message: `${ruta} does not match ${cuerpo.sha}` });
    }
    if (actual && !cuerpo.sha) return json(422, { message: `Invalid request.\n\n"sha" wasn't supplied.` });
    if (actual && actual.sha !== cuerpo.sha) return json(409, { message: `${ruta} does not match ${cuerpo.sha}` });
    if (!actual && cuerpo.sha) return json(409, { message: 'sha does not match' });
    const texto = base64AUtf8(cuerpo.content);
    const sha = shaDe(texto);
    this.archivos.set(ruta, { texto, sha });
    this.nuevoCommit(cuerpo.message, this.cabeza);
    return json(actual ? 200 : 201, { content: { sha, path: ruta }, commit: { sha: this.cabeza } });
  }
}

function json(status: number, cuerpo: unknown, extra: Record<string, string> = {}): RespuestaFalsa {
  return { status, cabeceras: { 'content-type': 'application/json', ...extra }, cuerpo: JSON.stringify(cuerpo) };
}
