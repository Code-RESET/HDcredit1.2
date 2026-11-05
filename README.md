# HDcredit1.2

Sistema de control de pagos quincenal HD Crédit — PWA de archivo único (`index.html`), con sincronización opcional en Firebase/Firestore o almacenamiento solo local.

## Login con correo y contraseña

La app pide **correo y contraseña** (Firebase Authentication, proveedor "Correo electrónico/contraseña") en su propia pantalla: sin ventanas de Google ni popups. El inicio de sesión anónimo se quitó. Antes de iniciar sesión **no se muestra ningún dato** (ni de la nube ni la copia guardada en el teléfono). La contraseña no se guarda en ningún archivo ni en el teléfono; Firebase conserva solo su token de sesión.

Todos los usuarios autorizados comparten la ruta `usuarios/compartido/...`. Quién puede leer/escribir lo decide `firestore.rules`: solo los UID de la lista y solo con correo y contraseña (los anónimos se rechazan).

- Sin internet: un teléfono que **ya inició sesión** antes sigue funcionando con su copia local; uno que nunca inició sesión se queda en el login.
- "Cerrar sesión" (menú lateral) quita los datos de la pantalla; los cobros en cola se quedan guardados en el teléfono.
- El modo "Solo local" elegido a mano sigue sin login (no usa la nube).

### Modo prueba (`?prueba=1`)

1. Copia `js/firebase-prueba.example.js` como `js/firebase-prueba.local.js` (ignorado por git) y pega la configuración del Firebase **de prueba**.
2. Abre `http://localhost:4173/index.html?prueba=1` (`npx http-server -p 4173 -c-1 .`).

El modo prueba solo usa ese archivo y **se niega a iniciar** si apunta al proyecto real (`hdcredit12-2c6ba`), si falta el archivo, o si el navegador ya tiene datos de la app real. A la inversa, la app real se niega a conectar en un navegador marcado como de pruebas.

### Activar en producción (orden seguro)

1. Firebase real → Authentication → habilitar **Correo electrónico/contraseña** y crear los usuarios; anotar sus UID.
2. Antes de desplegar: en cada teléfono, exportar un **respaldo JSON** y esperar a que no haya cobros en cola.
3. Desplegar esta versión. La regla actual (`request.auth != null`) también acepta a estos usuarios, así que nada se corta.
4. Iniciar sesión en cada teléfono y comprobar que sincroniza.
5. Poner los UID reales en `firestore.rules`, probarlas en el simulador de reglas de la consola y **solo entonces** publicarlas.
6. Deshabilitar el proveedor "Anónimo" y borrar los usuarios anónimos viejos.

## Modo offline

La app funciona normalmente sin internet: lee la última copia conocida de los datos guardada en el dispositivo. Los cobros que se registren sin conexión se guardan en cola y se suben solos en cuanto vuelve la señal, sin que haya que hacer nada manualmente (persistencia offline nativa de Firestore).

## Correcciones incluidas en esta actualización

- Se activó la persistencia offline de Firestore — la app sigue funcionando sin internet y sincroniza sola al recuperar la señal.
- Se redujo el riesgo de que dos dispositivos cobrando casi al mismo tiempo se pisen el registro de pagos entre sí.
- Corregido un hueco de seguridad (XSS) en el tooltip de fecha de inicio de la tabla de Acreditados.
- El respaldo automático ahora incluye el historial de pagos, no solo los acreditados.
- El indicador de sincronización ahora refleja el estado real de conexión con Firestore, no solo si hay red en el dispositivo.
- Corregido: la app se quedaba cargando indefinidamente si la red iba lenta al cargar el SDK de Firebase (ahora carga en paralelo con límite de espera de 10s).
- Corregido: eliminar el último acreditado o movimiento sincronizado ya no dejaba la pantalla con datos obsoletos.
- Corregido: los campos del historial ahora se escapan al mostrarse (previene HTML/scripts inyectados).
- Corregido: el saldo y el estado de un acreditado se calculan en un solo lugar (`resumenCliente()`), en vez de recalcularse de forma distinta en Reporte Personal y Estado de Cuenta.
- Corregido: los cobros y guardados que fallan en la nube ahora muestran un error real, en vez de un mensaje de éxito optimista.
- Corregido: reconectar Firebase ya no duplica la carga del SDK.
- Corregido: el Historial (y los reportes, respaldo JSON y Excel que dependen de él) ya no perdía de vista los pagos más antiguos al superar los 500 registros — se quitó el límite fijo de la consulta a Firestore, así que ahora se sincroniza el historial completo.
- El historial en vivo ahora se limita a los últimos ~200 días (en vez de traer todo desde siempre en cada apertura), para gastar muchas menos lecturas de Firestore a medida que pasan los años. Lo más viejo sigue disponible con el botón "Cargar historial anterior" o al generar un respaldo/exportación completa.
- El código de `index.html` (antes un solo bloque de ~1800 líneas) se dividió en módulos (`js/datos.js`, `sync.js`, `negocio.js`, `ui.js`, `export.js`, `app.js`) para que sea más fácil de mantener, sin cambiar ningún comportamiento.
- Se agregó una suite de smoke tests (Playwright, en `tests/`) que cubre crear/cobrar/revertir/eliminar un acreditado y exportar el respaldo — ver instrucciones de instalación más abajo.
- `togglePago()` ahora usa una transacción real de Firestore (`runTransaction`) cuando hay conexión, en vez de "leer y luego escribir por separado" — elimina el riesgo de que dos dispositivos cobrando el mismo acreditado casi al mismo tiempo se pisen entre sí. Sin conexión sigue funcionando igual que antes (cola offline).

## Pruebas automatizadas

```
npm install
npx playwright install chromium   # solo la primera vez
npm test
```

Corren contra un servidor estático local, en modo "solo local" (sin depender de un Firebase real). No afectan el despliegue — la app sigue siendo los mismos archivos estáticos de siempre.
