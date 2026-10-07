// Utilidades de fecha. Todas las fechas de datos son 'AAAA-MM-DD' en hora local.

export function hoyISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

export function parsearFecha(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Semana ISO 8601 en formato 'AAAA-Www' (p. ej. '2026-W41'). */
export function semanaISO(fecha: Date | string): string {
  const f = typeof fecha === 'string' ? parsearFecha(fecha) : fecha;
  const d = new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()));
  const diaSemana = d.getUTCDay() || 7; // lunes=1 … domingo=7
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana); // jueves de esa semana
  const inicioAño = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAño.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/** Lunes (fecha ISO) de una semana 'AAAA-Www'. */
export function lunesDeSemana(semana: string): string {
  const [y, w] = semana.split('-W').map(Number);
  const cuatroEnero = new Date(Date.UTC(y, 0, 4));
  const dia = cuatroEnero.getUTCDay() || 7;
  const lunes = new Date(cuatroEnero);
  lunes.setUTCDate(cuatroEnero.getUTCDate() - dia + 1 + (w - 1) * 7);
  return lunes.toISOString().slice(0, 10);
}

/** Los 7 días (lunes a domingo) de una semana 'AAAA-Www'. */
export function diasDeSemana(semana: string): string[] {
  const lunes = parsearFecha(lunesDeSemana(semana));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return hoyISO(d);
  });
}

export function desplazarSemana(semana: string, n: number): string {
  const lunes = parsearFecha(lunesDeSemana(semana));
  lunes.setDate(lunes.getDate() + n * 7);
  return semanaISO(lunes);
}

/** 'AAAA-MM' de una fecha ISO. */
export function mesDe(fechaISO: string): string {
  return fechaISO.slice(0, 7);
}

export function horaLocal(epochSeg: number): string {
  return new Date(epochSeg * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
