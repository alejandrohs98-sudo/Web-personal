import { useEffect, useState } from 'react';
import type { Ajustes } from '../../datos/ajustes';
import { ErrorDatos } from '../../datos/errores';
import { archivosIniciales, migracionesPendientes, RUTAS, VERSION_ESQUEMA } from '../../datos/esquema';
import type { ArchivoNuevo } from '../../datos/github';
import { useArchivo, useDatos, useEstadoSync } from '../contexto';

export function PantallaAjustes() {
  return (
    <>
      <RepoDatos />
      <EstadoRepo />
      <Sincronizacion />
      <Instalar />
      <ComoToken />
    </>
  );
}

function RepoDatos() {
  const { ajustes, cambiarAjustes } = useDatos();
  const [f, setF] = useState<Ajustes>(ajustes);
  const [guardado, setGuardado] = useState(false);
  useEffect(() => setF(ajustes), [ajustes]);
  const cambia = (k: keyof Ajustes) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setGuardado(false);
    setF({ ...f, [k]: e.target.value });
  };
  return (
    <form
      className="tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        cambiarAjustes(f);
        setGuardado(true);
      }}
    >
      <h2>Repositorio de datos</h2>
      <p className="suave">Se guarda solo en este dispositivo, nunca en GitHub.</p>
      <div className="fila">
        <label className="campo">
          <span>Dueño</span>
          <input value={f.owner} onChange={cambia('owner')} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label className="campo">
          <span>Repositorio</span>
          <input value={f.repo} onChange={cambia('repo')} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
      </div>
      <label className="campo">
        <span>Rama</span>
        <input value={f.rama} onChange={cambia('rama')} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="campo">
        <span>Token de GitHub (déjalo vacío para solo lectura)</span>
        <input
          type="password"
          value={f.token}
          onChange={cambia('token')}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="github_pat_…"
        />
      </label>
      <div className="fila">
        <button className="boton primario" type="submit">Guardar</button>
        {guardado && <span className="suave">Guardado en este dispositivo.</span>}
      </div>
    </form>
  );
}

function EstadoRepo() {
  const { gh, almacen } = useDatos();
  const esquema = useArchivo<{ version?: number }>(gh ? RUTAS.esquema : null);
  const [info, setInfo] = useState<{ privado: boolean; puedeEscribir: boolean }>();
  const [errorInfo, setErrorInfo] = useState<ErrorDatos>();
  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<string>();
  const [errorAccion, setErrorAccion] = useState<string>();
  const [vistaPrevia, setVistaPrevia] = useState<{ titulo: string; archivos: ArchivoNuevo[]; mensaje: string }>();

  useEffect(() => {
    if (!gh) return;
    setInfo(undefined);
    setErrorInfo(undefined);
    gh.infoRepo().then(setInfo, (e) => setErrorInfo(e));
  }, [gh]);

  if (!gh) {
    return (
      <section className="tarjeta">
        <h2>Estado</h2>
        <p className="suave">Indica el dueño y el nombre del repositorio de datos.</p>
      </section>
    );
  }

  const error = errorInfo ?? esquema.error;
  const noPreparado = esquema.datos === null;
  const versionRepo = esquema.datos?.version ?? 0;
  const migraciones = esquema.datos ? migracionesPendientes(versionRepo) : [];

  async function ejecutar() {
    if (!vistaPrevia) return;
    setTrabajando(true);
    setErrorAccion(undefined);
    try {
      // Comprobación de seguridad justo antes de escribir.
      if (vistaPrevia.titulo.startsWith('Preparar') && (await almacen.leer(RUTAS.esquema, true)) !== null) {
        throw new ErrorDatos('otro', 'El repositorio ya está preparado; no se ha escrito nada.');
      }
      await almacen.commitVarios(vistaPrevia.archivos, vistaPrevia.mensaje);
      setResultado(`Hecho: ${vistaPrevia.mensaje}`);
      setVistaPrevia(undefined);
      esquema.recargar();
    } catch (e) {
      setErrorAccion((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  async function prepararMigracion() {
    const archivos: ArchivoNuevo[] = [];
    for (const m of migraciones) archivos.push(...(await m.preparar((r) => almacen.leer(r, true))));
    archivos.push({ ruta: RUTAS.esquema, texto: JSON.stringify({ ...esquema.datos, version: VERSION_ESQUEMA }, null, 2) + '\n' });
    setVistaPrevia({ titulo: 'Migrar los datos', archivos, mensaje: `datos: migra el esquema a la versión ${VERSION_ESQUEMA}` });
  }

  return (
    <section className="tarjeta">
      <h2>Estado</h2>
      {error && <div className="error" role="alert">{error.message}</div>}
      {info && (
        <ul className="lista pequeno">
          <li>Repositorio {info.privado ? 'privado' : 'público'} · {info.puedeEscribir ? 'puedes escribir' : 'solo lectura'}</li>
          {esquema.datos && <li>Esquema de datos: versión {versionRepo} (la app usa la {VERSION_ESQUEMA})</li>}
        </ul>
      )}
      {resultado && <div className="ok">{resultado}</div>}
      {noPreparado && !vistaPrevia && (
        <>
          <p className="suave">El repositorio de datos aún no tiene la estructura de la app.</p>
          <button
            className="boton primario"
            disabled={!info?.puedeEscribir}
            onClick={() => setVistaPrevia({ titulo: 'Preparar el repositorio de datos', archivos: archivosIniciales(), mensaje: 'datos: prepara el repositorio' })}
          >
            Preparar el repositorio de datos
          </button>
          {!info?.puedeEscribir && <p className="suave pequeno">Necesitas un token con permiso de escritura.</p>}
        </>
      )}
      {versionRepo > VERSION_ESQUEMA && (
        <div className="aviso">Los datos son de una versión más nueva de la app. Recarga la página para actualizarla.</div>
      )}
      {migraciones.length > 0 && !vistaPrevia && (
        <>
          <div className="aviso">Hay {migraciones.length} migración(es) de datos disponible(s):</div>
          <ul className="pequeno">{migraciones.map((m) => <li key={m.de}>{m.descripcion}</li>)}</ul>
          <button className="boton" onClick={prepararMigracion}>Ver vista previa de la migración</button>
        </>
      )}
      {vistaPrevia && (
        <div>
          <h3>{vistaPrevia.titulo}</h3>
          <p className="suave">Se hará un solo commit, "{vistaPrevia.mensaje}", con estos archivos:</p>
          <ul className="pequeno">
            {vistaPrevia.archivos.map((a) => <li key={a.ruta}><code>{a.ruta}</code></li>)}
          </ul>
          {errorAccion && <div className="error" role="alert">{errorAccion}</div>}
          <div className="fila">
            <button className="boton primario" disabled={trabajando} onClick={ejecutar}>{trabajando ? 'Escribiendo…' : 'Confirmar'}</button>
            <button className="boton" disabled={trabajando} onClick={() => setVistaPrevia(undefined)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Sincronizacion() {
  const { almacen } = useDatos();
  const e = useEstadoSync();
  if (!e.configurado) return null;
  return (
    <section className="tarjeta">
      <h2>Sincronización</h2>
      {e.soloLectura && <div className="aviso">Modo solo lectura: sin token puedes ver los datos pero no cambiarlos.</div>}
      {e.aviso && <div className={e.aviso.transitorio ? 'aviso' : 'error'}>{e.aviso.message}</div>}
      {e.pendientes === 0 ? (
        <p className="suave">Todo guardado en GitHub.</p>
      ) : (
        <>
          <p className="suave">
            {e.pendientes} cambio{e.pendientes > 1 ? 's' : ''} guardado{e.pendientes > 1 ? 's' : ''} en el móvil pendiente{e.pendientes > 1 ? 's' : ''} de enviar.
          </p>
          <ul className="lista pequeno">
            {almacen.operaciones.map((op) => (
              <li key={op.id}>
                <div>{op.mensaje}</div>
                {op.error && (
                  <>
                    <div className="error" style={{ marginTop: 6 }}>{op.error}</div>
                    <div className="fila">
                      <button className="boton" onClick={() => almacen.reintentar(op.id)}>Reintentar</button>
                      <button
                        className="boton peligro"
                        onClick={() => confirm(`¿Descartar "${op.mensaje}"? Este cambio se perderá.`) && almacen.descartar(op.id)}
                      >
                        Descartar
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button className="boton" disabled={e.sincronizando} onClick={() => almacen.sincronizar()}>
            {e.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </>
      )}
    </section>
  );
}

function Instalar() {
  return (
    <section className="tarjeta">
      <details>
        <summary>Instalar en el iPhone</summary>
        <ol className="pasos">
          <li>Abre esta página en Safari.</li>
          <li>Pulsa Compartir (el cuadrado con la flecha).</li>
          <li>Elige "Añadir a pantalla de inicio".</li>
        </ol>
        <div className="aviso">
          La app instalada tiene su propio almacenamiento, separado de Safari: al abrirla por primera vez tendrás que volver a
          poner aquí el token.
        </div>
      </details>
    </section>
  );
}

function ComoToken() {
  return (
    <section className="tarjeta">
      <details>
        <summary>Cómo crear el token de GitHub (gratis)</summary>
        <ol className="pasos">
          <li>GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li>
          <li>Repository access: "Only select repositories" y elige solo el repo de datos.</li>
          <li>Permissions → Repository permissions → Contents: "Read and write". Nada más.</li>
          <li>Pon una caducidad (p. ej. 1 año), genera y pégalo arriba.</li>
        </ol>
        <p className="suave pequeno">El token se queda solo en este dispositivo. Si lo pierdes o caduca, genera otro.</p>
      </details>
    </section>
  );
}
