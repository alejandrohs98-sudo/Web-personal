import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ProveedorDatos } from './ui/contexto';
import './ui/estilos.css';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorDatos>
      <App />
    </ProveedorDatos>
  </StrictMode>,
);
