import { describe, expect, it } from 'vitest';
import { aplicarCambios } from '../../src/datos/operaciones';

describe('aplicarCambios', () => {
  it('conserva los campos que no conoce', () => {
    const datos = { items: { arroz: { tengo: true, campoFuturo: 42 } }, otroCampo: 'x' };
    const r = aplicarCambios(datos, [{ tipo: 'fusionar', camino: ['items', 'arroz'], valor: { tengo: false } }]);
    expect(r).toEqual({ items: { arroz: { tengo: false, campoFuturo: 42 } }, otroCampo: 'x' });
  });
  it('no muta el original', () => {
    const datos = { a: [{ id: '1', n: 1 }] };
    aplicarCambios(datos, [{ tipo: 'actualizar', camino: ['a'], id: '1', valor: { n: 2 } }]);
    expect(datos.a[0].n).toBe(1);
  });
  it('añadir es idempotente por id (reaplicar tras conflicto no duplica)', () => {
    const c = { tipo: 'añadir' as const, camino: ['sesiones'], valor: { id: 's1', km: 8 } };
    const una = aplicarCambios({}, [c]);
    expect(aplicarCambios(una, [c])).toEqual({ sesiones: [{ id: 's1', km: 8 }] });
  });
  it('crea contenedores intermedios', () => {
    expect(aplicarCambios({}, [{ tipo: 'fijar', camino: ['dias', '2026-10-07', 'comida'], valor: [] }])).toEqual({
      dias: { '2026-10-07': { comida: [] } },
    });
  });
  it('fijar undefined borra la clave', () => {
    expect(aplicarCambios({ a: 1, b: 2 }, [{ tipo: 'fijar', camino: ['a'], valor: undefined }])).toEqual({ b: 2 });
  });
  it('rechaza cambios sobre datos con otra forma en lugar de sobrescribirlos', () => {
    expect(() => aplicarCambios({ items: 'texto' }, [{ tipo: 'fusionar', camino: ['items', 'x'], valor: {} }])).toThrow();
  });
  it('actualizar un elemento que ya no existe no hace nada', () => {
    expect(aplicarCambios({ l: [] }, [{ tipo: 'actualizar', camino: ['l'], id: 'z', valor: { a: 1 } }])).toEqual({ l: [] });
  });
});
