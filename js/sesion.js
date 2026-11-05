/* ============================================================
   SESIÓN: login con correo y contraseña (Firebase Authentication)

   - No hay inicio de sesión anónimo ni ventanas de Google: solo correo y
     contraseña, escritos en la pantalla de login de la app.
   - Antes de iniciar sesión NO se muestra ningún dato (ni de la nube ni la
     copia guardada en el teléfono): la pantalla de login tapa todo y la app
     no carga datos hasta tener un usuario válido.
   - La contraseña nunca se guarda: va directo a Firebase y el campo se
     vacía. Firebase guarda solo su token de sesión, como cualquier app.
   - Quién puede leer/escribir lo deciden las reglas (firestore.rules):
     solo UID autorizados, nunca anónimos.

   MODO PRUEBA (?prueba=1 en la URL)
   - Usa SOLO la configuración de js/firebase-prueba.local.js (archivo
     local, ignorado por git; ver js/firebase-prueba.example.js).
   - Se niega a iniciar si esa configuración apunta al proyecto real, si
     falta el archivo, o si el navegador tiene datos de la app real.
============================================================ */
const PROYECTO_REAL = 'hdcredit12-2c6ba';
const MODO_PRUEBA = (() => {
  try { return new URLSearchParams(location.search).get('prueba') === '1'; } catch(e) { return false; }
})();
let _cfgNube = null;       // configuración con la que arrancó esta sesión
let _esperaSesion = null;  // promesa única de asegurarSesion()
let _usuario = null;
let _cerrando = false;     // cierre pedido aquí: no tratarlo como sesión perdida

function esProyectoReal(cfg) {
  if (!cfg) return false;
  return ['projectId', 'authDomain', 'storageBucket'].some(k =>
    String(cfg[k] || '').toLowerCase().includes(PROYECTO_REAL));
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
// Bloqueo definitivo de esta sesión (modo prueba mal configurado, navegador
// con datos de otro entorno): no se conecta a nada y no se muestran datos.
function bloquearInicio(motivo) {
  mostrarLogin(motivo, 'err');
  formularioLogin(false);
  const f = document.getElementById('login-form');
  if (f) f.hidden = true;
  reportarError('Inicio bloqueado', new Error(motivo));
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

/* ---------- Configuración de la nube ---------- */
function _cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
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

async function configPrueba() {
  pintarBannerPrueba(null);
  try { await _cargarScript('js/firebase-prueba.local.js'); } catch(e) { /* falta el archivo */ }
  const cfg = window.HD_FIREBASE_PRUEBA;
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    bloquearInicio('Modo prueba: falta js/firebase-prueba.local.js con la configuración del Firebase de PRUEBA (copia js/firebase-prueba.example.js). No se conecta a nada.');
    return null;
  }
  if (esProyectoReal(cfg)) {
    bloquearInicio('Modo prueba se niega a iniciar: la configuración apunta al proyecto REAL (' + PROYECTO_REAL + ').');
    return null;
  }
  if (localStorage.getItem('hd_entorno') !== 'prueba' && hayRastrosApp()) {
    bloquearInicio('Modo prueba se niega a iniciar: este navegador tiene datos de la app real. Usa otro navegador o perfil (o una ventana nueva sin datos del sitio).');
    return null;
  }
  try { localStorage.setItem('hd_entorno', 'prueba'); } catch(e) {}
  pintarBannerPrueba(cfg);
  return cfg;
}

// Configuración con la que se conecta esta sesión. null = no conectar.
async function configNube(saved) {
  if (MODO_PRUEBA) return configPrueba();
  if (localStorage.getItem('hd_entorno') === 'prueba') {
    bloquearInicio('Este navegador se usó para el modo prueba: sus datos son ficticios y no deben mezclarse con la nube real. Abre la app real en otro navegador o perfil.');
    return null;
  }
  let cfg = DEFAULT_FB_CONFIG;
  if (saved && saved !== 'local') {
    try { cfg = JSON.parse(saved); } catch(e) { cfg = DEFAULT_FB_CONFIG; }
  }
  return cfg;
}

/* ---------- Sesión ---------- */
// Resuelve con el usuario cuando hay una sesión válida (correo y
// contraseña). Mientras tanto la pantalla de login queda visible. Una
// sesión anónima vieja (versiones anteriores) se cierra y no cuenta.
function asegurarSesion() {
  if (_esperaSesion) return _esperaSesion;
  formularioLogin(true);
  _esperaSesion = new Promise(resolve => {
    let listo = false;
    firebase.auth().onAuthStateChanged(user => {
      if (user && user.isAnonymous) {
        firebase.auth().signOut().catch(() => {});
        return;
      }
      if (user) {
        _usuario = user;
        try { localStorage.setItem('hd_sesion', user.uid); } catch(e) {}
        pintarUsuario(user);
        ocultarLogin();
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
    avisoLogin('');
  } catch(e) {
    avisoLogin(_mensajeErrorLogin(e));
  } finally {
    passEl.value = ''; // la contraseña no se queda en la página
    formularioLogin(true);
  }
}

function _quitarDatosDePantalla() {
  if (_unsubClientes) { _unsubClientes(); _unsubClientes = null; }
  if (_unsubHistorial) { _unsubHistorial(); _unsubHistorial = null; }
  clientes = []; historial = []; _histReciente = []; _histAntiguo = [];
  try { refresh(); } catch(e) {}
}

// La sesión se cerró (aquí o porque Firebase la invalidó): se quitan los
// datos de la pantalla y se vuelve a la pantalla de login. Lo guardado en
// el teléfono (cola de cobros, copias) NO se borra.
function sesionPerdida() {
  try { localStorage.removeItem('hd_sesion'); } catch(e) {}
  _quitarDatosDePantalla();
  mostrarLogin('La sesión se cerró. Vuelve a entrar.', 'info');
  location.reload();
}

async function cerrarSesion() {
  const enCola = typeof leerCola === 'function' ? leerCola().length : 0;
  const aviso = enCola
    ? `Hay ${enCola} cobro(s) de este teléfono que aún no suben. Se quedan guardados aquí y subirán al volver a entrar con un usuario autorizado.\n\n¿Cerrar sesión?`
    : '¿Cerrar sesión en este teléfono?';
  if (!confirm(aviso)) return;
  _cerrando = true;
  try { localStorage.removeItem('hd_sesion'); } catch(e) {}
  _quitarDatosDePantalla();
  mostrarLogin('', 'info');
  try { await firebase.auth().signOut(); } catch(e) { reportarError('Cerrar sesión', e); }
  location.reload();
}

window.iniciarSesion = iniciarSesion;
window.cerrarSesion = cerrarSesion;
