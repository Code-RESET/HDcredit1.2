/* ============================================================
   FIREBASE (lazy load)
============================================================ */
function connectFirebase() {
  const raw = document.getElementById('fb-input').value.trim();
  let cfg;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { toast('No se encontró configuración válida', 'err'); return; }
    let json = match[0];
    // Unquoted keys: apiKey: => "apiKey":
    json = json.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    // Curly/smart quotes => straight quotes
    json = json.replace(/[“”„‟‘’]/g, '"');
    // Trailing commas
    json = json.replace(/,\s*}/g, '}');
    cfg = JSON.parse(json);
    if (!cfg.apiKey || !cfg.projectId) { toast('Falta apiKey o projectId', 'err'); return; }
  } catch(e) {
    toast('Error: ' + e.message, 'err'); return;
  }
  // En modo prueba la configuración sale SOLO de firebase-prueba.local.js
  if (MODO_PRUEBA) { toast('Modo prueba: la configuración se toma de js/firebase-prueba.local.js', 'err'); return; }
  localStorage.setItem('hd_fb', JSON.stringify(cfg));
  // Si este teléfono venía trabajando en modo local y tiene datos, NO se
  // conecta directo (la nube reemplazaría lo local): pasa por el rescate.
  if (!USE_FB && hayDatosLocales()) {
    document.getElementById('fb-cfg').style.display = 'none';
    localStorage.setItem('hd_rescate_pendiente', '1');
    iniciarRescate(cfg);
    return;
  }
  loadFirebaseSDK(cfg);
}

// opts.rescate: conexión para el rescate — no arranca la sincronización y,
// si falla, no cambia de modo (el rescate decide). Devuelve true/false.
// opts.soloSesion: carga el SDK, espera el login y la confirmación de la
// nube; no sincroniza ni carga datos. Si el SDK no carga, se queda en la
// pantalla de login (sin SDK no se sabe quién es el usuario: no se muestra nada).
function loadFirebaseSDK(cfg, opts = {}) {
  return new Promise(resolve => _loadFirebaseSDK(cfg, opts, resolve));
}
function _loadFirebaseSDK(cfg, opts, resolve) {
  // Defensa extra: el modo prueba nunca toca el proyecto real
  if (MODO_PRUEBA && esProyectoReal(cfg)) {
    bloquearInicio('Modo prueba se niega a iniciar: la configuración apunta al proyecto REAL de HD Crédit.');
    resolve(false);
    return;
  }
  const fallar = (msg) => {
    reportarError('Conectar Firebase', new Error(msg));
    if (opts.soloSesion) {
      mostrarLogin(msg + ' Sin el inicio de sesión no se muestran datos. Conéctate a internet y toca Reintentar.', 'err');
      formularioLogin(false);
      botonReintentar(true);
      resolve(false);
      return;
    }
    if (!opts.rescate) {
      toast(msg + ' Se trabaja en este dispositivo hasta reconectar.', 'err');
      modoLocalTemporal(msg);
    }
    resolve(false);
  };
  // No reinyectar los <script> del SDK si ya están cargados (evita duplicados
  // al reconectar Firebase más de una vez en la misma sesión)
  if (window.firebase && typeof firebase.firestore === 'function') { initFB(cfg, opts).then(resolve); return; }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  let settled = false;
  // Si la red va lenta o se traba, no dejar la app esperando indefinidamente:
  // a los 12s se trabaja en local SOLO por esta sesión (no se guarda como
  // modo permanente: el siguiente arranque vuelve a intentar la nube)
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    fallar('Firebase tardó demasiado en responder.');
  }, 12000);

  // SDK de Auth: login con correo y contraseña en la pantalla de la app
  // (sin ventanas emergentes ni Google) — ver js/sesion.js.
  loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js')
    .then(() => loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'))
    .then(() => loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'))
    .then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      initFB(cfg, opts).then(resolve);
    })
    .catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fallar('No se pudo cargar Firebase SDK.');
    });
}

// Todos los usuarios autorizados comparten la misma ruta de datos
// (usuarios/compartido/...). Quién entra lo deciden el login (js/sesion.js)
// y las reglas de Firestore (firestore.rules: solo UID autorizados).
const UID_COMPARTIDO = 'compartido';
let _persistenciaPedida = false;
let _hayEscriturasPendientes = false; // último estado conocido del SDK (snap.metadata)

// Abre Firestore una sola vez. Persistencia offline: la app sigue
// funcionando sin internet y lo que se haga sin conexión sube solo al
// volver la señal. Se pide antes de cualquier otro uso de Firestore.
function abrirFirestore() {
  if (!DB) DB = firebase.firestore();
  if (!_persistenciaPedida) {
    _persistenciaPedida = true;
    DB.enablePersistence({synchronizeTabs: true}).catch(e => {
      // Sin persistencia, un cobro hecho sin señal se pierde al cerrar la app
      reportarError('Persistencia offline no disponible', e);
    });
  }
  return DB;
}

async function initFB(cfg, opts = {}) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    // Nada de datos antes de tener sesión Y de que la nube confirme el UID
    await asegurarSesion();
    abrirFirestore();
    if (!(await verificarAcceso())) return false;
    if (opts.soloSesion) return true;
    USE_FB = true;
    document.getElementById('fb-cfg').style.display = 'none';
    CURRENT_UID = UID_COMPARTIDO;
    // El estado real (sincronizado / local / subiendo) lo decide startFBSync()
    // a partir de snap.metadata, que refleja la conexión real con Firestore
    // (más confiable que navigator.onLine, que solo mira la red del dispositivo)
    // En rescate todavía NO se sincroniza: la sincronización reemplazaría
    // los datos locales antes de compararlos
    if (opts.rescate) return true;
    _modoLocalTemporal = false;
    const banner = document.getElementById('banner-sinsync');
    if (banner) banner.hidden = true;
    setSyncLbl(navigator.onLine ? 'ok' : 'local');
    startFBSync();
    return true;
  } catch(e) {
    reportarError('Iniciar Firebase', e);
    toast('Error Firebase: ' + e.message, 'err');
    USE_FB = false;
    if (opts.soloSesion) { mostrarLogin('Error al iniciar Firebase: ' + e.message, 'err'); return false; }
    if (!opts.rescate) modoLocalTemporal('Error al iniciar Firebase');
    return false;
  }
}

// Rutas de datos: usuarios/compartido/... (sin login, ver UID_COMPARTIDO arriba)
function CLI() { return DB.collection('usuarios').doc(CURRENT_UID).collection('clientes'); }
function HIST() { return DB.collection('usuarios').doc(CURRENT_UID).collection('historial'); }

function setSyncLbl(estado) {
  const el = document.getElementById('sync-lbl');
  if (!el) return;
  if (estado === 'sin-sync') { el.textContent = '🔴 SIN SINCRONIZAR — solo en este teléfono'; el.style.color = 'var(--danger)'; }
  else if (estado === 'local') { el.textContent = '🟡 Sin internet — guardando en el dispositivo'; el.style.color = 'var(--warn)'; }
  else if (estado === 'pendiente') { el.textContent = '🟡 Cambios guardados — subiendo…'; el.style.color = 'var(--warn)'; }
  else if (estado === 'error') { el.textContent = '🔴 Desconectado — reintentando…'; el.style.color = 'var(--danger)'; }
  else { el.textContent = '🟢 Sincronizado'; el.style.color = 'var(--accent)'; }
}

function startFBSync() {
  // Cancelar listeners anteriores para evitar duplicados si se reconecta
  if (_unsubClientes) { _unsubClientes(); _unsubClientes = null; }
  if (_unsubHistorial) { _unsubHistorial(); _unsubHistorial = null; }
  // Reiniciar paginación de historial (sesión/reconexión nueva)
  _histAntiguo = []; _histCursor = null; _histPaginando = false; _histHayMas = true;
  let _errToastAt = 0;
  _unsubClientes = CLI().orderBy('createdAt').onSnapshot({includeMetadataChanges: true}, snap => {
    // Se confía siempre en el snapshot (incluye listas vacías reales, p.ej.
    // al eliminar el último acreditado) — antes se descartaba ese caso y la
    // pantalla quedaba con datos obsoletos
    // Los cobros en cola (hechos sin red) se superponen: la pantalla no los
    // "olvida" mientras no suben
    clientes = aplicarColaSobre(snap.docs.map(d => ({id: d.id, ...d.data()})));
    syncAlertas();
    // Con el almacenamiento lleno, setItem lanza: se registra pero la
    // pantalla se actualiza igual (antes el error cortaba el refresh)
    try { localStorage.setItem('hd_c', JSON.stringify(clientes)); }
    catch(e) { reportarError('Guardar copia local de acreditados', e); }
    refresh();
    // metadata.fromCache: se está mostrando la copia local (sin red);
    // metadata.hasPendingWrites: hay cobros hechos aquí que aún no suben
    const enCola = leerCola().length;
    _hayEscriturasPendientes = !!snap.metadata.hasPendingWrites;
    if (snap.metadata.fromCache) setSyncLbl('local');
    else if (snap.metadata.hasPendingWrites || enCola) setSyncLbl('pendiente');
    else setSyncLbl('ok');
    if (!snap.metadata.fromCache) {
      // Momento de la última copia confirmada por la nube: el rescate lo usa
      // para saber si un acreditado que falta fue borrado en otro teléfono
      try { localStorage.setItem('hd_ultima_sync', new Date().toISOString()); } catch(e) {}
      if (enCola) procesarColaCobros();
    }
  }, err => {
    reportarError('Sincronización de acreditados', err);
    setSyncLbl('error');
    if (err && err.code === 'permission-denied') { accesoRevocado(); return; }
    if (Date.now() - _errToastAt > 30000) { _errToastAt = Date.now(); toast('Error de sincronización: ' + err.message, 'err'); }
  });
  // En vivo solo se sincroniza lo reciente (ventana de tiempo, no un conteo
  // fijo de documentos) — cubre checklist, dashboard y reportes sin traer
  // cada vez el historial completo. Lo más viejo se carga bajo demanda con
  // cargarMasHistorial() (botón "Cargar más" en la vista Historial) o al
  // generar un respaldo/exportación completa (ver obtenerHistorialCompleto).
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - HIST_DIAS_RECIENTES);
  _unsubHistorial = HIST().where('ts', '>=', cutoff.toISOString()).orderBy('ts', 'desc').onSnapshot(snap => {
    _histReciente = snap.docs.map(d => ({id: d.id, ...d.data()}));
    // No pisar el cursor de paginación una vez que el usuario ya pidió más
    if (!_histPaginando) _histCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    mergeHistorial();
    renderH();
    renderCL();
    renderDash();
  }, err => {
    reportarError('Sincronización de historial', err);
    if (err && err.code === 'permission-denied') { accesoRevocado(); return; }
    if (Date.now() - _errToastAt > 30000) { _errToastAt = Date.now(); toast('Error de sincronización: ' + err.message, 'err'); }
  });
}

// (El modo "Solo local" elegido a mano se quitó: entraba sin login. Un
// teléfono que lo usaba ahora inicia sesión y pasa por el rescate; sus
// datos locales se conservan.)

// Datos (nube o copia local) solo con un acceso confirmado. Única
// excepción: las pruebas automáticas (navigator.webdriver), que corren el
// modo local sin Firebase — ver arrancarConexion().
let _modoLocalAutomatizado = false;
function puedeVerDatos() { return _autorizado || _modoLocalAutomatizado; }

// Modo local por FALLO (red lenta, SDK que no carga…): solo por esta
// sesión. No se guarda 'local'; el siguiente arranque reintenta la nube.
// Lo que se cobre mientras tanto queda en el teléfono y, al reconectar,
// pasa por el rescate (ver rescate.js) en vez de ser reemplazado.
let _modoLocalTemporal = false;
function modoLocalTemporal(motivo) {
  USE_FB = false;
  _modoLocalTemporal = true;
  document.getElementById('fb-cfg').style.display = 'none';
  loadLocal();
  setSyncLbl('sin-sync');
  mostrarBannerSinSync(motivo);
}

function mostrarBannerSinSync(motivo) {
  const b = document.getElementById('banner-sinsync');
  if (!b) return;
  const t = document.getElementById('banner-sinsync-txt');
  if (t) t.textContent = '⚠️ SIN SINCRONIZAR — lo que hagas se guarda solo en este teléfono' + (motivo ? ' (' + motivo + ')' : '');
  b.hidden = false;
}

function hayDatosLocales() {
  try {
    const c = JSON.parse(localStorage.getItem('hd_c') || '[]');
    const h = JSON.parse(localStorage.getItem('hd_h') || '[]');
    return (Array.isArray(c) && c.length > 0) || (Array.isArray(h) && h.length > 0);
  } catch(e) { return true; } // ante la duda, proteger
}

/* ============================================================
   PAGINACIÓN DE HISTORIAL
============================================================ */
function mergeHistorial() {
  const ids = new Set(_histReciente.map(h => h.id).concat(_histAntiguo.map(h => h.id)));
  const pendientes = movimientosEnCola().filter(h => !ids.has(h.id)).reverse();
  historial = pendientes.concat(_histReciente, _histAntiguo);
  try { localStorage.setItem('hd_h', JSON.stringify(historial)); }
  catch(e) { reportarError('Guardar copia local de historial', e); }
}

// Trae la siguiente página de historial viejo (fuera de la ventana en vivo).
// Se llama al tocar "Cargar más" en la vista Historial.
async function cargarMasHistorial() {
  if (!USE_FB || !_histCursor || _histCargando || !_histHayMas) return;
  _histCargando = true;
  renderH();
  try {
    const snap = await HIST().orderBy('ts', 'desc').startAfter(_histCursor).limit(200).get();
    if (snap.empty) {
      _histHayMas = false;
    } else {
      _histAntiguo = _histAntiguo.concat(snap.docs.map(d => ({id: d.id, ...d.data()})));
      _histCursor = snap.docs[snap.docs.length - 1];
      _histPaginando = true;
      if (snap.docs.length < 200) _histHayMas = false;
      mergeHistorial();
    }
  } catch(e) {
    toast('No se pudo cargar más historial: ' + e.message, 'err');
  }
  _histCargando = false;
  renderH();
}

// Trae TODO el historial en Firestore (paginado internamente), sin depender
// de lo que ya esté sincronizado en vivo. Se usa solo para que los respaldos
// (JSON/Excel) sean completos aunque la vista en pantalla muestre menos.
async function obtenerHistorialCompleto() {
  if (!USE_FB) return historial;
  const out = [];
  let cursor = null;
  while (true) {
    let q = HIST().orderBy('ts', 'desc').limit(500);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    out.push(...snap.docs.map(d => ({id: d.id, ...d.data()})));
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 500) break;
  }
  return out;
}

/* ============================================================
   LOCAL STORAGE
============================================================ */
function syncAlertas() {
  let changed = false;
  clientes = clientes.map(c => {
    const alerta = calcAlerta(c);
    if (alerta !== (c.alerta || '')) { changed = true; return {...c, alerta}; }
    return c;
  });
  // Recalcular alertas no es un cambio del usuario: se guarda sin marcar
  // "rescate pendiente"
  if (changed) {
    try { localStorage.setItem('hd_c', JSON.stringify(clientes)); }
    catch(e) { reportarError('Guardar alertas en el dispositivo', e); }
  }
}

function loadLocal() {
  // Candado: la copia del teléfono solo se muestra con un acceso confirmado
  if (!puedeVerDatos()) {
    clientes = []; historial = [];
    mostrarLogin('No se puede mostrar la copia de este teléfono sin un acceso confirmado.', 'err');
    return;
  }
  try { clientes = JSON.parse(localStorage.getItem('hd_c') || '[]'); }
  catch(e) { clientes = []; toast('⚠️ Datos corruptos en almacenamiento local — se inició vacío. Restaura un respaldo JSON.', 'err'); }
  try { historial = JSON.parse(localStorage.getItem('hd_h') || '[]'); }
  catch(e) { historial = []; }
  // Si no hay datos, intentar recuperar del respaldo automático antes de rendirnos
  if (!clientes.length) {
    for (const bkKey of ['hd_bk_0', 'hd_bk_1']) {
      try {
        const bk = JSON.parse(localStorage.getItem(bkKey) || 'null');
        if (bk && Array.isArray(bk.clientes) && bk.clientes.length) {
          clientes = bk.clientes;
          if (!historial.length && Array.isArray(bk.historial)) historial = bk.historial;
          toast('Datos recuperados del respaldo automático (' + new Date(bk.ts).toLocaleDateString() + ') ✅', 'ok');
          break;
        }
      } catch(e) { reportarError('Leer respaldo automático ' + bkKey, e); }
    }
  }
  syncAlertas();
  refresh();
}

function saveLocal() {
  try {
    localStorage.setItem('hd_c', JSON.stringify(clientes));
    localStorage.setItem('hd_h', JSON.stringify(historial));
    // Un cambio hecho en modo local temporal debe rescatarse antes de
    // volver a sincronizar (si no, la nube lo reemplazaría)
    if (_modoLocalTemporal) localStorage.setItem('hd_rescate_pendiente', '1');
  } catch(e) {
    reportarError('Guardar en el dispositivo', e);
    toast('⚠️ Almacenamiento lleno — exporta un respaldo JSON ahora para no perder datos', 'err');
  }
}


