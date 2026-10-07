import { expect, test } from '@playwright/test';
import { conGitHubFalso, configurar } from './ayudas';

test('primera vez: configurar el repo y prepararlo en un solo commit', async ({ page }) => {
  const falso = await conGitHubFalso(page);
  const errores: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

  await page.goto('./');
  // Viene con el repo por defecto, que en el GitHub simulado no existe.
  await expect(page.getByRole('alert').first()).toContainText('No se encuentra el repositorio de datos');
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('menuitem', { name: 'Ajustes' }).click();

  await page.getByLabel('Dueño').fill('yo');
  await page.getByLabel('Repositorio', { exact: true }).fill('datos');
  await page.getByLabel(/Token de GitHub/).fill('tk');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText('Repositorio privado · puedes escribir')).toBeVisible();
  const commitsAntes = falso.commits.length;
  await page.getByRole('button', { name: 'Preparar el repositorio de datos' }).click();
  await expect(page.getByText('datos/perfil.json')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Hecho: datos: prepara el repositorio')).toBeVisible();

  expect(falso.commits.length).toBe(commitsAntes + 1);
  expect(falso.leer('datos/esquema.json')).toEqual({ version: 1 });
  await expect(page.getByText('Esquema de datos: versión 1')).toBeVisible();

  await page.getByRole('button', { name: 'Hoy' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Alejandro' })).toBeVisible();

  // Móvil primero: nada se sale por los lados a 390 px.
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho).toBeLessThanOrEqual(390);
  expect(errores.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test('sin token y repo público: solo lectura y lo dice', async ({ page }) => {
  await conGitHubFalso(page, { privado: false, archivos: { 'datos/esquema.json': '{"version":1}', 'datos/perfil.json': '{"nombre":"Alejandro"}' } });
  await configurar(page, '');
  await page.goto('./');
  await expect(page.getByText('Solo lectura')).toBeVisible();
  await page.goto('./#/ajustes');
  await expect(page.getByText(/Modo solo lectura/)).toBeVisible();
});

test('repo privado sin token: error comprensible', async ({ page }) => {
  await conGitHubFalso(page, { privado: true });
  await configurar(page, '');
  await page.goto('./');
  await expect(page.getByRole('alert').first()).toContainText('Si el repo de datos es privado necesitas un token');
});

test('token caducado: error comprensible', async ({ page }) => {
  await conGitHubFalso(page, { token: 'bueno', archivos: { 'datos/esquema.json': '{"version":1}' } });
  await configurar(page, 'caducado');
  await page.goto('./');
  await expect(page.getByRole('alert').first()).toContainText('no es válido o ha caducado');
});
