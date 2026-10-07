// Almacén de datos de la app: lee del repo de datos, aplica encima los cambios
// pendientes y sincroniza la cola de operaciones con GitHub.
//
// Garantías:
// - Un cambio se guarda primero en la cola local (IndexedDB) y solo se borra de ella
//   cuando GitHub ha confirmado el commit. Sin conexión no se pierde nada.
// - Ante un conflicto (409) se vuelve a leer el archivo, se reaplica el cambio y se
//   reintenta una vez. Si vuelve a fallar, la operación se queda en la cola marcada
//   con el error y el usuario decide (reintentar o descartar).
// - Nunca se escribe un archivo que no se ha podido interpretar como JSON.
import { ErrorDatos } from './errores';
import type { ArchivoNuevo, EntradaDirectorio, GitHub, Origen } from './github';
import type { AlmacenCola } from './idb';
import { aplicarCambios, nuevoId, serializar, type Operacion } from './operaciones';

export interface EstadoSync {
  pendientes: number;
  conError: number;
  sincronizando: boolean;
  /** Último error transitorio (sin conexión, límite) o de credenciales. */
  aviso?: ErrorDatos;
  soloLectura: boolean;
  configurado: boolean;
}

interface EnMemoria {
  datos: unknown | null; // null = el archivo no existe en el repo
  origen: Origen;
  cuando: number;
}

export type NuevaOperacion = Omit<Operacion, 'id' | 'creado' | 'error'>;

const FRESCURA_MS = 30_000;

export class Almacen {
  private memoria = new Map<string, EnMemoria>();
  private directorios = new Map<string, { entradas: EntradaDirectorio[]; cuando: number }>();
  private enVuelo = new Map<string, Promise<unknown>>();
  private ops: Operacion[] = [];
  private oyentes = new Set<() => void>();
  private sincronizando: Promise<void> | null = null;
  private aviso?: ErrorDatos;
  private listo: Promise<void>;
  version = 0;
  /** Sube cada vez que se invalida lo leído: las pantallas lo usan para volver a pedir datos. */
  generacion = 0;

  constructor(
    private gh: GitHub | null,
    private cola: AlmacenCola,
  ) {
    this.listo = this.cola.todas().then((ops) => {
      this.ops = ops;
      this.notificar();
    });
  }

  // ---------------------------------------------------------------- estado

  get estado(): EstadoSync {
    return {
      pendientes: this.ops.length,
      conError: this.ops.filter((o) => o.error).length,
      sincronizando: this.sincronizando !== null,
      aviso: this.aviso,
      soloLectura: !this.gh?.conToken,
      configurado: this.gh !== null,
    };
  }

  get operaciones(): Operacion[] {
    return this.ops;
  }

  suscribir(fn: () => void): () => void {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  private notificar() {
    this.version++;
    for (const fn of this.oyentes) fn();
  }

  /** Olvida lo leído para que la próxima lectura vaya a la red (al volver a la app). */
  invalidar() {
    for (const m of this.memoria.values()) m.cuando = 0;
    for (const d of this.directorios.values()) d.cuando = 0;
    this.generacion++;
    this.notificar();
  }

  // ---------------------------------------------------------------- lectura

  /** Vista de un archivo: lo último leído del repo con los cambios pendientes aplicados encima. */
  vista<T>(ruta: string): T | null | undefined {
    const m = this.memoria.get(ruta);
    const pendientes = this.ops.filter((o) => o.ruta === ruta);
    if (!m && pendientes.length === 0) return undefined; // aún no leído
    let datos: unknown = m?.datos ?? null;
    for (const op of pendientes) {
      if (datos === null) {
        if (op.inicial === undefined) continue;
        datos = op.inicial;
      }
      try {
        datos = aplicarCambios(datos, op.cambios);
      } catch {
        /* se informará al sincronizar */
      }
    }
    return datos as T | null;
  }

  origen(ruta: string): Origen | undefined {
    return this.memoria.get(ruta)?.origen;
  }

  /** Lee un archivo JSON del repo (con caché de unos segundos). Devuelve la vista con pendientes. */
  async leer<T>(ruta: string, forzar = false): Promise<T | null> {
    await this.listo;
    if (!this.gh) throw new ErrorDatos('otro', 'Configura el repositorio de datos en Ajustes.');
    const m = this.memoria.get(ruta);
    if (!forzar && m && Date.now() - m.cuando < FRESCURA_MS) return this.vista<T>(ruta) ?? null;
    const clave = 'f:' + ruta;
    if (!this.enVuelo.has(clave)) {
      const p = this.leerDeRed(ruta).finally(() => this.enVuelo.delete(clave));
      this.enVuelo.set(clave, p);
    }
    await this.enVuelo.get(clave);
    return this.vista<T>(ruta) ?? null;
  }

  private async leerDeRed(ruta: string, sha?: string) {
    const gh = this.gh!;
    try {
      const leido = sha ? await gh.leerArchivoConSha(ruta, sha) : await gh.leerArchivo(ruta);
      const datos = leido ? parsear(ruta, leido.texto) : null;
      this.memoria.set(ruta, { datos, origen: leido?.origen ?? 'red', cuando: Date.now() });
      if (leido?.origen !== 'cache-sin-conexion' && this.aviso?.tipo === 'sin-conexion') this.aviso = undefined;
      if (leido?.origen === 'cache-sin-conexion') this.aviso = new ErrorDatos('sin-conexion', 'Sin conexión: estás viendo la última versión guardada en el móvil.');
    } catch (e) {
      if (e instanceof ErrorDatos && (e.transitorio || e.tipo === 'token-invalido')) this.aviso = e;
      throw e;
    } finally {
      this.notificar();
    }
  }

  /** Lista un directorio y lee todos sus .json. Solo descarga los archivos cuyo sha ha cambiado. */
  async leerDirectorio<T>(dir: string, forzar = false): Promise<{ ruta: string; datos: T }[]> {
    await this.listo;
    if (!this.gh) throw new ErrorDatos('otro', 'Configura el repositorio de datos en Ajustes.');
    const d = this.directorios.get(dir);
    if (forzar || !d || Date.now() - d.cuando > FRESCURA_MS) {
      const clave = 'd:' + dir;
      if (!this.enVuelo.has(clave)) {
        const p = (async () => {
          const entradas = (await this.gh!.listarDirectorio(dir)).filter((e) => e.tipo === 'file' && e.nombre.endsWith('.json'));
          await Promise.all(
            entradas.map((e) => {
              const m = this.memoria.get(e.ruta);
              return m && m.cuando > 0 && Date.now() - m.cuando < FRESCURA_MS ? undefined : this.leerDeRed(e.ruta, e.sha);
            }),
          );
          this.directorios.set(dir, { entradas, cuando: Date.now() });
        })().finally(() => this.enVuelo.delete(clave));
        this.enVuelo.set(clave, p);
      }
      await this.enVuelo.get(clave);
    }
    return this.vistaDirectorio<T>(dir);
  }

  /** Vista de un directorio incluyendo archivos nuevos que solo existen en la cola. */
  vistaDirectorio<T>(dir: string): { ruta: string; datos: T }[] {
    const rutas = new Set((this.directorios.get(dir)?.entradas ?? []).map((e) => e.ruta));
    for (const op of this.ops) if (op.ruta.startsWith(dir + '/')) rutas.add(op.ruta);
    const r: { ruta: string; datos: T }[] = [];
    for (const ruta of [...rutas].sort()) {
      const datos = this.vista<T>(ruta);
      if (datos != null) r.push({ ruta, datos });
    }
    return r;
  }

  // ---------------------------------------------------------------- escritura

  /** Registra un cambio: se ve al instante, se guarda en la cola local y se intenta enviar. */
  async cambiar(op: NuevaOperacion): Promise<void> {
    await this.listo;
    if (!this.gh?.conToken) {
      throw new ErrorDatos('sin-permiso', 'Modo solo lectura: añade un token de GitHub en Ajustes para poder guardar.');
    }
    const completa: Operacion = { ...op, id: nuevoId('op-'), creado: new Date().toISOString() };
    // Validación anticipada: si el cambio no se puede aplicar sobre lo que vemos, no se encola.
    const actual = this.vista(op.ruta);
    if (actual != null) aplicarCambios(actual, op.cambios);
    await this.cola.poner(completa);
    this.ops.push(completa);
    this.notificar();
    void this.sincronizar();
  }

  /** Escribe varios archivos nuevos en un solo commit (preparar repo, importar). Requiere conexión. */
  async commitVarios(archivos: ArchivoNuevo[], mensaje: string): Promise<void> {
    if (!this.gh?.conToken) throw new ErrorDatos('sin-permiso', 'Necesitas un token de GitHub para escribir.');
    await this.gh.commitVarios(archivos, mensaje);
    this.invalidar();
  }

  async descartar(id: string): Promise<void> {
    await this.cola.quitar(id);
    this.ops = this.ops.filter((o) => o.id !== id);
    this.notificar();
  }

  async reintentar(id: string): Promise<void> {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    delete op.error;
    await this.cola.poner(op);
    this.notificar();
    await this.sincronizar();
  }

  /** Envía la cola en orden. Para en el primer error para respetar el orden de los cambios. */
  sincronizar(): Promise<void> {
    if (!this.sincronizando) {
      this.sincronizando = this.vaciarCola().finally(() => {
        this.sincronizando = null;
        this.notificar();
      });
      this.notificar();
    }
    return this.sincronizando;
  }

  private async vaciarCola() {
    await this.listo;
    if (!this.gh?.conToken) return;
    for (const op of [...this.ops]) {
      if (op.error) return; // esperando decisión del usuario
      try {
        await this.enviar(op);
        await this.cola.quitar(op.id);
        this.ops = this.ops.filter((o) => o.id !== op.id);
        if (this.aviso?.transitorio) this.aviso = undefined;
        this.notificar();
      } catch (e) {
        const err = e instanceof ErrorDatos ? e : new ErrorDatos('otro', String((e as Error)?.message ?? e));
        if (err.transitorio || err.tipo === 'token-invalido' || err.tipo === 'sin-permiso') {
          this.aviso = err; // se reintentará solo (o cuando arreglen el token)
        } else {
          op.error = err.message;
          await this.cola.poner(op);
        }
        this.notificar();
        return;
      }
    }
  }

  private async enviar(op: Operacion) {
    const gh = this.gh!;
    for (let intento = 0; intento < 2; intento++) {
      const leido = await gh.leerArchivo(op.ruta);
      if (leido?.origen === 'cache-sin-conexion') throw new ErrorDatos('sin-conexion', 'Sin conexión.');
      let base: unknown;
      if (leido) {
        base = parsear(op.ruta, leido.texto);
        this.memoria.set(op.ruta, { datos: base, origen: leido.origen, cuando: Date.now() });
      } else if (op.inicial !== undefined) base = op.inicial;
      else throw new ErrorDatos('no-encontrado', `El archivo "${op.ruta}" ya no existe en el repositorio.`);
      const nuevo = aplicarCambios(base, op.cambios);
      const texto = serializar(nuevo);
      if (leido && texto === serializar(base)) return; // nada que cambiar (ya aplicado)
      try {
        await gh.escribirArchivo(op.ruta, texto, leido?.sha, op.mensaje);
        this.memoria.set(op.ruta, { datos: nuevo, origen: 'red', cuando: Date.now() });
        return;
      } catch (e) {
        if (e instanceof ErrorDatos && e.tipo === 'conflicto' && intento === 0) continue;
        if (e instanceof ErrorDatos && e.tipo === 'conflicto') {
          throw new ErrorDatos(
            'conflicto',
            `No se pudo guardar "${op.mensaje}": el archivo cambió dos veces mientras guardabas. Tu cambio sigue en el móvil; pulsa Reintentar.`,
          );
        }
        throw e;
      }
    }
  }
}

function parsear(ruta: string, texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorDatos('datos-invalidos', `"${ruta}" no es JSON válido. Corrígelo en GitHub; la app no lo sobrescribirá.`);
  }
}
