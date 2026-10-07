import { horaLocal } from '../util/fechas';

export type TipoError =
  | 'sin-conexion'
  | 'token-invalido'
  | 'sin-permiso'
  | 'limite'
  | 'no-encontrado'
  | 'conflicto'
  | 'repo-vacio'
  | 'datos-invalidos'
  | 'otro';

export class ErrorDatos extends Error {
  constructor(
    public tipo: TipoError,
    mensaje: string,
    public estado?: number,
    /** Epoch en segundos en que se libera el límite de peticiones. */
    public resetEn?: number,
  ) {
    super(mensaje);
    this.name = 'ErrorDatos';
  }

  /** ¿Merece la pena reintentar más tarde sin intervención del usuario? */
  get transitorio(): boolean {
    return this.tipo === 'sin-conexion' || this.tipo === 'limite';
  }
}

export function errorDeRed(): ErrorDatos {
  return new ErrorDatos('sin-conexion', 'Sin conexión. Los cambios quedan guardados en el móvil y se enviarán al recuperarla.');
}

/** Traduce una respuesta HTTP fallida de GitHub a un error comprensible. */
export async function errorDeRespuesta(res: Response, conToken: boolean): Promise<ErrorDatos> {
  let detalle = '';
  try {
    const cuerpo = await res.json();
    detalle = typeof cuerpo?.message === 'string' ? cuerpo.message : '';
  } catch {
    /* sin cuerpo JSON */
  }
  const restantes = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset')) || undefined;

  if ((res.status === 403 || res.status === 429) && (restantes === '0' || /rate limit/i.test(detalle))) {
    const cuando = reset ? ` Se libera a las ${horaLocal(reset)}.` : '';
    const pista = conToken ? '' : ' Sin token el límite es de 60 peticiones por hora; con token, 5.000.';
    return new ErrorDatos('limite', `Límite de peticiones de GitHub alcanzado.${cuando}${pista}`, res.status, reset);
  }
  if (res.status === 401) {
    return new ErrorDatos('token-invalido', 'El token de GitHub no es válido o ha caducado. Genera uno nuevo y ponlo en Ajustes.', 401);
  }
  if (res.status === 403) {
    return new ErrorDatos(
      'sin-permiso',
      'El token no tiene permiso sobre este repositorio. Revisa que tenga acceso al repo de datos con "Contents: Read and write".',
      403,
    );
  }
  if (res.status === 404) {
    const msg = conToken
      ? 'No se encuentra el repositorio de datos. Revisa dueño, nombre y rama en Ajustes, y que el token tenga acceso a ese repo.'
      : 'No se encuentra el repositorio de datos. Revisa dueño y nombre en Ajustes. Si el repo de datos es privado necesitas un token.';
    return new ErrorDatos('no-encontrado', msg, 404);
  }
  if (res.status === 409 && /empty/i.test(detalle)) {
    return new ErrorDatos('repo-vacio', 'El repositorio de datos está vacío. Créalo con un README inicial.', 409);
  }
  if (res.status === 409 || (res.status === 422 && /sha/i.test(detalle))) {
    return new ErrorDatos('conflicto', 'El archivo ha cambiado en GitHub mientras guardabas.', res.status);
  }
  return new ErrorDatos('otro', `GitHub respondió ${res.status}${detalle ? `: ${detalle}` : ''}.`, res.status);
}
