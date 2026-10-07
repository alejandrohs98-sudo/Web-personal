// Ajustes del dispositivo. Viven en localStorage y NUNCA se escriben en el repo de datos.
// Ojo: la app instalada en el iPhone tiene su propio almacenamiento, distinto del de Safari.

export interface Ajustes {
  owner: string;
  repo: string;
  rama: string;
  token: string;
}

const CLAVE = 'kyl.ajustes';

export const AJUSTES_POR_DEFECTO: Ajustes = {
  owner: 'alejandrohs98-sudo',
  repo: 'kyl-datos',
  rama: 'main',
  token: '',
};

export function leerAjustes(): Ajustes {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return { ...AJUSTES_POR_DEFECTO, ...(crudo ? JSON.parse(crudo) : {}) };
  } catch {
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(a: Ajustes): void {
  localStorage.setItem(CLAVE, JSON.stringify({ ...a, owner: a.owner.trim(), repo: a.repo.trim(), rama: a.rama.trim() || 'main', token: a.token.trim() }));
}
