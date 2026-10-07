import { useEffect, useState, type ReactNode } from 'react';
import { useEstadoSync } from './contexto';
import { IconoAtras, IconoCompra, IconoEntreno, IconoHoy, IconoMas, IconoMenu, IconoRecetas } from './iconos';
import { PantallaAjustes } from './pantallas/Ajustes';
import { PantallaHoy } from './pantallas/Hoy';
import { Proximamente } from './pantallas/Proximamente';

const PESTANAS = [
  { id: 'hoy', nombre: 'Hoy', icono: <IconoHoy /> },
  { id: 'menu', nombre: 'Menú', icono: <IconoMenu /> },
  { id: 'compra', nombre: 'Compra', icono: <IconoCompra /> },
  { id: 'recetas', nombre: 'Recetas', icono: <IconoRecetas /> },
  { id: 'entreno', nombre: 'Entreno', icono: <IconoEntreno /> },
] as const;

const SECUNDARIAS: Record<string, string> = { ajustes: 'Ajustes', papelera: 'Papelera' };

function rutaActual(): string {
  return location.hash.replace(/^#\/?/, '').split('/')[0] || 'hoy';
}

export function navegar(ruta: string) {
  location.hash = '#/' + ruta;
}

export function App() {
  const [ruta, setRuta] = useState(rutaActual);
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    const f = () => {
      setRuta(rutaActual());
      setMenuAbierto(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const pestana = PESTANAS.find((p) => p.id === ruta);
  const titulo = pestana?.nombre ?? SECUNDARIAS[ruta] ?? 'Kilómetros y Lentejas';

  let pantalla: ReactNode;
  switch (ruta) {
    case 'hoy': pantalla = <PantallaHoy />; break;
    case 'menu': pantalla = <Proximamente fase={2} que="el menú de la semana" />; break;
    case 'compra': pantalla = <Proximamente fase={2} que="la lista de la compra y la despensa" />; break;
    case 'recetas': pantalla = <Proximamente fase={2} que="las recetas y el catálogo de ingredientes" />; break;
    case 'entreno': pantalla = <Proximamente fase={3} que="el registro de entrenos y el historial" />; break;
    case 'ajustes': pantalla = <PantallaAjustes />; break;
    case 'papelera': pantalla = <Proximamente fase={2} que="la papelera (lo archivado se podrá restaurar desde aquí)" />; break;
    default: pantalla = <PantallaHoy />;
  }

  return (
    <div className="app">
      <header className="cabecera" style={{ position: 'sticky' }}>
        {!pestana && (
          <button className="boton-icono" aria-label="Volver" onClick={() => history.length > 1 ? history.back() : navegar('hoy')}>
            <IconoAtras />
          </button>
        )}
        <h1>{titulo}</h1>
        <IndicadorSync />
        <button className="boton-icono" aria-label="Más opciones" aria-expanded={menuAbierto} onClick={() => setMenuAbierto((v) => !v)}>
          <IconoMas />
        </button>
        {menuAbierto && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => navegar('ajustes')}>Ajustes</button>
            <button role="menuitem" onClick={() => navegar('papelera')}>Papelera</button>
          </div>
        )}
      </header>
      <main className="contenido">{pantalla}</main>
      <nav className="pestanas" aria-label="Secciones">
        {PESTANAS.map((p) => (
          <button key={p.id} aria-current={p.id === ruta ? 'page' : undefined} onClick={() => navegar(p.id)}>
            {p.icono}
            {p.nombre}
          </button>
        ))}
      </nav>
    </div>
  );
}

function IndicadorSync() {
  const e = useEstadoSync();
  if (!e.configurado) return null;
  if (e.conError > 0) {
    return <button className="chip error" onClick={() => navegar('ajustes')}>⚠ {e.conError} sin guardar</button>;
  }
  if (e.pendientes > 0) {
    return (
      <button className="chip pendiente" onClick={() => navegar('ajustes')} title="Pendiente de sincronizar">
        {e.sincronizando ? 'Guardando…' : `${e.pendientes} pendiente${e.pendientes > 1 ? 's' : ''} de sincronizar`}
      </button>
    );
  }
  if (e.soloLectura) return <span className="chip">Solo lectura</span>;
  return null;
}
