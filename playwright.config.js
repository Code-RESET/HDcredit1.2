// Configuración mínima: sirve el repo como archivos estáticos y corre las
// pruebas de tests/ contra ese servidor. No hay build — es el mismo
// index.html que se despliega.
module.exports = {
  testDir: './tests',
  // Cada prueba espera animaciones/toasts reales (doble toque, deshacer),
  // así que 30s por defecto queda justo en máquinas lentas — se sube a 60s.
  timeout: 60000,
  webServer: {
    command: 'npx http-server -p 4173 -c-1 .',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
    // Sin service worker: sus peticiones no pasan por page.route(), así que
    // podría salir a internet sin el bloqueo de Firebase de las pruebas (y
    // además recarga la página al activarse, lo que vuelve flaky un test).
    serviceWorkers: 'block',
  },
};
