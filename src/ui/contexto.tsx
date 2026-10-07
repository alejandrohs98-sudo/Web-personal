import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Almacen } from '../datos/almacen';
import { leerAjustes, guardarAjustes, type Ajustes } from '../datos/ajustes';
import { ErrorDatos } from '../datos/errores';
import { GitHub } from '../datos/github';
import { cacheIDB, cacheMemoria, colaIDB, colaMemoria } from '../datos/idb';

interface Ctx {
  almacen: Almacen;
  gh: GitHub | null;
  ajustes: Ajustes;
  cambiarAjustes(a: Ajustes): void;
}

const Contexto = createContext<Ctx | null>(null);

const hayIDB = typeof indexedDB !== 'undefined';
const cache = hayIDB ? cacheIDB : cacheMemoria();
const cola = hayIDB ? colaIDB : colaMemoria();

function crear(a: Ajustes) {
  const gh = a.owner && a.repo ? new GitHub({ owner: a.owner, repo: a.repo, rama: a.rama || 'main', token: a.token || undefined }, cache) : null;
  return { gh, almacen: new Almacen(gh, cola) };
}

export function ProveedorDatos({ children }: { children: ReactNode }) {
  const [ajustes, setAjustes] = useState(leerAjustes);
  const { gh, almacen } = useMemo(() => crear(ajustes), [ajustes]);

  const cambiarAjustes = useCallback((a: Ajustes) => {
    guardarAjustes(a);
    setAjustes(leerAjustes());
  }, []);

  // Sincronización: al recuperar conexión, al volver a la app y periódicamente si hay pendientes.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        almacen.invalidar();
        void almacen.sincronizar();
      }
    };
    const enLinea = () => void almacen.sincronizar();
    window.addEventListener('online', enLinea);
    document.addEventListener('visibilitychange', alVolver);
    const t = window.setInterval(() => {
      const e = almacen.estado;
      if (e.pendientes > e.conError && navigator.onLine) {
        const reset = e.aviso?.resetEn;
        if (!reset || Date.now() / 1000 > reset) void almacen.sincronizar();
      }
    }, 20_000);
    void almacen.sincronizar();
    return () => {
      window.removeEventListener('online', enLinea);
      document.removeEventListener('visibilitychange', alVolver);
      window.clearInterval(t);
    };
  }, [almacen]);

  const valor = useMemo(() => ({ almacen, gh, ajustes, cambiarAjustes }), [almacen, gh, ajustes, cambiarAjustes]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useDatos(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('Falta ProveedorDatos');
  return c;
}

/** Se vuelve a renderizar con cada cambio del almacén. */
export function useVersion(): number {
  const { almacen } = useDatos();
  return useSyncExternalStore(
    (fn) => almacen.suscribir(fn),
    () => almacen.version,
  );
}

export function useEstadoSync() {
  const { almacen } = useDatos();
  useVersion();
  return almacen.estado;
}

export interface Lectura<T> {
  datos: T | null | undefined;
  cargando: boolean;
  error?: ErrorDatos;
  recargar(): void;
}

/** Lee un archivo JSON del repo de datos. `datos` es undefined mientras carga y null si no existe. */
export function useArchivo<T>(ruta: string | null): Lectura<T> {
  const { almacen } = useDatos();
  useVersion();
  const [error, setError] = useState<ErrorDatos>();
  const [cargando, setCargando] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ruta || !almacen.estado.configurado) return;
    let vivo = true;
    setCargando(true);
    almacen
      .leer<T>(ruta, n > 0)
      .then(() => vivo && setError(undefined))
      .catch((e) => vivo && setError(e instanceof ErrorDatos ? e : new ErrorDatos('otro', String(e))))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [almacen, ruta, n, almacen.generacion]);
  return {
    datos: ruta ? almacen.vista<T>(ruta) : undefined,
    cargando,
    error,
    recargar: () => setN((x) => x + 1),
  };
}

/** Lee todos los JSON de un directorio. */
export function useDirectorio<T>(dir: string): Lectura<{ ruta: string; datos: T }[]> {
  const { almacen } = useDatos();
  useVersion();
  const [error, setError] = useState<ErrorDatos>();
  const [cargando, setCargando] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!almacen.estado.configurado) return;
    let vivo = true;
    setCargando(true);
    almacen
      .leerDirectorio<T>(dir, n > 0)
      .then(() => vivo && setError(undefined))
      .catch((e) => vivo && setError(e instanceof ErrorDatos ? e : new ErrorDatos('otro', String(e))))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [almacen, dir, n, almacen.generacion]);
  return { datos: almacen.vistaDirectorio<T>(dir), cargando, error, recargar: () => setN((x) => x + 1) };
}
