import { describe, expect, it } from 'vitest';
import { base64AUtf8, utf8ABase64 } from '../../src/util/base64';
import { desplazarSemana, diasDeSemana, lunesDeSemana, semanaISO } from '../../src/util/fechas';

describe('base64 UTF-8', () => {
  it('conserva acentos, eñes y emojis', () => {
    const t = 'Pollo al chilindrón con piñones — año 2026 🥘';
    expect(base64AUtf8(utf8ABase64(t))).toBe(t);
  });
  it('acepta saltos de línea en el base64 de GitHub', () => {
    const b = utf8ABase64('canción'.repeat(50));
    expect(base64AUtf8(b.replace(/(.{60})/g, '$1\n'))).toBe('canción'.repeat(50));
  });
});

describe('semanas ISO', () => {
  it('calcula la semana', () => {
    expect(semanaISO('2026-10-07')).toBe('2026-W41');
    expect(semanaISO('2027-01-01')).toBe('2026-W53');
    expect(semanaISO('2024-12-30')).toBe('2025-W01');
  });
  it('lunes y días de la semana', () => {
    expect(lunesDeSemana('2026-W41')).toBe('2026-10-05');
    expect(diasDeSemana('2026-W41')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });
  it('navega entre semanas y años', () => {
    expect(desplazarSemana('2026-W53', 1)).toBe('2027-W01');
    expect(desplazarSemana('2026-W01', -1)).toBe('2025-W52');
  });
});
