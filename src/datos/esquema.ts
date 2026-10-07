// Esquema del repo de datos.
//
// Reglas (ver LEEME.md):
// - Lectura tolerante: los campos desconocidos se conservan al guardar (los cambios
//   son operaciones sobre caminos concretos) y los que faltan se rellenan en memoria
//   con `conDefectos`, sin reescribir el archivo.
// - Si un cambio de código exigiera transformar datos, se añade una migración aditiva
//   a MIGRACIONES. Nunca se ejecuta sola: el usuario la lanza desde Ajustes tras ver
//   la vista previa.
import type { ArchivoNuevo } from './github';
import { serializar } from './operaciones';

export const VERSION_ESQUEMA = 1;

export const RUTAS = {
  esquema: 'datos/esquema.json',
  perfil: 'datos/perfil.json',
  ingredientes: 'datos/ingredientes.json',
  despensa: 'datos/despensa.json',
  medidas: 'datos/medidas.json',
  recetas: 'datos/recetas',
  receta: (id: string) => `datos/recetas/${id}.json`,
  menu: (semana: string) => `datos/menus/${semana}.json`,
  compra: (semana: string) => `datos/compra/${semana}.json`,
  comidas: (mes: string) => `datos/comidas/${mes}.json`,
  entrenos: (mes: string) => `datos/entrenos/${mes}.json`,
} as const;

/** Rellena en memoria los campos que falten. No modifica el original. */
export function conDefectos<T extends object>(datos: unknown, defectos: T): T {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return structuredClone(defectos);
  return { ...structuredClone(defectos), ...(datos as object) } as T;
}

export const PERFIL_INICIAL = {
  nombre: 'Alejandro',
  objetivos: { kcalDia: 2200, proteinaDia: 140, ritmoObjetivoSegKm: 330, comidasFueraMaxSemana: 2 },
  biometria: { alturaCm: null, fechaNacimiento: null },
  disponibilidad: { lunes: '', martes: '', miercoles: '', jueves: '', viernes: '', sabado: '', domingo: '' },
  deportes: ['carrera', 'natacion', 'jiujitsu', 'gimnasio'],
  maquinas: [] as string[],
  notas: '',
};

export function archivosIniciales(): ArchivoNuevo[] {
  return [
    { ruta: RUTAS.esquema, texto: serializar({ version: VERSION_ESQUEMA }) },
    { ruta: RUTAS.perfil, texto: serializar(PERFIL_INICIAL) },
    { ruta: RUTAS.ingredientes, texto: serializar({ ingredientes: [] }) },
    { ruta: RUTAS.despensa, texto: serializar({ nota: '', items: {} }) },
    { ruta: RUTAS.medidas, texto: serializar({ medidas: [] }) },
    {
      ruta: 'datos/LEEME.md',
      texto:
        '# Datos de Kilómetros y Lentejas\n\nEste repositorio lo escribe la app. Cada cambio es un commit: el historial es la copia de seguridad.\n' +
        'Puedes editar los JSON a mano; la app conserva los campos que no conoce.\n',
    },
  ];
}

export interface Migracion {
  de: number;
  a: number;
  descripcion: string;
  /** Calcula los archivos a escribir (solo añadir o completar, nunca borrar). */
  preparar(leer: (ruta: string) => Promise<unknown>): Promise<ArchivoNuevo[]>;
}

/** Migraciones disponibles, en orden. Vacía mientras el esquema siga en la versión 1. */
export const MIGRACIONES: Migracion[] = [];

export function migracionesPendientes(versionRepo: number): Migracion[] {
  return MIGRACIONES.filter((m) => m.de >= versionRepo && m.a <= VERSION_ESQUEMA).sort((a, b) => a.de - b.de);
}
