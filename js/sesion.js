/* ============================================================
   SESIÓN: login con correo y contraseña (Firebase Authentication)

   - Solo correo y contraseña en la pantalla de la app: sin Google, sin
     popups, sin inicio anónimo.
   - Una sesión solo es VÁLIDA si la nube confirma que el UID está
     autorizado (una lectura directa al servidor que las reglas solo
     permiten a los UID de la lista). Sin esa confirmación no se muestra
     NINGÚN dato, ni de la nube ni la copia guardada en el teléfono.
   - Sin internet, solo puede ver la copia local un UID que la nube ya
     confirmó antes EN ESTE TELÉFONO (lista 'hd_autorizados'). Otra cuenta
     no ve nada aunque el teléfono tenga datos guardados.
   - La contraseña nunca se guarda: va directo a Firebase y el campo se vacía.
   - Cerrar sesión (normal o anónima vieja) nunca pierde lo pendiente: se
     sube antes o se fuerza el rescate; si no se puede, no se cierra.

   MODO PRUEBA: se activa con ?prueba=1, en el sitio de Hosting de
   hd-credit-prueba, en un navegador ya marcado como de prueba, o si el
   servidor tiene js/firebase-prueba.local.js. En modo prueba solo se usa
   esa configuración y nunca la real.
============================================================ */
const PROYECTO_REAL = 'hdcredit12-2c6ba';

function esHostPrueba(host) {
  return /^hd-credit-prueba(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)$/i.test(String(host || ''));
}
function _marcaEntorno() { try { return localStorage.getItem('hd_entorno'); } catch(e) { return null; } }
let MODO_PRUEBA = (() => {
  try { if (new URLSearchParams(location.search).get('prueba') === '1') return true; } catch(e) {}
  return esHostPrueba(location.hostname) || _marcaEntorno() === 'prueba';
})();

let _cfgNube = null;       // configuración con la que arrancó esta sesión
let _esperaSesion = null;  // promesa única de asegurarSesion()
let _usuario = null;
let _autorizado = false;   // la nube (o una confirmación previa en este teléfono) lo aceptó
let _cerrando = false;     // cierre pedido aquí: no tratarlo como sesión perdida
let _migrandoAnonimo = false;

// ¿La configuración apunta al proyecto real? Se mira cualquier campo:
// la apiKey/appId deciden a qué Auth va el login, el projectId a qué base.
function esProyectoReal(cfg) {
  if (!cfg) return false;
  const real = (typeof DEFAULT_FB_CONFIG !== 'undefined') ? DEFAULT_FB_CONFIG : {};
  const huellas = [PROYECTO_REAL, real.apiKey, real.appId, real.messagingSenderId]
    .filter(Boolean).map(s => String(s).toLowerCase());
  return Object.values(cfg).some(v => {
    const s = String(v || '').toLowerCase().replace(/\s+/g, '');
    return huellas.some(h => s.includes(h));
  });
}

/* ---------- Pantalla de login ---------- */
function mostrarLogin(msg, tipo) {
  const scr = document.getElementById('login-scr');
  if (!scr) return;
  scr.classList.add('on');
  document.body.classList.add('sin-sesion');
  if (msg !== undefined) avisoLogin(msg, tipo);
}
function ocultarLogin() {
  const scr = document.getElementById('login-scr');
  if (scr) scr.classList.remove('on');
  document.body.classList.remove('sin-sesion');
}
function avisoLogin(msg, tipo = 'err') {
  const el = document.getElementById('login-msg');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  el.dataset.tipo = tipo;
}
function formularioLogin(habilitado) {
  ['login-email', 'login-pass', 'login-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !habilitado;
  });
}
function botonReintentar(visible) {
  const b = document.getElementById('login-reintentar');
  if (b) b.hidden = !visible;
}
// Bloqueo de esta sesión: no se conecta a nada y no se muestran datos.
function bloquearInicio(motivo) {
  mostrarLogin(motivo, 'err');
  formularioLogin(false);
  const f = document.getElementById('login-form');
  if (f) f.hidden = true;
  reportarError('Inicio bloqueado', new Error(motivo));
}
// Mensaje que sobrevive a la recarga (p. ej. "usuario no autorizado")
function _mensajeTrasRecarga(msg) { try { sessionStorage.setItem('hd_login_msg', msg); } catch(e) {} }
function pintarMensajePendiente() {
  let m = null;
  try { m = sessionStorage.getItem('hd_login_msg'); sessionStorage.removeItem('hd_login_msg'); } catch(e) {}
  if (m) avisoLogin(m, 'err');
}
function pintarBannerPrueba(cfg) {
  const b = document.getElementById('login-prueba');
  if (b) {
    b.hidden = !MODO_PRUEBA;
    b.textContent = '🧪 MODO PRUEBA' + (cfg && cfg.projectId ? ' — proyecto ' + cfg.projectId : '');
  }
  document.body.classList.toggle('modo-prueba', MODO_PRUEBA);
}
function pintarUsuario(user) {
  const n = document.getElementById('ui-name');
  if (n && user) n.textContent = (MODO_PRUEBA ? '🧪 ' : '') + (user.email || user.uid);
  const s = document.getElementById('ni-salir');
  if (s) s.style.display = user ? '' : 'none';
}

/* ---------- Entorno y configuración ---------- */
function _cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
// Si el servidor tiene la configuración de prueba, este sitio ES de prueba:
// se fuerza el modo prueba aunque falte ?prueba=1 (app instalada, enlace
// sin el parámetro). En producción ese archivo no existe (ignorado por git).
async function detectarEntorno() {
  try { await _cargarScript('js/firebase-prueba.local.js'); } catch(e) { /* no existe: sitio normal */ }
  if (window.HD_FIREBASE_PRUEBA) MODO_PRUEBA = true;
  return MODO_PRUEBA;
}
// ¿Este navegador ya tiene datos de la app? (cualquier clave hd_ salvo el
// registro de errores y la marca de entorno)
function hayRastrosApp() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('hd_') && k !== 'hd_err' && k !== 'hd_entorno') return true;
    }
  } catch(e) { return true; }
  return false;
}

function configPrueba() {
  pintarBannerPrueba(null);
  const cfg = window.HD_FIREBASE_PRUEBA;
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    bloquearInicio('Modo prueba: falta js/firebase-prueba.local.js con la configuración del Firebase de PRUEBA (copia js/firebase-prueba.example.js). No se conecta a nada.');
    return null;
  }
  if (esProyectoReal(cfg)) {
    bloquearInicio('Modo prueba se niega a iniciar: la configuración apunta al proyecto REAL (' + PROYECTO_REAL + ').');
    return null;
  }
  if (_marcaEntorno() !== 'prueba' && hayRastrosApp()) {
    bloquearInicio('Modo prueba se niega a iniciar: este navegador tiene datos de la app real. Usa otro navegador o perfil (o una ventana nueva sin datos del sitio).');
    return null;
  }
  try { localStorage.setItem('hd_entorno', 'prueba'); } catch(e) {}
  pintarBannerPrueba(cfg);
  return cfg;
}

// Configuración con la que se conecta esta sesión. null = no conectar.
// En modo prueba NUNCA se usa la configuración real ni la guardada.
async function configNube(saved) {
  if (MODO_PRUEBA) return configPrueba();
  let cfg = DEFAULT_FB_CONFIG;
  if (saved && saved !== 'local') {
    try { cfg = JSON.parse(saved); } catch(e) { cfg = DEFAULT_FB_CONFIG; }
  }
  return cfg;
}

/* ---------- Autorización confirmada por la nube ---------- */
function _autorizados() {
  try { const v = JSON.parse(localStorage.getItem('hd_autorizados') || '[]'); return Array.isArray(v) ? v : []; }
  catch(e) { return []; }
}
function _marcarAutorizado(uid) {
  const l = _autorizados();
  if (!l.includes(uid)) { l.push(uid); try { localStorage.setItem('hd_autorizados', JSON.stringify(l)); } catch(e) {} }
}
function _quitarAutorizado(uid) {
  try { localStorage.setItem('hd_autorizados', JSON.stringify(_autorizados().filter(u => u !== uid))); } catch(e) {}
}

// 'ok' (la nube lo aceptó ahora) | 'ok-sin-red' (sin red, pero la nube ya
// confirmó este UID antes en este teléfono) | 'denegado' | 'sin-confirmar'
async function confirmarAutorizacion(user) {
  try {
    const q = DB.collection('usuarios').doc(UID_COMPARTIDO).collection('clientes').limit(1);
    await conTiempoLimite(q.get({ source: 'server' }), 10000, 'La nube no respondió');
    _marcarAutorizado(user.uid);
    return 'ok';
  } catch(e) {
    if (e && e.code === 'permission-denied') { _quitarAutorizado(user.uid); return 'denegado'; }
    return _autorizados().includes(user.uid) ? 'ok-sin-red' : 'sin-confirmar';
  }
}

// Se llama desde initFB con Firestore ya abierto. true = puede ver datos.
let _verificacion = null;
function verificarAcceso() {
  if (_autorizado) return Promise.resolve(true);
  if (_verificacion) return _verificacion;
  _verificacion = (async () => {
    const user = _usuario;
    avisoLogin('Confirmando acceso con la nube…', 'info');
    formularioLogin(false);
    const r = await confirmarAutorizacion(user);
    if (r === 'ok' || r === 'ok-sin-red') {
      _autorizado = true;
      pintarUsuario(user);
      avisoLogin('');
      ocultarLogin();
      if (r === 'ok-sin-red') toast('Sin conexión: se usa la copia de este teléfono (acceso confirmado antes).', 'wrn');
      return true;
    }
    if (r === 'denegado') {
      reportarError('Acceso denegado', new Error('UID no autorizado: ' + user.uid));
      _mensajeTrasRecarga(`Este usuario (${user.email || user.uid}) no está autorizado.\nUID: ${user.uid}\nPide que lo agreguen a las reglas.`);
      _cerrando = true;
      try { await firebase.auth().signOut(); } catch(e) {}
      location.reload();
      return false;
    }
    // sin-confirmar: no se muestra nada; la sesión se conserva para reintentar
    mostrarLogin('No se pudo confirmar tu acceso con la nube (¿sin internet?). Este teléfono no tiene una confirmación anterior para este usuario, así que no se muestran datos. Conéctate y toca Reintentar.', 'err');
    botonReintentar(true);
    _verificacion = null;
    return false;
  })();
  return _verificacion;
}

// El servidor dejó de aceptar a este usuario (lo quitaron de las reglas)
async function accesoRevocado() {
  if (_cerrando) return;
  const uid = _usuario && _usuario.uid;
  if (uid) _quitarAutorizado(uid);
  protegerPendientesAntesDeSalir();
  _mensajeTrasRecarga('Tu usuario ya no tiene acceso (UID: ' + (uid || '?') + '). Lo guardado en este teléfono se conserva.');
  _cerrando = true;
  _quitarDatosDePantalla();
  try { await firebase.auth().signOut(); } catch(e) {}
  location.reload();
}

/* ---------- Sesión ---------- */
// Resuelve con el usuario cuando hay una sesión con correo y contraseña.
// Mientras tanto la pantalla de login queda visible. Una sesión anónima
// vieja primero intenta subir lo pendiente y fuerza el rescate.
function asegurarSesion() {
  if (_esperaSesion) return _esperaSesion;
  formularioLogin(true);
  pintarMensajePendiente();
  _esperaSesion = new Promise(resolve => {
    let listo = false;
    firebase.auth().onAuthStateChanged(user => {
      if (user && user.isAnonymous) {
        if (!_migrandoAnonimo) { _migrandoAnonimo = true; migrarSesionAnonima(); }
        return;
      }
      if (user) {
        _usuario = user;
        if (!listo) { listo = true; resolve(user); }
        return;
      }
      _usuario = null;
      if (listo) { if (!_cerrando) sesionPerdida(); return; }
      mostrarLogin();
    });
  });
  return _esperaSesion;
}

// Versión anterior (sesión anónima): antes de cerrarla se intenta subir lo
// que el SDK tenga pendiente y, como esas escrituras pudieron rechazarse
// (las reglas nuevas no aceptan anónimos), lo guardado en el teléfono pasa
// SIEMPRE por el rescate al entrar. Nada se borra.
async function migrarSesionAnonima() {
  formularioLogin(false);
  avisoLogin('Guardando lo pendiente de la versión anterior…', 'info');
  let subido = false;
  try {
    const db = abrirFirestore();
    await conTiempoLimite(db.waitForPendingWrites(), 15000, 'No terminó de subir lo pendiente');
    subido = true;
  } catch(e) { reportarError('Subir pendientes de la sesión anterior', e); }
  if (hayDatosLocales()) { try { localStorage.setItem('hd_rescate_pendiente', '1'); } catch(e) {} }
  try { await firebase.auth().signOut(); } catch(e) { reportarError('Cerrar sesión anterior', e); }
  _migrandoAnonimo = false;
  formularioLogin(true);
  avisoLogin(subido ? 'Inicia sesión con tu correo y contraseña.' : 'Inicia sesión: lo guardado en este teléfono se revisará con el rescate al entrar.', 'info');
}

function _mensajeErrorLogin(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/.test(c)) return 'Correo o contraseña incorrectos.';
  if (/invalid-email/.test(c)) return 'El correo no es válido.';
  if (/too-many-requests/.test(c)) return 'Demasiados intentos. Espera unos minutos.';
  if (/user-disabled/.test(c)) return 'Este usuario está desactivado.';
  if (/network-request-failed/.test(c)) return 'Sin internet: se necesita conexión para iniciar sesión.';
  if (/operation-not-allowed/.test(c)) return 'El acceso con correo y contraseña no está habilitado en este proyecto.';
  return 'No se pudo iniciar sesión' + (c ? ' (' + c + ')' : '') + '.';
}

async function iniciarSesion(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const emailEl = document.getElementById('login-email');
  const passEl = document.getElementById('login-pass');
  const email = (emailEl.value || '').trim();
  const pass = passEl.value || '';
  if (!email || !pass) { avisoLogin('Escribe correo y contraseña.'); return; }
  if (!window.firebase || typeof firebase.auth !== 'function') { avisoLogin('Todavía cargando… intenta en unos segundos.'); return; }
  formularioLogin(false);
  avisoLogin('Entrando…', 'info');
  try {
    await firebase.auth().signInWithEmailAndPassword(email, pass);
  } catch(e) {
    avisoLogin(_mensajeErrorLogin(e));
    formularioLogin(true);
  } finally {
    passEl.value = ''; // la contraseña no se queda en la página
  }
}

function _quitarDatosDePantalla() {
  if (_unsubClientes) { _unsubClientes(); _unsubClientes = null; }
  if (_unsubHistorial) { _unsubHistorial(); _unsubHistorial = null; }
  clientes = []; historial = []; _histReciente = []; _histAntiguo = [];
  try { refresh(); } catch(e) {}
}

// Si al salir quedó algo sin confirmar por la nube, el siguiente inicio
// pasa por el rescate (compara lo del teléfono con la nube): nada se pierde.
function protegerPendientesAntesDeSalir() {
  if ((_hayEscriturasPendientes || _modoLocalTemporal) && hayDatosLocales()) {
    try { localStorage.setItem('hd_rescate_pendiente', '1'); } catch(e) {}
  }
}

// La sesión se cerró sin pedirlo aquí (Firebase la invalidó)
function sesionPerdida() {
  protegerPendientesAntesDeSalir();
  _quitarDatosDePantalla();
  _mensajeTrasRecarga('La sesión se cerró. Vuelve a entrar.');
  location.reload();
}

// Revisa lo pendiente antes de salir. Devuelve null si se puede salir, o el
// motivo por el que NO se puede (la salida se bloquea).
async function pendientesQueBloqueanSalida() {
  if (rescatePendiente()) return 'Hay un rescate pendiente: termínalo antes de cerrar sesión.';
  if (!USE_FB || !DB) {
    if (_modoLocalTemporal && hayDatosLocales()) return 'Estás trabajando sin sincronizar: hay cambios solo en este teléfono. Reconecta antes de cerrar sesión.';
    return null;
  }
  // Cobros en cola: se intenta subirlos ahora
  if (leerCola().length) {
    if (navigator.onLine) {
      toast('Subiendo cobros pendientes antes de salir…', 'wrn');
      const fin = Date.now() + 20000;
      while (Date.now() < fin && (leerCola().length || _procesandoCola)) {
        await procesarColaCobros();
        if (!leerCola().length) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    const n = leerCola().length;
    if (n) return `Hay ${n} cobro(s) que aún no suben a la nube. Conéctate a internet y vuelve a intentar.`;
  }
  // Altas, ediciones y borrados que el SDK aún no confirma
  try {
    await conTiempoLimite(DB.waitForPendingWrites(), 15000, 'sin confirmar');
  } catch(e) {
    return 'Hay altas o ediciones que aún no suben a la nube. Conéctate a internet y vuelve a intentar.';
  }
  return null;
}

async function cerrarSesion() {
  if (_cerrando) return;
  const motivo = await pendientesQueBloqueanSalida();
  if (motivo) {
    toast('No se cerró la sesión. ' + motivo, 'err');
    alert('No se puede cerrar sesión todavía.\n\n' + motivo);
    return;
  }
  const rev = typeof leerRevision === 'function' ? leerRevision().length : 0;
  const aviso = (rev ? `Hay ${rev} cobro(s) por revisar; se quedan guardados en este teléfono.\n\n` : '') + '¿Cerrar sesión en este teléfono?';
  if (!confirm(aviso)) return;
  _cerrando = true;
  _quitarDatosDePantalla();
  mostrarLogin('', 'info');
  try { await firebase.auth().signOut(); } catch(e) { reportarError('Cerrar sesión', e); }
  location.reload();
}

window.iniciarSesion = iniciarSesion;
window.cerrarSesion = cerrarSesion;
window.esHostPrueba = esHostPrueba;
