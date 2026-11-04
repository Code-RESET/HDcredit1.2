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
function loadFirebaseSDK(cfg, opts = {}) {
  return new Promise(resolve => _loadFirebaseSDK(cfg, opts, resolve));
}
function _loadFirebaseSDK(cfg, opts, resolve) {
  const fallar = (msg) => {
    reportarError('Conectar Firebase', new Error(msg));
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

  // Se vuelve a cargar el SDK de Auth (además de app + firestore), pero SOLO
  // para inicio de sesión anónimo y silencioso (sin ventana emergente, sin
  // pantalla de Google) — ver authAnonimo() más abajo. No es el login
  // interactivo que se quitó antes.
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

// Sin login interactivo: todos los dispositivos comparten la misma ruta de
// datos (usuarios/compartido/...). Antes esto solo estaba protegido por
// reglas de Firestore abiertas a cualquiera; ahora cada dispositivo se
// autentica solo (ver authAnonimo), para poder exigir "if request.auth !=
// null" en las reglas sin volver a pedirle nada al usuario.
const UID_COMPARTIDO = 'compartido';

// Inicia sesión anónima en segundo plano: identifica el dispositivo ante
// Firestore SIN pedir nada al usuario (sin ventana, sin popup, sin Google).
// Sirve para poder exigir "if request.auth != null" en las reglas de
// Firestore en vez de dejarlas abiertas a cualquiera. Si falla o tarda, la
// app sigue funcionando igual que hasta ahora (no bloquea nada) — solo
// importa una vez que las reglas del proyecto se actualicen para exigirlo.
function authAnonimo() {
  return new Promise(resolve => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('HD Crédit — auth anónima tardó demasiado, se continúa sin esperar más');
      resolve(false);
    }, 8000);
    firebase.auth().signInAnonymously()
      .then(() => { if (settled) return; settled = true; clearTimeout(t); resolve(true); })
      .catch(e => { if (settled) return; settled = true; clearTimeout(t); console.warn('HD Crédit — auth anónima falló:', e.code || e.message); resolve(false); });
  });
}

async function initFB(cfg, opts = {}) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    DB = firebase.firestore();
    USE_FB = true;
    document.getElementById('fb-cfg').style.display = 'none';
    CURRENT_UID = UID_COMPARTIDO;
    // Persistencia offline: la app sigue funcionando sin internet (lee de la
    // copia local en el dispositivo) y los cobros que se hagan sin conexión
    // se guardan en cola y se suben solos en cuanto vuelve la señal
    DB.enablePersistence({synchronizeTabs: true}).catch(e => {
      // Sin persistencia, un cobro hecho sin señal se pierde al cerrar la app
      reportarError('Persistencia offline no disponible', e);
    });
    // El estado real (sincronizado / local / subiendo) lo decide startFBSync()
    // a partir de snap.metadata, que refleja la conexión real con Firestore
    // (más confiable que navigator.onLine, que solo mira la red del dispositivo)
    await authAnonimo();
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
    clientes = snap.docs.map(d => ({id: d.id, ...d.data()}));
    syncAlertas();
    localStorage.setItem('hd_c', JSON.stringify(clientes));
    refresh();
    // metadata.fromCache: se está mostrando la copia local (sin red);
    // metadata.hasPendingWrites: hay cobros hechos aquí que aún no suben
    if (snap.metadata.fromCache) setSyncLbl('local');
    else if (snap.metadata.hasPendingWrites) setSyncLbl('pendiente');
    else setSyncLbl('ok');
  }, err => {
    reportarError('Sincronización de acreditados', err);
    setSyncLbl('error');
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
    if (Date.now() - _errToastAt > 30000) { _errToastAt = Date.now(); toast('Error de sincronización: ' + err.message, 'err'); }
  });
}

// Modo local ELEGIDO por el usuario (botón "Solo local"): se guarda como
// permanente y se marca como manual para distinguirlo de un fallo.
function goLocal() {
  localStorage.setItem('hd_fb', 'local');
  localStorage.setItem('hd_local_manual', '1');
  document.getElementById('fb-cfg').style.display = 'none';
  loadLocal();
}

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
  historial = _histReciente.concat(_histAntiguo);
  localStorage.setItem('hd_h', JSON.stringify(historial));
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

/* ============================================================
   SEED DATA (from your Excel file)
============================================================ */
function xlDate(n) {
  if (!n) return '';
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return d.toISOString().split('T')[0];
}

function seedData() {
  const raw = [
    {n:'IVON',m:8000,pq:1067,nq:12,ini:45976,pg:12,s:0,a:''},
    {n:'E.NANCY',m:5000,pq:667,nq:12,ini:45976,pg:12,s:0,a:''},
    {n:'YISEL',m:8000,pq:1200,nq:10,ini:46021,pg:10,s:0,a:''},
    {n:'TREJO',m:6000,pq:800,nq:12,ini:46006,pg:12,s:0,a:''},
    {n:'GABI',m:4000,pq:604,nq:10,ini:45991,pg:10,s:0,a:''},
    {n:'H/TERE',m:5000,pq:751,nq:10,ini:46006,pg:10,s:0,a:''},
    {n:'JOSE LUIS',m:5000,pq:900,nq:8,ini:46127,pg:2,s:5400,a:'ATRASADO'},
    {n:'ANDREA',m:4000,pq:601,nq:10,ini:46037,pg:10,s:0,a:''},
    {n:'SAHIRA',m:5000,pq:667,nq:12,ini:46037,pg:8,s:2668,a:'ATRASADO'},
    {n:'SAM',m:8000,pq:1067,nq:12,ini:46037,pg:8,s:4268,a:'ATRASADO'},
    {n:'JASIEL',m:10000,pq:1501,nq:10,ini:46052,pg:8,s:3002,a:''},
    {n:'PERLA 12Q',m:12000,pq:1600,nq:12,ini:46052,pg:10,s:3200,a:''},
    {n:'JESUS 71',m:5000,pq:751,nq:10,ini:46052,pg:7,s:2253,a:''},
    {n:'LORENA',m:15000,pq:2001,nq:12,ini:46052,pg:7,s:10005,a:''},
    {n:'ERIKA',m:15000,pq:2001,nq:12,ini:46068,pg:6,s:12006,a:'ATRASADO'},
    {n:'VERONICA',m:5000,pq:751,nq:10,ini:46068,pg:7,s:2253,a:''},
    {n:'ESTELA',m:5000,pq:667,nq:12,ini:46068,pg:6,s:4002,a:'ATRASADO'},
    {n:'MARI TERE',m:3000,pq:650,nq:6,ini:46068,pg:5,s:650,a:'ATRASADO'},
    {n:'DIOSDADO',m:10000,pq:1334,nq:12,ini:46068,pg:6,s:8004,a:'ATRASADO'},
    {n:'JULIA',m:5000,pq:667,nq:12,ini:46081,pg:5,s:4669,a:'ATRASADO'},
    {n:'VIVIANA',m:5000,pq:667,nq:12,ini:46081,pg:5,s:4669,a:'ATRASADO'},
    {n:'PAULINA',m:5000,pq:751,nq:10,ini:46081,pg:4,s:4506,a:'ATRASADO'},
    {n:'OLGA',m:2000,pq:467,nq:6,ini:46081,pg:5,s:467,a:'ATRASADO'},
    {n:'JOSE LUIS 2',m:5000,pq:900,nq:8,ini:46096,pg:4,s:3600,a:'ATRASADO'},
    {n:'GISEL',m:5000,pq:1083,nq:6,ini:46111,pg:3,s:3249,a:'ATRASADO'},
    {n:'VANE',m:7000,pq:1050,nq:10,ini:46111,pg:3,s:7350,a:'ATRASADO'},
    {n:'PERLA 7K',m:7000,pq:934,nq:12,ini:46111,pg:4,s:7472,a:''},
    {n:'ROXANA',m:6000,pq:800,nq:12,ini:46127,pg:2,s:8000,a:'ATRASADO'},
    {n:'E.NANCY 2',m:4000,pq:722,nq:8,ini:46127,pg:2,s:4332,a:'ATRASADO'},
    {n:'JAZ',m:4000,pq:534,nq:12,ini:46127,pg:2,s:5340,a:'ATRASADO'},
    {n:'YISEL 2',m:8000,pq:1200,nq:10,ini:46142,pg:1,s:10800,a:'ATRASADO'},
    {n:'TERE',m:7000,pq:1264,nq:8,ini:46142,pg:1,s:8848,a:'ATRASADO'},
    {n:'ABRIL',m:5000,pq:900,nq:8,ini:46142,pg:1,s:6300,a:'ATRASADO'},
    {n:'JOSE LUIS 3',m:4000,pq:722,nq:8,ini:46143,pg:1,s:5054,a:'ATRASADO'},
    {n:'ANGEL C.',m:15000,pq:2601,nq:8,ini:46143,pg:1,s:18207,a:'ATRASADO'},
    {n:'MARI TERE 2',m:5000,pq:1083,nq:6,ini:46157,pg:0,s:6498,a:'ATRASADO'},
    {n:'DANIEL',m:6000,pq:800,nq:12,ini:46157,pg:0,s:9600,a:'ATRASADO'},
    {n:'LUISA',m:6000,pq:1300,nq:6,ini:46157,pg:0,s:7800,a:'ATRASADO'},
    {n:'TREJO 2',m:8000,pq:1067,nq:12,ini:46172,pg:0,s:12804,a:''},
    {n:'MAMA DE SAM',m:8000,pq:1067,nq:12,ini:46172,pg:0,s:12804,a:''},
    {n:'ANDREA 2',m:6000,pq:800,nq:12,ini:46172,pg:0,s:9600,a:''},
    {n:'NAYE',m:6000,pq:800,nq:12,ini:46172,pg:0,s:9600,a:''},
    {n:'JESY',m:4000,pq:722,nq:8,ini:0,pg:0,s:5776,a:''},
    {n:'H/TERE 2',m:6000,pq:900,nq:10,ini:46172,pg:0,s:9000,a:''},
  ];
  clientes = raw.map((r, i) => ({
    id: 'c_' + i + '_' + Date.now(),
    nombre: r.n, monto: r.m, pq: r.pq, nq: r.nq,
    inicio: xlDate(r.ini), pagadas: r.pg, saldo: r.s,
    alerta: r.a, telefono: '', notas: '',
    pagos: Array(r.nq).fill(false).map((_,j) => j < r.pg),
    createdAt: new Date().toISOString()
  }));
  saveLocal();
}

