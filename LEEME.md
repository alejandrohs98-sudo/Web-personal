# Kilómetros y Lentejas

App web personal de nutrición y entrenamiento, instalable en el iPhone (PWA) y alojada en GitHub Pages.
Un solo usuario. Interfaz en español, móvil primero.

## Arquitectura

- **Este repositorio** contiene solo código: Vite + React + TypeScript, sin backend.
- **Los datos** viven en otro repositorio (`kyl-datos`, privado). La app los lee y escribe desde el navegador con la API REST de GitHub y un token *fine-grained* que solo vive en el dispositivo.
- No hay scripts de terceros en tiempo de ejecución. La Content-Security-Policy va en una `<meta>` (GitHub Pages no permite cabeceras) y solo deja conectar con `api.github.com`.

```
src/
  datos/
    github.ts       cliente de la API: lectura con ETag, escritura (PUT con sha), commit de varios archivos (Git Data API)
    almacen.ts      vista = datos del repo + cambios pendientes; cola sin conexión; conflictos
    operaciones.ts  los cambios son operaciones (fijar, fusionar, añadir, actualizar…), no archivos completos
    idb.ts          IndexedDB: caché de la última versión buena y cola de pendientes
    esquema.ts      rutas, archivos iniciales, valores por defecto en memoria, migraciones
    errores.ts      errores comprensibles (token, límite, sin conexión…)
    ajustes.ts      ajustes del dispositivo (localStorage)
  ui/               pantallas React
tests/
  unit/             Vitest
  e2e/              Playwright a 390 px
  fixtures/         GitHub simulado en memoria y datos inventados
```

### Cómo se escribe

1. Cada cambio del usuario se expresa como una **operación** sobre un archivo (p. ej. "fija `carrito.arroz = true` en `datos/compra/2026-W41.json`") con un mensaje de commit legible.
2. La operación se guarda primero en la **cola de IndexedDB** y la pantalla la muestra al instante.
3. El sincronizador lee la versión actual del archivo, aplica la operación y hace `PUT` con el `sha`.
4. Si GitHub responde **409** (otro dispositivo escribió entre medias), se vuelve a leer, se reaplica y se reintenta una vez. Si vuelve a fallar, la operación se queda en la cola con el error y Ajustes ofrece *Reintentar* o *Descartar*. Nunca se pierde.
5. Sin conexión, la cola espera y se envía al recuperar la conexión, al volver a la app o cada 20 s. iOS no tiene Background Sync: solo se envía con la app abierta.

### Cómo se lee

- `GET /repos/{owner}/{repo}/contents/{ruta}` con `If-None-Match` (ETag). Nunca `raw.githubusercontent.com`, que tiene caché de minutos.
- `cache: 'no-store'` en el `fetch`, porque la caché HTTP del navegador devolvería datos viejos justo después de guardar.
- Los directorios se listan y solo se descargan los archivos cuyo `sha` ha cambiado.
- Sin conexión se muestra la última versión buena guardada en IndexedDB.

## Reglas de los datos

1. Código y datos en repositorios distintos. Aquí no hay datos de usuario; los fixtures de `tests/fixtures` son inventados.
2. **Lectura tolerante**: los campos desconocidos se conservan (las operaciones solo tocan caminos concretos) y los que faltan se rellenan en memoria con `conDefectos`, sin reescribir el archivo.
3. `datos/esquema.json` lleva `{ "version": N }`. Si algún día hay que transformar datos, se añade una migración aditiva a `MIGRACIONES` en `src/datos/esquema.ts`. Solo se ejecuta desde Ajustes, tras una vista previa, en un único commit.
4. Cada escritura es un commit con mensaje legible (`receta: añade Pollo al chilindrón`). El historial de Git es la copia de seguridad.
5. Borrar es archivar (`"archivado": true`); la Papelera restaura o elimina del todo.
6. Nunca se escribe un archivo que no se ha podido interpretar como JSON.

### Estructura del repo de datos

```
datos/esquema.json
datos/perfil.json
datos/ingredientes.json        { "ingredientes": [...] }
datos/recetas/<id>.json
datos/menus/<AAAA-Www>.json
datos/despensa.json            { "nota": "", "items": { "<ingredienteId>": { "tengo", "nota", "actualizado" } } }
datos/compra/<AAAA-Www>.json
datos/comidas/<AAAA-MM>.json
datos/entrenos/<AAAA-MM>.json
datos/medidas.json             { "medidas": [...] }
```

## Puesta en marcha

1. Crea el repo de datos `kyl-datos` **privado** y marca *Add a README file* (así todo cabe en un commit).
2. Crea un token *fine-grained*: solo ese repo, permiso *Contents: Read and write*.
3. Abre la app → ⋯ → Ajustes: dueño, repo, rama y token → Guardar → *Preparar el repositorio de datos*.

## Desarrollo

```bash
npm ci
npm run dev          # http://localhost:5173/Web-personal/
npm test             # unitarios
npm run test:e2e     # Playwright (en este contenedor: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium)
```

Durante el desarrollo no se escribe nunca en el repo de datos real: los tests usan el GitHub simulado y, para probar a mano, se configura en Ajustes un repo de pruebas.

## Despliegue

El workflow `.github/workflows/desplegar.yml` comprueba tipos y ejecuta los tests en cada push. En `main` además publica en GitHub Pages.

- Una sola vez: *Settings → Pages → Source: GitHub Actions*.
- La ruta base sale del nombre del repo (`BASE_PATH=/<repo>/`). Si se renombra el repo, no hay que tocar nada.
- URL: `https://alejandrohs98-sudo.github.io/Web-personal/`
