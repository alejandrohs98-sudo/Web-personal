import { describe, expect, it } from 'vitest';
import { Almacen } from '../../src/datos/almacen';
import { GitHub } from '../../src/datos/github';
import { cacheMemoria, colaMemoria } from '../../src/datos/idb';
import { archivosIniciales } from '../../src/datos/esquema';
import { GitHubFalso } from '../fixtures/githubFalso';

function montar(o: { token?: string; archivos?: Record<string, string>; privado?: boolean; vacio?: boolean } = {}) {
  const falso = new GitHubFalso({ archivos: o.archivos, privado: o.privado, vacio: o.vacio });
  const cola = colaMemoria();
  const cache = cacheMemoria();
  const gh = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main', token: o.token ?? 'tk' }, cache, falso.fetch);
  const almacen = new Almacen(gh, cola);
  return { falso, cola, cache, gh, almacen };
}

const despensa = JSON.stringify({ nota: '', items: { arroz: { tengo: true } }, extra: 'no tocar' });

describe('GitHub (lectura)', () => {
  it('usa ETag: la segunda lectura sin cambios es un 304', async () => {
    const { falso, gh } = montar({ archivos: { 'datos/despensa.json': despensa } });
    expect((await gh.leerArchivo('datos/despensa.json'))!.origen).toBe('red');
    const segunda = await gh.leerArchivo('datos/despensa.json');
    expect(segunda!.origen).toBe('sin-cambios');
    expect(falso.peticiones.at(-1)!.cabeceras['if-none-match']).toBeTruthy();
  });
  it('sin conexión devuelve la última versión buena', async () => {
    const { falso, gh } = montar({ archivos: { 'datos/despensa.json': despensa } });
    await gh.leerArchivo('datos/despensa.json');
    falso.sinConexion = true;
    expect((await gh.leerArchivo('datos/despensa.json'))!.origen).toBe('cache-sin-conexion');
  });
  it('repo público sin token: lee sin cabecera Authorization', async () => {
    const falso = new GitHubFalso({ privado: false, archivos: { 'datos/despensa.json': despensa } });
    const gh = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main' }, cacheMemoria(), falso.fetch);
    expect(await gh.leerArchivo('datos/despensa.json')).not.toBeNull();
    expect(falso.peticiones[0].cabeceras['authorization']).toBeUndefined();
  });
  it('errores comprensibles: token inválido y límite de peticiones', async () => {
    const falso = new GitHubFalso({ token: 'bueno' });
    const gh = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main', token: 'malo' }, cacheMemoria(), falso.fetch);
    await expect(gh.leerArchivo('x.json')).rejects.toMatchObject({ tipo: 'token-invalido' });

    const limitado: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791374400' },
      });
    const gh2 = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main' }, cacheMemoria(), limitado);
    const e = await gh2.leerArchivo('x.json').catch((x) => x);
    expect(e.tipo).toBe('limite');
    expect(e.message).toMatch(/Se libera a las/);
  });
});

describe('Almacen (escritura)', () => {
  it('escribe con commit legible y conserva campos desconocidos', async () => {
    const { falso, almacen } = montar({ archivos: { 'datos/despensa.json': despensa } });
    await almacen.leer('datos/despensa.json');
    await almacen.cambiar({
      ruta: 'datos/despensa.json',
      mensaje: 'despensa: ya no queda arroz',
      cambios: [{ tipo: 'fusionar', camino: ['items', 'arroz'], valor: { tengo: false } }],
    });
    await almacen.sincronizar();
    expect(falso.leer('datos/despensa.json')).toEqual({ nota: '', items: { arroz: { tengo: false } }, extra: 'no tocar' });
    expect(falso.mensajes.at(-1)).toBe('despensa: ya no queda arroz');
    expect(almacen.estado.pendientes).toBe(0);
  });

  it('acentos y eñes llegan intactos', async () => {
    const { falso, almacen } = montar();
    await almacen.cambiar({
      ruta: 'datos/recetas/pollo.json',
      mensaje: 'receta: añade Pollo al chilindrón',
      inicial: {},
      cambios: [{ tipo: 'reemplazar', valor: { id: 'pollo', nombre: 'Pollo al chilindrón', notas: 'añadir piñones' } }],
    });
    await almacen.sincronizar();
    expect(falso.leer('datos/recetas/pollo.json')).toMatchObject({ nombre: 'Pollo al chilindrón', notas: 'añadir piñones' });
  });

  it('conflicto 409: vuelve a leer, reaplica sobre la versión nueva y no pisa al otro dispositivo', async () => {
    const compra = JSON.stringify({ carrito: {} });
    const { falso, almacen } = montar({ archivos: { 'datos/compra/2026-W41.json': compra } });
    await almacen.leer('datos/compra/2026-W41.json');
    let primera = true;
    falso.antesDePut = (ruta) => {
      if (!primera) return;
      primera = false;
      falso.escribirDirecto(ruta, JSON.stringify({ carrito: { leche: true } }));
    };
    await almacen.cambiar({
      ruta: 'datos/compra/2026-W41.json',
      mensaje: 'compra: marca 1 artículo',
      cambios: [{ tipo: 'fijar', camino: ['carrito', 'arroz'], valor: true }],
    });
    await almacen.sincronizar();
    expect(falso.leer('datos/compra/2026-W41.json')).toEqual({ carrito: { leche: true, arroz: true } });
    expect(almacen.estado.pendientes).toBe(0);
  });

  it('dos conflictos seguidos: el cambio se conserva en la cola con un error claro', async () => {
    const { falso, almacen } = montar({ archivos: { 'datos/despensa.json': despensa } });
    falso.conflictosForzados = 2;
    await almacen.cambiar({
      ruta: 'datos/despensa.json',
      mensaje: 'despensa: actualiza',
      cambios: [{ tipo: 'fijar', camino: ['nota'], valor: 'hola' }],
    });
    await almacen.sincronizar();
    expect(almacen.estado.pendientes).toBe(1);
    expect(almacen.operaciones[0].error).toMatch(/Reintentar/);
    // La vista sigue mostrando el cambio del usuario.
    expect(almacen.vista<{ nota: string }>('datos/despensa.json')!.nota).toBe('hola');
    await almacen.reintentar(almacen.operaciones[0].id);
    expect(almacen.estado.pendientes).toBe(0);
    expect(falso.leer('datos/despensa.json')).toMatchObject({ nota: 'hola' });
  });

  it('sin conexión: encola, persiste la cola y envía al volver', async () => {
    const { falso, cola, gh, almacen } = montar({ archivos: { 'datos/despensa.json': despensa } });
    await almacen.leer('datos/despensa.json');
    falso.sinConexion = true;
    for (const nota of ['uno', 'dos']) {
      await almacen.cambiar({ ruta: 'datos/despensa.json', mensaje: `despensa: ${nota}`, cambios: [{ tipo: 'fijar', camino: ['nota'], valor: nota }] });
    }
    await almacen.sincronizar();
    expect(almacen.estado.pendientes).toBe(2);
    expect(almacen.estado.aviso?.tipo).toBe('sin-conexion');

    // Se cierra la app: un almacén nuevo recupera la cola de IndexedDB.
    const otro = new Almacen(gh, cola);
    falso.sinConexion = false;
    await otro.sincronizar();
    expect(otro.estado.pendientes).toBe(0);
    expect(falso.mensajes.slice(-2)).toEqual(['despensa: uno', 'despensa: dos']);
    expect(falso.leer('datos/despensa.json')).toMatchObject({ nota: 'dos', extra: 'no tocar' });
  });

  it('no sobrescribe un archivo que no es JSON válido', async () => {
    const { falso, almacen } = montar({ archivos: { 'datos/despensa.json': '{ roto' } });
    await almacen.cambiar({ ruta: 'datos/despensa.json', mensaje: 'x', cambios: [{ tipo: 'fijar', camino: ['nota'], valor: 'a' }] });
    await almacen.sincronizar();
    expect(falso.archivos.get('datos/despensa.json')!.texto).toBe('{ roto');
    expect(almacen.operaciones[0].error).toMatch(/no es JSON válido/);
  });

  it('sin token: solo lectura', async () => {
    const falso = new GitHubFalso({ privado: false });
    const gh = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main' }, cacheMemoria(), falso.fetch);
    const almacen = new Almacen(gh, colaMemoria());
    expect(almacen.estado.soloLectura).toBe(true);
    await expect(almacen.cambiar({ ruta: 'a.json', mensaje: 'x', cambios: [] })).rejects.toMatchObject({ tipo: 'sin-permiso' });
  });

  it('directorios: solo descarga los archivos cuyo sha ha cambiado', async () => {
    const { falso, almacen } = montar({
      archivos: { 'datos/recetas/a.json': '{"id":"a"}', 'datos/recetas/b.json': '{"id":"b"}' },
    });
    expect((await almacen.leerDirectorio('datos/recetas')).map((r) => r.datos)).toEqual([{ id: 'a' }, { id: 'b' }]);
    falso.escribirDirecto('datos/recetas/b.json', '{"id":"b","v":2}');
    almacen.invalidar();
    const antes = falso.peticiones.length;
    const r = await almacen.leerDirectorio('datos/recetas', true);
    expect(r[1].datos).toEqual({ id: 'b', v: 2 });
    const pedidos = falso.peticiones.slice(antes).map((p) => new URL(p.url).pathname);
    expect(pedidos.filter((x) => x.endsWith('a.json'))).toHaveLength(0);
  });
});

describe('Preparar el repositorio', () => {
  it('crea toda la estructura en un solo commit', async () => {
    const { falso, gh } = montar();
    const commitsAntes = falso.commits.length;
    await gh.commitVarios(archivosIniciales(), 'datos: prepara el repositorio');
    expect(falso.commits.length).toBe(commitsAntes + 1);
    expect(falso.leer('datos/esquema.json')).toEqual({ version: 1 });
    expect(falso.archivos.has('README.md')).toBe(true);
  });
  it('repo totalmente vacío: crea el primer archivo y el resto en otro commit', async () => {
    const { falso, gh } = montar({ vacio: true });
    await gh.commitVarios(archivosIniciales(), 'datos: prepara el repositorio');
    expect(falso.leer('datos/esquema.json')).toEqual({ version: 1 });
    expect(falso.leer('datos/perfil.json')).toMatchObject({ nombre: 'Alejandro' });
    expect(falso.commits.length).toBe(2);
  });
  it('si alguien escribe entre medias, reintenta sobre la rama nueva', async () => {
    const { falso, gh } = montar();
    const original = falso.manejar.bind(falso);
    let una = true;
    falso.manejar = (p) => {
      if (una && p.metodo === 'PATCH') {
        una = false;
        falso.escribirDirecto('otro.txt', 'x');
      }
      return original(p);
    };
    await gh.commitVarios(archivosIniciales(), 'datos: prepara el repositorio');
    expect(falso.archivos.has('otro.txt')).toBe(true);
    expect(falso.leer('datos/esquema.json')).toEqual({ version: 1 });
  });
});

describe('404 ambiguo', () => {
  it('repo privado sin token: no lo confunde con "archivo inexistente"', async () => {
    const falso = new GitHubFalso({ privado: true });
    const gh = new GitHub({ owner: 'yo', repo: 'datos', rama: 'main' }, cacheMemoria(), falso.fetch);
    await expect(gh.leerArchivo('datos/esquema.json')).rejects.toMatchObject({ tipo: 'no-encontrado' });
  });
  it('archivo que de verdad no existe: null', async () => {
    const { gh } = montar();
    expect(await gh.leerArchivo('datos/esquema.json')).toBeNull();
  });
});
