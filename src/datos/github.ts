// Cliente mínimo de la API REST de GitHub para leer y escribir el repo de datos
// desde el navegador. Nunca usa raw.githubusercontent.com (tiene caché de minutos).
import { base64AUtf8, utf8ABase64 } from '../util/base64';
import { ErrorDatos, errorDeRed, errorDeRespuesta } from './errores';

export interface ConfigRepo {
  owner: string;
  repo: string;
  rama: string;
  token?: string;
}

export interface EntradaCache {
  etag?: string;
  sha?: string;
  texto?: string;
  entradas?: EntradaDirectorio[];
}

/** Almacén de la última versión buena de cada lectura (IndexedDB en el navegador). */
export interface CacheLectura {
  leer(clave: string): Promise<EntradaCache | undefined>;
  guardar(clave: string, entrada: EntradaCache): Promise<void>;
}

export interface EntradaDirectorio {
  nombre: string;
  ruta: string;
  sha: string;
  tipo: 'file' | 'dir';
}

export type Origen = 'red' | 'sin-cambios' | 'cache-sin-conexion';

export interface ArchivoLeido {
  texto: string;
  sha: string;
  origen: Origen;
}

export interface ArchivoNuevo {
  ruta: string;
  texto: string;
}

const API = 'https://api.github.com';

export class GitHub {
  constructor(
    private cfg: ConfigRepo,
    private cache: CacheLectura,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private accesoRepo?: Promise<unknown>;

  /**
   * Un 404 de un archivo puede significar "no existe" o "no ves el repo" (privado sin token,
   * nombre mal escrito). Se comprueba una vez el repo para no confundir una cosa con otra.
   */
  private async comprobarAcceso(): Promise<void> {
    this.accesoRepo ??= this.infoRepo().catch((e) => {
      this.accesoRepo = undefined;
      throw e;
    });
    await this.accesoRepo;
  }

  get conToken(): boolean {
    return !!this.cfg.token;
  }

  private clave(ruta: string): string {
    return `${this.cfg.owner}/${this.cfg.repo}@${this.cfg.rama}:${ruta}`;
  }

  private url(ruta: string): string {
    return `${API}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}${ruta}`;
  }

  private async peticion(url: string, init: RequestInit = {}, etag?: string): Promise<Response> {
    const cabeceras: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.cfg.token) cabeceras.Authorization = `Bearer ${this.cfg.token}`;
    if (etag) cabeceras['If-None-Match'] = etag;
    if (init.body) cabeceras['Content-Type'] = 'application/json';
    let res: Response;
    try {
      // no-store: la API manda max-age=60 y la caché HTTP del navegador
      // devolvería datos viejos justo después de guardar. El ETag lo gestionamos nosotros.
      res = await this.fetchFn(url, { ...init, headers: cabeceras, cache: 'no-store' });
    } catch {
      throw errorDeRed();
    }
    return res;
  }

  private rutaContenido(ruta: string): string {
    const r = ruta.split('/').map(encodeURIComponent).join('/');
    return this.url(`/contents/${r}?ref=${encodeURIComponent(this.cfg.rama)}`);
  }

  /** Lee un archivo de texto. Devuelve null si no existe. Sin conexión, devuelve la última versión buena. */
  async leerArchivo(ruta: string): Promise<ArchivoLeido | null> {
    const clave = this.clave(ruta);
    const previo = await this.cache.leer(clave);
    let res: Response;
    try {
      res = await this.peticion(this.rutaContenido(ruta), {}, previo?.texto !== undefined ? previo.etag : undefined);
    } catch (e) {
      if (e instanceof ErrorDatos && e.tipo === 'sin-conexion' && previo?.texto !== undefined && previo.sha) {
        return { texto: previo.texto, sha: previo.sha, origen: 'cache-sin-conexion' };
      }
      throw e;
    }
    if (res.status === 304 && previo?.texto !== undefined && previo.sha) {
      return { texto: previo.texto, sha: previo.sha, origen: 'sin-cambios' };
    }
    if (res.status === 404) {
      await this.comprobarAcceso();
      return null;
    }
    if (!res.ok) throw await errorDeRespuesta(res, this.conToken);
    const cuerpo = await res.json();
    if (Array.isArray(cuerpo) || cuerpo.type !== 'file') {
      throw new ErrorDatos('datos-invalidos', `"${ruta}" no es un archivo.`);
    }
    let texto: string;
    if (cuerpo.encoding === 'base64' && typeof cuerpo.content === 'string') {
      texto = base64AUtf8(cuerpo.content);
    } else {
      // Archivos de más de 1 MB: la API de contenidos no incluye el contenido.
      texto = await this.leerBlob(cuerpo.sha);
    }
    await this.cache.guardar(clave, { etag: res.headers.get('etag') ?? undefined, sha: cuerpo.sha, texto });
    return { texto, sha: cuerpo.sha, origen: 'red' };
  }

  /** Lee un archivo sabiendo ya su sha (p. ej. de un listado): si coincide con la caché, no gasta petición. */
  async leerArchivoConSha(ruta: string, sha: string): Promise<ArchivoLeido> {
    const previo = await this.cache.leer(this.clave(ruta));
    if (previo?.sha === sha && previo.texto !== undefined) {
      return { texto: previo.texto, sha, origen: 'sin-cambios' };
    }
    const leido = await this.leerArchivo(ruta);
    if (!leido) throw new ErrorDatos('no-encontrado', `No existe "${ruta}".`, 404);
    return leido;
  }

  private async leerBlob(sha: string): Promise<string> {
    const res = await this.peticion(this.url(`/git/blobs/${sha}`));
    if (!res.ok) throw await errorDeRespuesta(res, this.conToken);
    const cuerpo = await res.json();
    return base64AUtf8(cuerpo.content);
  }

  /** Lista un directorio. Si no existe, devuelve lista vacía. */
  async listarDirectorio(ruta: string): Promise<EntradaDirectorio[]> {
    const clave = this.clave(ruta + '/');
    const previo = await this.cache.leer(clave);
    let res: Response;
    try {
      res = await this.peticion(this.rutaContenido(ruta), {}, previo?.entradas ? previo.etag : undefined);
    } catch (e) {
      if (e instanceof ErrorDatos && e.tipo === 'sin-conexion' && previo?.entradas) return previo.entradas;
      throw e;
    }
    if (res.status === 304 && previo?.entradas) return previo.entradas;
    if (res.status === 404) {
      await this.comprobarAcceso();
      return [];
    }
    if (!res.ok) throw await errorDeRespuesta(res, this.conToken);
    const cuerpo = await res.json();
    if (!Array.isArray(cuerpo)) return [];
    const entradas: EntradaDirectorio[] = cuerpo.map((e: { name: string; path: string; sha: string; type: string }) => ({
      nombre: e.name,
      ruta: e.path,
      sha: e.sha,
      tipo: e.type === 'dir' ? 'dir' : 'file',
    }));
    await this.cache.guardar(clave, { etag: res.headers.get('etag') ?? undefined, entradas });
    return entradas;
  }

  /**
   * Crea o actualiza un archivo en un commit. `sha` es el del archivo actual
   * (undefined si es nuevo). Lanza ErrorDatos('conflicto') si el sha no coincide.
   */
  async escribirArchivo(ruta: string, texto: string, sha: string | undefined, mensaje: string): Promise<string> {
    const cuerpo: Record<string, string> = {
      message: mensaje,
      content: utf8ABase64(texto),
      branch: this.cfg.rama,
    };
    if (sha) cuerpo.sha = sha;
    const r = ruta.split('/').map(encodeURIComponent).join('/');
    const res = await this.peticion(this.url(`/contents/${r}`), { method: 'PUT', body: JSON.stringify(cuerpo) });
    if (!res.ok) throw await errorDeRespuesta(res, this.conToken);
    const resp = await res.json();
    const nuevoSha: string = resp.content.sha;
    await this.cache.guardar(this.clave(ruta), { sha: nuevoSha, texto });
    return nuevoSha;
  }

  /**
   * Escribe varios archivos en un único commit con la API Git Data.
   * Si el repo está completamente vacío (sin ningún commit), GitHub no permite
   * esa API: se crea el primer archivo con la API de contenidos y el resto en un segundo commit.
   */
  async commitVarios(archivos: ArchivoNuevo[], mensaje: string): Promise<void> {
    if (archivos.length === 0) return;
    for (let intento = 0; intento < 2; intento++) {
      let base: string;
      try {
        base = await this.shaRama();
      } catch (e) {
        if (e instanceof ErrorDatos && e.tipo === 'repo-vacio') {
          const [primero, ...resto] = archivos;
          await this.escribirArchivo(primero.ruta, primero.texto, undefined, mensaje);
          return this.commitVarios(resto, mensaje);
        }
        throw e;
      }
      const commitBase = await this.json(await this.peticion(this.url(`/git/commits/${base}`)));
      const arbol = await this.json(
        await this.peticion(this.url('/git/trees'), {
          method: 'POST',
          body: JSON.stringify({
            base_tree: commitBase.tree.sha,
            tree: archivos.map((a) => ({ path: a.ruta, mode: '100644', type: 'blob', content: a.texto })),
          }),
        }),
      );
      const commit = await this.json(
        await this.peticion(this.url('/git/commits'), {
          method: 'POST',
          body: JSON.stringify({ message: mensaje, tree: arbol.sha, parents: [base] }),
        }),
      );
      const res = await this.peticion(this.url(`/git/refs/heads/${encodeURIComponent(this.cfg.rama)}`), {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      if (res.ok) return;
      const err = await errorDeRespuesta(res, this.conToken);
      // 422 "not a fast forward": alguien ha escrito entre medias; se reintenta una vez.
      if (res.status === 422 && intento === 0) continue;
      throw err.tipo === 'otro' && res.status === 422
        ? new ErrorDatos('conflicto', 'El repositorio ha cambiado mientras guardabas. Vuelve a intentarlo.', 422)
        : err;
    }
  }

  private async shaRama(): Promise<string> {
    const res = await this.peticion(this.url(`/git/ref/heads/${encodeURIComponent(this.cfg.rama)}`));
    if (res.status === 404 || res.status === 409) {
      // 409: repo sin commits. 404: rama inexistente; si el repo está vacío también se trata así.
      const info = await this.infoRepo();
      if (res.status === 409 || info.vacio) throw new ErrorDatos('repo-vacio', 'El repositorio de datos está vacío.', 409);
      throw new ErrorDatos('no-encontrado', `No existe la rama "${this.cfg.rama}".`, 404);
    }
    const cuerpo = await this.json(res);
    return cuerpo.object.sha;
  }

  private async json(res: Response) {
    if (!res.ok) throw await errorDeRespuesta(res, this.conToken);
    return res.json();
  }

  /** Información del repo para la pantalla de Ajustes. */
  async infoRepo(): Promise<{ privado: boolean; puedeEscribir: boolean; vacio: boolean; ramaPorDefecto: string }> {
    const res = await this.peticion(this.url(''));
    const r = await this.json(res);
    return {
      privado: !!r.private,
      puedeEscribir: !!r.permissions?.push,
      vacio: r.size === 0,
      ramaPorDefecto: r.default_branch,
    };
  }
}
