# HDcredit1.2

Sistema de control de pagos quincenal HD Crédit — PWA de archivo único (`index.html`), con sincronización opcional en Firebase/Firestore o almacenamiento solo local.

## Login con correo y contraseña

La app pide **correo y contraseña** (Firebase Authentication, proveedor "Correo electrónico/contraseña") en su propia pantalla: sin ventanas de Google ni popups. El inicio de sesión anónimo se quitó. Antes de iniciar sesión **no se muestra ningún dato** (ni de la nube ni la copia guardada en el teléfono). La contraseña no se guarda en ningún archivo ni en el teléfono; Firebase conserva solo su token de sesión.

Todos los usuarios autorizados comparten la ruta `usuarios/compartido/...`. Quién puede leer/escribir lo decide `firestore.rules`: solo los UID de la lista y solo con correo y contraseña (los anónimos se rechazan).

- **La sesión solo vale si la nube confirma el UID** (una lectura directa al servidor que las reglas solo permiten a los UID de la lista). Una cuenta no autorizada se cierra sola y no ve nada.
- Sin internet: solo ve la copia del teléfono un UID que la nube **ya confirmó antes en ese teléfono** (`hd_autorizados`). Otra cuenta, o un teléfono sin poder cargar el SDK, no ve nada.
- "Solo local" se quitó. Un teléfono que lo usaba inicia sesión y pasa por el rescate; sus datos se conservan.
- Cerrar sesión primero sube los cobros en cola y las altas/ediciones pendientes; si no puede (sin red, rescate pendiente), **no deja salir**. Sin pendientes pero sin conexión con la nube, avisa antes de salir que no se podrá volver a entrar hasta tener internet. Una sesión anónima de la versión anterior intenta subir lo pendiente y fuerza el rescate antes de cerrarse; sin internet se conserva hasta tener conexión.
- En producción el proyecto siempre sale de `js/config-real.js`. Un `hd_fb` guardado no lo cambia ni se puede pegar otra configuración; si apuntaba a otro proyecto y el teléfono tiene datos, pasan por el rescate.

### Publicar una versión

Sube el mismo número de versión en `sw.js` (`VERSION`), `index.html` (`HD_VERSION` y los `?v=` de los scripts) y `js/app.js` (`HD_APP_VERSION`). Así el HTML y el JS de versiones distintas no se mezclan; si aun así pasa o un script no carga, la app lo avisa y ofrece Reintentar. Una prueba comprueba que los números coinciden.

### Modo prueba

1. Copia `js/firebase-prueba.example.js` como `js/firebase-prueba.local.js` (ignorado por git) y pega la configuración del Firebase **de prueba**.
2. Abre `http://localhost:4173/index.html?prueba=1` (`npx http-server -p 4173 -c-1 .`).

El modo prueba se activa con `?prueba=1`, en el Hosting de `hd-credit-prueba` (`*.web.app`/`*.firebaseapp.com`), en un navegador ya marcado como de prueba, o si el servidor tiene `js/firebase-prueba.local.js`. Así una app instalada o una URL sin el parámetro **nunca** se conecta al proyecto real. Solo usa ese archivo y **se niega a iniciar** si apunta al proyecto real (projectId, apiKey, appId o senderId), si falta el archivo, o si el navegador ya tiene datos de la app real.

### Activar en producción (orden seguro)

1. Firebase real → Authentication → habilitar **Correo electrónico/contraseña**, **desactivar el registro de usuarios** (Configuración → Acciones del usuario) y crear los usuarios; anotar sus UID. Mientras la regla siga siendo `request.auth != null`, cualquier cuenta con contraseña pasaría la confirmación: por eso el registro debe estar cerrado.
2. Antes de desplegar, en cada teléfono con la versión vieja **y con internet**: ver "🟢 Sincronizado", que no haya cobros en cola y exportar un **respaldo JSON**.
3. Desplegar esta versión. La regla actual acepta a los usuarios con contraseña, así que nada se corta. Al abrirla, cada teléfono sube lo pendiente de su sesión anónima y pasa por el rescate.
4. Iniciar sesión en cada teléfono, terminar el rescate y comprobar que sincroniza.
5. `firestore.rules` ya tiene los UID reales: probarlas en el simulador de reglas de la consola y **solo entonces** publicarlas en el proyecto real (nunca en `hd-credit-prueba`).
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
