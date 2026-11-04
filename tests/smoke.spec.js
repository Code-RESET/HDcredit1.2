// Pruebas de humo (smoke tests) de HD Crédit — modo local, sin depender de
// un proyecto real de Firebase. El objetivo no es cubrir cada caso, sino
// atrapar si un cambio futuro rompe el flujo del día a día: crear un
// acreditado, cobrar, revertir, ver historial, exportar y eliminar.
//
// Cómo correrlas:
//   npm install
//   npx playwright install chromium   (solo la primera vez)
//   npm test
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Fuerza modo local: las pruebas no dependen de un Firebase real
  // (modo local elegido a mano: si no, la app intentaría reconectar a la nube)
  await page.addInitScript(() => { localStorage.setItem('hd_fb', 'local'); localStorage.setItem('hd_local_manual', '1'); });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200); // loader inicial de la app
});

test.afterEach(async ({ page }) => {
  expect(page.errors, 'no debe haber errores de JavaScript en pantalla').toEqual([]);
});

async function crearAcreditado(page, nombre) {
  await page.click('#v-checklist >> text=Agregar');
  await page.fill('#f-nom', nombre);
  await page.selectOption('#f-monto', '5000');
  await page.selectOption('#f-plazo', '6');
  await page.click('.modal button:has-text("Guardar")');
  await page.waitForTimeout(400);
}

// El botón de cobro parpadea (animación CSS) mientras espera el segundo
// toque de confirmación — Playwright no hace clic normal en un elemento que
// se está moviendo, así que el segundo toque necesita { force: true }.
async function cobrarPrimeraQuincena(page) {
  const boton = page.locator('.pb2.u').first();
  await boton.click();
  await page.waitForTimeout(150);
  await boton.click({ force: true });
  await page.waitForTimeout(400);
}

// Navegación del sidebar: selector acotado a #sidebar .ni, más confiable
// que un text= genérico que puede chocar con otros textos de la página.
async function irA(page, etiqueta) {
  await page.click(`#sidebar .ni:has-text("${etiqueta}")`);
  await page.waitForTimeout(250);
}

test('la app arranca sin errores y navega por todas las vistas', async ({ page }) => {
  for (const texto of ['Acreditados', 'Historial', 'Panel Principal', 'Reportes', 'Tabla de Factores', 'Morosos y Recargos', 'Control de Cobros']) {
    await irA(page, texto);
  }
});

test('crear un acreditado lo refleja en el dashboard y la tabla', async ({ page }) => {
  await crearAcreditado(page, 'PRUEBA SMOKE 1');

  await irA(page, 'Panel Principal');
  await expect(page.locator('#s-total')).toHaveText('1');

  await irA(page, 'Acreditados');
  await expect(page.locator('#tb-c')).toContainText('PRUEBA SMOKE 1');
});

test('cobrar una quincena la registra en Historial y actualiza el saldo', async ({ page }) => {
  await crearAcreditado(page, 'PRUEBA SMOKE 2');
  await irA(page, 'Control de Cobros');
  await cobrarPrimeraQuincena(page);

  await irA(page, 'Historial');
  await expect(page.locator('#tb-h')).toContainText('PRUEBA SMOKE 2');
  await expect(page.locator('#tb-h')).toContainText('PAGO');
});

test('retroceder un pago lo quita de Historial como REVERSO', async ({ page }) => {
  await crearAcreditado(page, 'PRUEBA SMOKE 3');
  await irA(page, 'Control de Cobros');
  await cobrarPrimeraQuincena(page);

  // El mismo botón, ya cobrado, abre el modal de retroceder pago
  const cobradoBtn = page.locator('.pb2.ck').first();
  await cobradoBtn.click();
  await page.waitForTimeout(300);
  await page.click('.rev-item');
  await page.click('#rev-ok');
  await page.waitForTimeout(400);

  await irA(page, 'Historial');
  await expect(page.locator('#tb-h')).toContainText('REVERSO');
});

test('eliminar un acreditado lo quita de la tabla y del conteo', async ({ page }) => {
  await crearAcreditado(page, 'PRUEBA SMOKE 4');
  await irA(page, 'Acreditados');

  page.once('dialog', d => d.accept());
  await page.click('button[onclick*="confirmDel"]');
  await page.waitForTimeout(200);
  await page.click('#conf-ok');
  await page.waitForTimeout(400);

  await expect(page.locator('#tb-c')).not.toContainText('PRUEBA SMOKE 4');
  await irA(page, 'Panel Principal');
  await expect(page.locator('#s-total')).toHaveText('0');
});

test('el respaldo JSON exportado incluye acreditados e historial', async ({ page }) => {
  await crearAcreditado(page, 'PRUEBA SMOKE 5');
  await irA(page, 'Control de Cobros');
  await cobrarPrimeraQuincena(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#sidebar .ni:has-text("Respaldo JSON")'),
  ]);
  const streamPath = await download.path();
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(streamPath, 'utf8'));
  expect(payload.clientes.length).toBe(1);
  expect(payload.clientes[0].nombre).toBe('PRUEBA SMOKE 5');
  expect(payload.historial.length).toBe(1);
});
