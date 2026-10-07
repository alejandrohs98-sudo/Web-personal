import { RUTAS } from '../../datos/esquema';
import { navegar } from '../App';
import { useArchivo, useDatos } from '../contexto';

export function PantallaHoy() {
  const { gh } = useDatos();
  const esquema = useArchivo<{ version: number }>(gh ? RUTAS.esquema : null);
  const perfil = useArchivo<{ nombre?: string }>(esquema.datos ? RUTAS.perfil : null);
  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <p className="suave" style={{ marginTop: 0, textTransform: 'capitalize' }}>{fecha}</p>
      {!gh && (
        <div className="tarjeta">
          <h2>Bienvenido</h2>
          <p className="suave">Para empezar, configura el repositorio de datos.</p>
          <button className="boton primario" onClick={() => navegar('ajustes')}>Ir a Ajustes</button>
        </div>
      )}
      {esquema.error && (
        <div className="error" role="alert">
          {esquema.error.message} <button className="boton" onClick={() => navegar('ajustes')}>Ajustes</button>
        </div>
      )}
      {gh && esquema.datos === null && (
        <div className="tarjeta">
          <h2>Repositorio sin preparar</h2>
          <p className="suave">El repositorio de datos todavía no tiene la estructura de la app.</p>
          <button className="boton primario" onClick={() => navegar('ajustes')}>Preparar en Ajustes</button>
        </div>
      )}
      {esquema.datos && (
        <div className="tarjeta">
          <h2>Hola, {perfil.datos?.nombre ?? 'Alejandro'}</h2>
          <p className="suave">Datos conectados. El resumen del día (comidas, kcal, proteína y entreno) llega en las fases 2 y 3.</p>
        </div>
      )}
    </>
  );
}
