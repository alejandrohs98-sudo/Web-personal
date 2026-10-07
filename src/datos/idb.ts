// Envoltorio mínimo de IndexedDB (sin dependencias de terceros).
import type { CacheLectura, EntradaCache } from './github';
import type { Operacion } from './operaciones';

const NOMBRE = 'kyl';
const VERSION = 1;

let abierta: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  abierta ??= new Promise((ok, mal) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'orden', autoIncrement: true });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => {
      abierta = null;
      mal(req.error);
    };
  });
  return abierta;
}

function tx<T>(almacen: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((ok, mal) => {
        const t = db.transaction(almacen, modo);
        const req = fn(t.objectStore(almacen));
        t.oncomplete = () => ok(req.result);
        t.onerror = () => mal(t.error);
        t.onabort = () => mal(t.error);
      }),
  );
}

export const cacheIDB: CacheLectura = {
  leer: (clave) => tx<EntradaCache | undefined>('cache', 'readonly', (s) => s.get(clave)),
  guardar: (clave, e) => tx('cache', 'readwrite', (s) => s.put(e, clave)).then(() => undefined),
};

/** Almacén de la cola de cambios pendientes de sincronizar. */
export interface AlmacenCola {
  todas(): Promise<Operacion[]>;
  poner(op: Operacion): Promise<void>;
  quitar(id: string): Promise<void>;
}

type Fila = Operacion & { orden?: number };

export const colaIDB: AlmacenCola = {
  async todas() {
    const filas = await tx<Fila[]>('cola', 'readonly', (s) => s.getAll());
    return filas.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  },
  async poner(op) {
    const filas = await tx<Fila[]>('cola', 'readonly', (s) => s.getAll());
    const existente = filas.find((f) => f.id === op.id);
    await tx('cola', 'readwrite', (s) => s.put(existente ? { ...op, orden: existente.orden } : op));
  },
  async quitar(id) {
    const filas = await tx<Fila[]>('cola', 'readonly', (s) => s.getAll());
    const f = filas.find((x) => x.id === id);
    if (f?.orden !== undefined) await tx('cola', 'readwrite', (s) => s.delete(f.orden!));
  },
};

/** Implementaciones en memoria (tests y navegadores sin IndexedDB). */
export function cacheMemoria(): CacheLectura {
  const m = new Map<string, EntradaCache>();
  return {
    leer: async (k) => structuredClone(m.get(k)),
    guardar: async (k, e) => void m.set(k, structuredClone(e)),
  };
}

export function colaMemoria(): AlmacenCola {
  const l: Operacion[] = [];
  return {
    todas: async () => structuredClone(l),
    poner: async (op) => {
      const i = l.findIndex((o) => o.id === op.id);
      if (i >= 0) l[i] = structuredClone(op);
      else l.push(structuredClone(op));
    },
    quitar: async (id) => {
      const i = l.findIndex((o) => o.id === id);
      if (i >= 0) l.splice(i, 1);
    },
  };
}
