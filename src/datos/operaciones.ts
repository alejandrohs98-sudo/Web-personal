// Cambios expresados como operaciones, no como archivos completos.
// Así un cambio se puede volver a aplicar sobre una versión más nueva del archivo
// (tras un conflicto 409 o al sincronizar la cola sin conexión) sin pisar lo que
// haya cambiado otro dispositivo, y los campos que la app no conoce se conservan.

export type Camino = (string | number)[];

export type Cambio =
  /** Fija un valor en un camino. `valor: undefined` borra la clave. */
  | { tipo: 'fijar'; camino: Camino; valor: unknown }
  /** Fusión superficial de campos en el objeto del camino (lo crea si no existe). */
  | { tipo: 'fusionar'; camino: Camino; valor: Record<string, unknown> }
  /** Añade a la lista del camino; si ya hay un elemento con el mismo id, lo fusiona. */
  | { tipo: 'añadir'; camino: Camino; valor: { id: string } & Record<string, unknown> }
  /** Fusiona campos en el elemento con ese id de la lista del camino. */
  | { tipo: 'actualizar'; camino: Camino; id: string; valor: Record<string, unknown> }
  /** Elimina del todo el elemento con ese id (solo desde la Papelera). */
  | { tipo: 'quitar'; camino: Camino; id: string }
  /** Sustituye el archivo entero (solo para archivos de un elemento, p. ej. una receta). */
  | { tipo: 'reemplazar'; valor: unknown };

export interface Operacion {
  id: string;
  /** Ruta del archivo en el repo de datos, p. ej. 'datos/compra/2026-W41.json'. */
  ruta: string;
  /** Mensaje del commit, legible: "compra: marca 3 artículos". */
  mensaje: string;
  cambios: Cambio[];
  /** Contenido de partida si el archivo aún no existe. */
  inicial?: unknown;
  creado: string;
  /** Error permanente del último intento (la operación se conserva hasta que el usuario decida). */
  error?: string;
}

type Obj = Record<string, unknown>;

function esObjeto(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Devuelve el contenedor en `camino`, creando objetos o listas intermedias si faltan. */
function contenedor(raiz: unknown, camino: Camino, final: 'objeto' | 'lista'): Obj | unknown[] {
  let actual = raiz as Obj | unknown[];
  for (let i = 0; i < camino.length; i++) {
    const clave = camino[i];
    const esUltimo = i === camino.length - 1;
    const siguiente = (actual as Obj)[clave as string];
    const debeSer = esUltimo ? final : typeof camino[i + 1] === 'number' ? 'lista' : 'objeto';
    const valido = debeSer === 'lista' ? Array.isArray(siguiente) : esObjeto(siguiente);
    if (!valido) {
      if (siguiente !== undefined && siguiente !== null) {
        throw new Error(`No se puede aplicar el cambio: "${camino.slice(0, i + 1).join('.')}" no tiene la forma esperada.`);
      }
      (actual as Obj)[clave as string] = debeSer === 'lista' ? [] : {};
    }
    actual = (actual as Obj)[clave as string] as Obj | unknown[];
  }
  return actual;
}

function aplicarUno(datos: unknown, c: Cambio): unknown {
  switch (c.tipo) {
    case 'reemplazar':
      return structuredClone(c.valor);
    case 'fijar': {
      if (c.camino.length === 0) return structuredClone(c.valor);
      const padre = contenedor(datos, c.camino.slice(0, -1), typeof c.camino.at(-1) === 'number' ? 'lista' : 'objeto') as Obj;
      const clave = c.camino.at(-1) as string;
      if (c.valor === undefined) delete padre[clave];
      else padre[clave] = structuredClone(c.valor);
      return datos;
    }
    case 'fusionar': {
      const obj = c.camino.length ? (contenedor(datos, c.camino, 'objeto') as Obj) : (datos as Obj);
      Object.assign(obj, structuredClone(c.valor));
      return datos;
    }
    case 'añadir': {
      const lista = contenedor(datos, c.camino, 'lista') as Obj[];
      const i = lista.findIndex((e) => esObjeto(e) && e.id === c.valor.id);
      if (i >= 0) lista[i] = { ...lista[i], ...structuredClone(c.valor) };
      else lista.push(structuredClone(c.valor));
      return datos;
    }
    case 'actualizar': {
      const lista = contenedor(datos, c.camino, 'lista') as Obj[];
      const el = lista.find((e) => esObjeto(e) && e.id === c.id);
      // Si el elemento ya no existe (lo borró otro dispositivo), el cambio no aplica.
      if (el) Object.assign(el, structuredClone(c.valor));
      return datos;
    }
    case 'quitar': {
      const lista = contenedor(datos, c.camino, 'lista') as Obj[];
      const i = lista.findIndex((e) => esObjeto(e) && e.id === c.id);
      if (i >= 0) lista.splice(i, 1);
      return datos;
    }
  }
}

/** Aplica los cambios sobre una copia; nunca muta `datos`. */
export function aplicarCambios(datos: unknown, cambios: Cambio[]): unknown {
  let r = structuredClone(datos);
  for (const c of cambios) r = aplicarUno(r, c);
  return r;
}

/** JSON legible para que los diffs del historial de Git se entiendan. */
export function serializar(datos: unknown): string {
  return JSON.stringify(datos, null, 2) + '\n';
}

export function nuevoId(prefijo = ''): string {
  const aleatorio = crypto.getRandomValues(new Uint32Array(2));
  return prefijo + Date.now().toString(36) + aleatorio[0].toString(36) + aleatorio[1].toString(36).slice(0, 4);
}
