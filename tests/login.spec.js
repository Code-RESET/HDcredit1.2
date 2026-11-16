// Pruebas del login con correo y contraseña, la confirmación de acceso por
// la nube, el cierre de sesión seguro y el modo prueba.
//
// NUNCA tocan ningún Firebase (ni el real ni el de prueba):
//  - toda petición a servidores de Firebase/Google se bloquea;
//  - el SDK es FALSO (window.firebase en memoria): Auth, Firestore y las
//    reglas (solo UID autorizados) están simulados;
//  - js/firebase-prueba.local.js se sustituye siempre (404 o configuración
//    ficticia): no se lee el archivo real del disco.
// Todos los datos y usuarios son ficticios.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const BLOQUEAR = /googleapis\.com|firebaseio\.com|firebaseapp\.com|gstatic\.com\/firebasejs/;
const NUBE = 'usuarios/compartido/';
const CLI_FICTICIO = {
  id: 'c_ficticio_1', nombre: 'ZOILA FICTICIA', producto: 'quincenal_fijo',
  monto: 5000, pq: 1083, nq: 6, pagadas: 0, saldo: 6498,
  pagos: [false, false, false, false, false, false],
  inicio: '2026-01-01', telefono: '', notas: '', alerta: '', createdAt: '2026-01-01T00:00:00.000Z',
};
const CLI_LOCAL = { ...CLI_FICTICIO, id: 'c_local_1', nombre: 'COPIA LOCAL FICTICIA' };
const CORREO = 'cobrador@ejemplo.test';
const CLAVE = 'clave-ficticia-123';
const CORREO_INTRUSO = 'intruso@ejemplo.test';
const CLAVE_INTRUSO = 'clave-intrusa-ficticia';
const UID_OK = 'uid-ficticio-cobrador';
const UID_INTRUSO = 'uid-ficticio-intruso';
const CFG_FICTICIA = { apiKey: 'clave-api-ficticia', authDomain: 'demo-hd-prueba.firebaseapp.com', projectId: 'demo-hd-prueba-ficticio', appId: '1:0:web:0' };
const CFG_REAL = { apiKey: 'x', authDomain: 'hdcredit12-2c6ba.firebaseapp.com', projectId: 'hdcredit12-2c6ba', appId: '1:1:web:1' };
// Configuración real (pública) leída de js/config-real.js: para probar
// configuraciones mezcladas y que las huellas coinciden
const SRC_REAL = fs.readFileSync(path.join(RAIZ, 'js/config-real.js'), 'utf8');
const campoReal = k => (SRC_REAL.match(new RegExp(k + ':\\s*"([^"]+)"')) || [])[1];
const API_KEY_REAL = campoReal('apiKey');
const PROYECTO_REAL = campoReal('projectId');
const SENDER_REAL = campoReal('messagingSenderId');
const APP_ID_REAL = campoReal('appId');
const COBRO_EN_COLA = { cid: 'c_ficticio_1', qIdx: 0, qKey: '2026-09-15', accion: 'PAGO', nq: 6, creado: '2026-09-15T16:00:00.000Z',
  log: { id: 'h_cola_1', clienteId: 'c_ficticio_1', nombre: 'ZOILA FICTICIA', monto: 1083, qIndex: 0, qKey: '2026-09-15', accion: 'PAGO',
         fecha: '15/9/2026', hora: '10:00:00', ts: '2026-09-15T16:00:00.000Z' } };

// SDK falso. sesion: null | 'normal' | 'intruso' | 'anonima' (estado inicial;
// luego se conserva entre recargas en sessionStorage, como hace Firebase).
// ctl: nubeCaida (el servidor no responde), pendientes ('ok' | 'colgado').
function sdkFalso({ sesion, nube, cred, autorizados, ctl }) {
  const usuarios = {
    normal: { uid: 'uid-ficticio-cobrador', email: cred.correo, isAnonymous: false },
    intruso: { uid: 'uid-ficticio-intruso', email: cred.correoIntruso, isAnonymous: false },
    anonima: { uid: 'uid-ficticio-anonimo', email: null, isAnonymous: true },
  };
  if (sessionStorage.getItem('__sesionFalsa') === null) sessionStorage.setItem('__sesionFalsa', sesion || 'ninguna');
  window.__ctl = { ...ctl };
  const reg = window.__reg = JSON.parse(sessionStorage.getItem('__reg') || '{"intentos":[],"anonimo":0,"signOut":0,"configs":[],"firestore":0,"escuchas":0,"lecturasServidor":0,"esperas":0}');
  const guardar = () => sessionStorage.setItem('__reg', JSON.stringify(reg));
  const store = new Map(Object.entries(nube || {}));
  const actual = () => usuarios[sessionStorage.getItem('__sesionFalsa')] || null;
  const negado = () => { const u = actual(); return !u || u.isAnonymous || !autorizados.includes(u.uid); };
  const error = (code, msg) => { const e = new Error(msg + ' (simulado)'); e.code = code; return e; };
  const snap = (p, fromCache) => {
    const docs = [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
      .map(k => ({ id: k.split('/').pop(), exists: true, data: () => JSON.parse(JSON.stringify(store.get(k))) }));
    return { docs, empty: !docs.length, metadata: { fromCache: !!fromCache, hasPendingWrites: false } };
  };
  const docRef = p => ({ path: p, id: p.split('/').pop(), collection: n => col(p + '/' + n),
    get: async () => ({ exists: store.has(p), data: () => store.get(p) }), set: async () => {}, delete: async () => {} });
  const col = p => {
    const q = { path: p, doc: id => docRef(p + '/' + id), orderBy: () => q, where: () => q, limit: () => q, startAfter: () => q,
      // Lectura al servidor: aplica las "reglas" (solo UID autorizados)
      get: async () => {
        reg.lecturasServidor++; guardar();
        if (window.__ctl.nubeCaida) throw error('unavailable', 'sin conexión');
        if (negado()) throw error('permission-denied', 'sin permiso');
        return snap(p);
      },
      onSnapshot: (a, b, c) => {
        const cb = typeof a === 'function' ? a : b;
        const err = typeof a === 'function' ? b : c;
        reg.escuchas++; guardar();
        setTimeout(() => {
          if (window.__ctl.nubeCaida) return cb(snap(p, true)); // sin red: copia en caché
          if (negado()) return err && err(error('permission-denied', 'sin permiso'));
          cb(snap(p));
        }, 0);
        return () => {};
      } };
    return q;
  };
  const DB = { enablePersistence: () => Promise.resolve(), collection: n => col(n),
    waitForPendingWrites: () => { reg.esperas++; guardar(); return window.__ctl.pendientes === 'colgado' ? new Promise(() => {}) : Promise.resolve(); },
    batch: () => ({ set() {}, delete() {}, commit: async () => {} }), runTransaction: async fn => fn({ get: async r => r.get(), set() {} }) };
  const escuchas = [];
  const avisar = () => escuchas.forEach(cb => setTimeout(() => cb(actual()), 0));
  const auth = {
    get currentUser() { return actual(); },
    onAuthStateChanged(cb) { escuchas.push(cb); setTimeout(() => cb(actual()), 0); return () => {}; },
    signInWithEmailAndPassword(e, p) {
      reg.intentos.push(e); guardar(); // solo el correo: la contraseña no se registra
      const quien = (e === cred.correo && p === cred.clave) ? 'normal' : (e === cred.correoIntruso && p === cred.claveIntruso) ? 'intruso' : null;
      if (quien) { sessionStorage.setItem('__sesionFalsa', quien); avisar(); return Promise.resolve({ user: actual() }); }
      return Promise.reject(error('auth/invalid-credential', 'credencial inválida'));
    },
    signOut() { reg.signOut++; guardar(); sessionStorage.setItem('__sesionFalsa', 'ninguna'); avisar(); return Promise.resolve(); },
    signInAnonymously() { reg.anonimo++; guardar(); return Promise.reject(new Error('el inicio anónimo no debe usarse')); },
  };
  // Simula que Firebase invalida la sesión (p. ej. usuario desactivado)
  window.__forzarSalida = () => { sessionStorage.setItem('__sesionFalsa', 'ninguna'); avisar(); };
  window.firebase = {
    apps: [],
    initializeApp(cfg) { this.apps.push(cfg); reg.configs.push(cfg.projectId); guardar(); },
    auth: () => auth,
    firestore: () => { reg.firestore++; guardar(); return DB; },
  };
}

// prueba: undefined/'falta' (404) | objeto de configuración servido como js/firebase-prueba.local.js
async function arrancar(page, { ls = {}, sesion = null, nube = {}, sdk = true, prueba, url = '/index.html',
                                autorizados = [UID_OK], ctl = {}, online = true, sinWebdriver = false, sinConfigReal = false } = {}) {
  const bloqueadas = [];
  await page.route(BLOQUEAR, r => { bloqueadas.push(r.request().url()); r.abort(); });
  // Sitio de prueba: no se publica js/config-real.js
  if (sinConfigReal) await page.route('**/js/config-real.js*', r => r.fulfill({ status: 404, body: '' }));
  await page.route('**/js/firebase-prueba.local.js', r => {
    if (prueba === 'colgado') return; // el servidor nunca responde
    if (!prueba || prueba === 'falta') return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.HD_FIREBASE_PRUEBA = ' + JSON.stringify(prueba) + ';' });
  });
  await page.addInitScript(({ ls, online, sinWebdriver }) => {
    window.__online = online;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__online });
    if (sinWebdriver) Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
    if (sessionStorage.getItem('__init')) return;
    sessionStorage.setItem('__init', '1');
    Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }, { ls, online, sinWebdriver });
  if (sdk) await page.addInitScript(sdkFalso, { sesion, nube, autorizados, ctl,
    cred: { correo: CORREO, clave: CLAVE, correoIntruso: CORREO_INTRUSO, claveIntruso: CLAVE_INTRUSO } });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'load' });
  await esperarLoader(page);
  return { bloqueadas, errores };
}
const esperarLoader = page => page.waitForFunction(() => document.getElementById('loader').style.display === 'none', null, { timeout: 10000 });
const reg = page => page.evaluate(() => window.__reg || { configs: [], firestore: 0, intentos: [], anonimo: 0, signOut: 0, escuchas: 0, esperas: 0 });
const textoVisible = page => page.evaluate(() => document.body.innerText);
const nubeConCliente = { [NUBE + 'clientes/c_ficticio_1']: CLI_FICTICIO };
const lsNube = { hd_fb: JSON.stringify({ apiKey: API_KEY_REAL, projectId: PROYECTO_REAL }), hd_c: [CLI_LOCAL], hd_h: [] };
const autorizadosLS = page => page.evaluate(() => JSON.parse(localStorage.getItem('hd_autorizados') || '[]'));
async function sinDatos(page) {
  const txt = await textoVisible(page);
  expect(txt).not.toContain('ZOILA FICTICIA');
  expect(txt).not.toContain('COPIA LOCAL FICTICIA');
  expect(await page.evaluate(() => clientes.length + historial.length)).toBe(0);
}

async function entrar(page, correo = CORREO, clave = CLAVE) {
  await expect(page.locator('#login-btn')).toBeEnabled();
  await page.fill('#login-email', correo);
  await page.fill('#login-pass', clave);
  await page.click('#login-btn');
}
async function recargaTras(page, accion) {
  await Promise.all([page.waitForEvent('load'), accion()]);
  await esperarLoader(page);
}

test.describe('Login con correo y contraseña', () => {
  test('antes del login no se muestra ningún dato ni se usa Firestore', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await expect(page.locator('#login-scr')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeEnabled();
    await page.waitForTimeout(500);
    await sinDatos(page);
    await expect(page.locator('#sidebar')).toBeHidden();
    const r = await reg(page);
    expect(r.firestore).toBe(0);
    expect(r.anonimo).toBe(0);
  });

  test('contraseña incorrecta: avisa, no entra, no muestra datos y no guarda la contraseña', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await entrar(page, CORREO, 'clave-equivocada-ficticia');
    await expect(page.locator('#login-msg')).toContainText('incorrectos');
    await expect(page.locator('#login-scr')).toBeVisible();
    await expect(page.locator('#login-pass')).toHaveValue('');
    await sinDatos(page);
    const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(guardado).not.toContain('clave-equivocada-ficticia');
    expect((await reg(page)).firestore).toBe(0);
  });

  test('usuario autorizado: la nube confirma el UID, entra y nunca usa el inicio anónimo', async ({ page }) => {
    const ctx = await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await entrar(page);
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => gv('clientes'));
    await expect(page.locator('body')).toContainText('ZOILA FICTICIA');
    await expect(page.locator('#ui-name')).toContainText(CORREO);
    await expect(page.locator('#ni-salir')).toBeVisible();
    const r = await reg(page);
    expect(r.anonimo).toBe(0);
    expect(r.intentos).toEqual([CORREO]);
    expect(r.lecturasServidor).toBeGreaterThanOrEqual(1); // confirmación directa al servidor
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(CLAVE);
    expect(await autorizadosLS(page)).toEqual([UID_OK]);
    expect(ctx.errores).toEqual([]);
  });
});

test.describe('1. La sesión solo vale si la nube confirma el UID', () => {
  test('una cuenta con contraseña pero NO autorizada no ve nada y se cierra sola', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await recargaTras(page, () => entrar(page, CORREO_INTRUSO, CLAVE_INTRUSO));
    await expect(page.locator('#login-scr')).toBeVisible();
    await expect(page.locator('#login-msg')).toContainText('no está autorizado');
    await expect(page.locator('#login-msg')).toContainText(UID_INTRUSO);
    await sinDatos(page);
    const r = await reg(page);
    expect(r.signOut).toBe(1);
    expect(r.escuchas).toBe(0); // nunca se sincronizó
    expect(await autorizadosLS(page)).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c'))[0].nombre)).toBe('COPIA LOCAL FICTICIA'); // no se borró
  });

  test('si la nube no responde y el UID nunca se confirmó aquí: no se muestran datos locales', async ({ page }) => {
    await arrancar(page, { ls: lsNube, sesion: 'normal', ctl: { nubeCaida: true } });
    await expect(page.locator('#login-msg')).toContainText('No se pudo confirmar');
    await expect(page.locator('#login-reintentar')).toBeVisible();
    await sinDatos(page);
    expect((await reg(page)).escuchas).toBe(0);
  });

  test('si el SDK no carga (sin internet al abrir): se queda en el login sin la copia local', async ({ page }) => {
    await arrancar(page, { ls: { ...lsNube, hd_autorizados: [UID_OK] }, sdk: false });
    await expect(page.locator('#login-msg')).toContainText('internet', { timeout: 20000 });
    await expect(page.locator('#login-scr')).toBeVisible();
    await sinDatos(page);
    await expect(page.locator('#banner-sinsync')).toBeHidden();
  });

  test('si la nube revoca el acceso a media sesión: quita los datos y vuelve al login', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await recargaTras(page, () => page.evaluate(() => accesoRevocado()));
    await expect(page.locator('#login-msg')).toContainText('ya no tiene acceso');
    await sinDatos(page);
    expect(await autorizadosLS(page)).toEqual([]);
  });
});

test.describe('2. "Solo local" ya no existe', () => {
  test('no hay botón ni función de "Solo local"', async ({ page }) => {
    await arrancar(page, { ls: lsNube });
    expect(await page.locator('text=Solo local').count()).toBe(0);
    expect(await page.evaluate(() => typeof window.goLocal)).toBe('undefined');
  });

  test('un teléfono que usaba "Solo local" pide login y pasa por el rescate, sin perder sus datos', async ({ page }) => {
    await arrancar(page, { ls: { hd_fb: 'local', hd_local_manual: '1', hd_c: [CLI_LOCAL], hd_h: [] }, nube: nubeConCliente, sinWebdriver: true });
    await expect(page.locator('#login-scr')).toBeVisible();
    await sinDatos(page);
    await entrar(page);
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c')).map(c => c.nombre))).toEqual(['COPIA LOCAL FICTICIA']);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
  });
});

test.describe('3. Otro usuario no ve los datos del anterior (también sin internet)', () => {
  test('sin internet, un UID confirmado antes en este teléfono sí trabaja con la copia', async ({ page }) => {
    await arrancar(page, { ls: { ...lsNube, hd_autorizados: [UID_OK] }, nube: nubeConCliente, sesion: 'normal', ctl: { nubeCaida: true } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => gv('clientes'));
    await expect(page.locator('body')).toContainText('ZOILA FICTICIA');
  });

  test('sin internet, otra cuenta en el mismo teléfono no ve nada', async ({ page }) => {
    await arrancar(page, { ls: { ...lsNube, hd_autorizados: [UID_OK] }, nube: nubeConCliente, sesion: 'intruso', ctl: { nubeCaida: true } });
    await expect(page.locator('#login-msg')).toContainText('No se pudo confirmar');
    await sinDatos(page);
    expect((await reg(page)).escuchas).toBe(0);
  });

  test('con un rescate pendiente, otra cuenta no ve la copia local', async ({ page }) => {
    await arrancar(page, { ls: { ...lsNube, hd_autorizados: [UID_OK], hd_rescate_pendiente: '1' }, sesion: 'intruso', ctl: { nubeCaida: true } });
    await expect(page.locator('#login-msg')).toContainText('No se pudo confirmar');
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
    await sinDatos(page);
  });

  test('la copia local tiene un candado: loadLocal sin acceso confirmado no muestra nada', async ({ page }) => {
    await arrancar(page, { ls: lsNube });
    await page.evaluate(() => loadLocal());
    await sinDatos(page);
  });
});

test.describe('4. Cerrar una sesión nunca pierde lo pendiente', () => {
  test('sesión anónima vieja: espera lo pendiente, fuerza el rescate y no borra nada', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'anonima' });
    await expect.poll(async () => (await reg(page)).signOut).toBe(1);
    const r = await reg(page);
    expect(r.esperas).toBeGreaterThanOrEqual(1); // waitForPendingWrites antes de cerrar
    expect(r.escuchas).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
    await sinDatos(page);
    await entrar(page);
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c'))[0].nombre)).toBe('COPIA LOCAL FICTICIA');
  });

  test('sesión anónima vieja sin datos en el teléfono: se cierra sin rescate', async ({ page }) => {
    await arrancar(page, { ls: { hd_fb: JSON.stringify(CFG_FICTICIA) }, nube: nubeConCliente, sesion: 'anonima' });
    await expect.poll(async () => (await reg(page)).signOut).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBeNull();
    await entrar(page);
    await expect(page.locator('#login-scr')).toBeHidden();
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
  });

  test('si Firebase cierra la sesión con escrituras pendientes, el siguiente inicio pasa por el rescate', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => { _hayEscriturasPendientes = true; });
    await recargaTras(page, () => page.evaluate(() => window.__forzarSalida()));
    await expect(page.locator('#login-msg')).toContainText('La sesión se cerró');
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c')).length)).toBe(1);
  });
});

test.describe('5. Cerrar sesión avisa y espera lo pendiente', () => {
  test('sin pendientes: espera a la nube, cierra, quita los datos y vuelve al login', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => gv('clientes'));
    await expect(page.locator('body')).toContainText('ZOILA FICTICIA');
    await recargaTras(page, () => page.evaluate(() => document.getElementById('ni-salir').click()));
    await expect(page.locator('#login-scr')).toBeVisible();
    await sinDatos(page);
    const r = await reg(page);
    expect(r.signOut).toBe(1);
    expect(r.esperas).toBeGreaterThanOrEqual(1);
  });

  test('con cobros en cola sin internet: NO deja salir y conserva la cola', async ({ page }) => {
    await arrancar(page, { ls: { ...lsNube, hd_cola_cobros: [COBRO_EN_COLA] }, nube: nubeConCliente, sesion: 'normal', online: false });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => cerrarSesion());
    await expect(page.locator('#toasts')).toContainText('No se cerró la sesión');
    await expect(page.locator('#toasts')).toContainText('cobro(s) que aún no suben');
    await expect(page.locator('#login-scr')).toBeHidden();
    expect((await reg(page)).signOut).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_cola_cobros')).length)).toBe(1);
  });

  test('con altas o ediciones sin confirmar por la nube: NO deja salir', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal', ctl: { pendientes: 'colgado' } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => cerrarSesion());
    await expect(page.locator('#toasts')).toContainText('altas o ediciones', { timeout: 25000 });
    await expect(page.locator('#login-scr')).toBeHidden();
    expect((await reg(page)).signOut).toBe(0);
  });

  test('con un rescate pendiente: NO deja salir', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => localStorage.setItem('hd_rescate_pendiente', '1'));
    await page.evaluate(() => cerrarSesion());
    await expect(page.locator('#toasts')).toContainText('rescate pendiente');
    expect((await reg(page)).signOut).toBe(0);
  });

  // Sustituye confirm() para leer el aviso y decidir la respuesta
  const responderConfirm = (page, respuesta) => page.evaluate(r => {
    window.__avisos = [];
    window.confirm = m => { window.__avisos.push(m); return r; };
  }, respuesta);
  const avisos = page => page.evaluate(() => window.__avisos);
  const lsSinRed = { ...lsNube, hd_autorizados: [UID_OK] };

  test('M4: sin internet y sin pendientes avisa que no podrá volver a entrar; si cancela, sigue dentro', async ({ page }) => {
    await arrancar(page, { ls: lsSinRed, nube: nubeConCliente, sesion: 'normal', online: false, ctl: { nubeCaida: true } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await responderConfirm(page, false);
    await page.evaluate(() => cerrarSesion());
    const a = await avisos(page);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain('NO podrás volver a entrar hasta tener internet');
    expect(a[0]).toContain('no se borra');
    expect((await reg(page)).signOut).toBe(0);
    await expect(page.locator('#login-scr')).toBeHidden();
  });

  test('M4: si acepta salir sin internet, el login explica qué pasa y los datos se conservan', async ({ page }) => {
    await arrancar(page, { ls: lsSinRed, nube: nubeConCliente, sesion: 'normal', online: false, ctl: { nubeCaida: true } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await responderConfirm(page, true);
    await recargaTras(page, () => page.evaluate(() => { cerrarSesion(); }));
    await expect(page.locator('#login-msg')).toContainText('Cerraste sesión sin internet');
    await expect(page.locator('#login-msg')).toContainText('se conserva');
    expect((await reg(page)).signOut).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c')).length)).toBeGreaterThan(0);
    await sinDatos(page);
  });

  test('M4: con Wi-Fi pero sin respuesta de la nube también avisa', async ({ page }) => {
    await arrancar(page, { ls: lsSinRed, nube: nubeConCliente, sesion: 'normal', ctl: { nubeCaida: true } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await responderConfirm(page, false);
    await page.evaluate(() => cerrarSesion());
    expect((await avisos(page))[0]).toContain('No hay conexión con la nube');
  });

  test('M4: con conexión y sin pendientes no muestra la advertencia', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await responderConfirm(page, false);
    await page.evaluate(() => cerrarSesion());
    const a = await avisos(page);
    expect(a).toHaveLength(1);
    expect(a[0]).not.toContain('No hay conexión');
    expect(a[0]).toContain('¿Cerrar sesión');
  });

  test('M4: con cobros por revisar y sin internet avisa de las dos cosas', async ({ page }) => {
    await arrancar(page, { ls: lsSinRed, nube: nubeConCliente, sesion: 'normal', online: false, ctl: { nubeCaida: true } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => { window.leerRevision = () => [{}, {}]; leerRevision = window.leerRevision; });
    await responderConfirm(page, false);
    await page.evaluate(() => cerrarSesion());
    const a = (await avisos(page))[0];
    expect(a).toContain('No hay conexión');
    expect(a).toContain('2 cobro(s) por revisar');
  });

  test('M4: una sesión anónima vieja sin internet no se cierra y explica cómo seguir', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'anonima', online: false });
    await expect(page.locator('#login-msg')).toContainText('Sin internet');
    await expect(page.locator('#login-msg')).toContainText('se conservan');
    await expect(page.locator('#login-reintentar')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeDisabled();
    expect((await reg(page)).signOut).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
    await sinDatos(page);
  });
});

test.describe('M1. Sin mezclar versiones ni quedar bloqueado en el login', () => {
  const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

  test('index.html, sw.js y js/app.js declaran la misma versión, y sw.js guarda todos los scripts', () => {
    const html = leer('index.html');
    const version = (html.match(/window\.HD_VERSION = '([^']+)'/) || [])[1];
    expect(version).toBeTruthy();
    const sw = leer('sw.js');
    expect((sw.match(/const VERSION = '([^']+)'/) || [])[1]).toBe(version);
    expect((leer('js/app.js').match(/window\.HD_APP_VERSION = '([^']+)'/) || [])[1]).toBe(version);
    const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s, s + ' sin la versión').toMatch(new RegExp('\\.js\\?v=' + version + '$'));
    const nombres = scripts.map(s => s.match(/js\/([^.]+)\.js/)[1]).filter(n => n !== 'config-real');
    const enSw = sw.match(/\.\.\.\[([^\]]+)\]\.map\(n => `\.\/js\//)[1].match(/'[^']+'/g).map(n => n.replace(/'/g, ''));
    expect(enSw.sort()).toEqual(nombres.sort());
    expect(sw).toContain('./js/config-real.js?v=${VERSION}');
  });

  test('HTML nuevo con JS viejo: avisa y ofrece Reintentar, no se queda en "Cargando…"', async ({ page }) => {
    await page.route('**/js/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.HD_APP_VERSION = "viejo";' }));
    await arrancar(page, { ls: lsNube });
    await expect(page.locator('#login-msg')).toContainText('no terminó de actualizarse');
    await expect(page.locator('#login-msg')).toContainText('se conserva');
    await expect(page.locator('#login-reintentar')).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();
    await sinDatos(page);
  });

  test('si un script de la app no carga: avisa y Reintentar limpia solo la copia de la app, no los datos', async ({ page }) => {
    await page.route('**/js/negocio.js*', r => r.abort());
    await arrancar(page, { ls: lsNube });
    await expect(page.locator('#login-msg')).toContainText('no terminó de actualizarse');
    await page.evaluate(() => caches.open('copia-de-la-app'));
    await page.unroute('**/js/negocio.js*');
    await recargaTras(page, () => page.click('#login-reintentar'));
    expect(await page.evaluate(() => caches.keys())).not.toContain('copia-de-la-app');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c'))[0].nombre)).toBe('COPIA LOCAL FICTICIA');
    await expect(page.locator('#login-btn')).toBeEnabled();
  });

  test('si la app arranca pero el login nunca queda listo, a los 30 s avisa', async ({ page }) => {
    await page.clock.install();
    await page.route('**/js/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.HD_APP_VERSION = window.HD_VERSION; document.getElementById("loader").style.display = "none";' }));
    await arrancar(page, { ls: lsNube });
    await expect(page.locator('#login-msg')).toHaveText('Cargando…');
    await page.clock.fastForward(31000);
    await expect(page.locator('#login-msg')).toContainText('tardando demasiado');
    await expect(page.locator('#login-reintentar')).toBeVisible();
  });

  test('un login normal no dispara el aviso y no deja "Cargando…" con el formulario listo', async ({ page }) => {
    await page.clock.install();
    await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await page.clock.runFor(2500);
    await expect(page.locator('#login-btn')).toBeEnabled();
    await expect(page.locator('#login-msg')).not.toHaveText('Cargando…');
    await page.clock.fastForward(31000);
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#login-reintentar')).toBeHidden();
  });

  test('el sitio de prueba sin js/config-real.js no se toma como una carga fallida', async ({ page }) => {
    await arrancar(page, { sinConfigReal: true, prueba: CFG_FICTICIA, nube: nubeConCliente });
    await expect(page.locator('#login-btn')).toBeEnabled();
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#login-reintentar')).toBeHidden();
  });

  test('si el servidor no responde al buscar la configuración de prueba, el login no se traba', async ({ page }) => {
    await arrancar(page, { ls: lsNube, prueba: 'colgado', nube: nubeConCliente });
    await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 12000 });
    expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
  });
});

// Con el service worker real. La app corre en modo local automatizado, así que
// no carga Firebase; lo único externo son CDN públicos (fuentes y el SDK).
test.describe('M1. Service worker', () => {
  test.use({ serviceWorkers: 'allow' });
  const local = () => { localStorage.setItem('hd_fb', 'local'); localStorage.setItem('hd_local_manual', '1'); };

  test('guarda la versión completa, borra las anteriores y abre sin red con la misma versión', async ({ page, context }) => {
    await page.addInitScript(local);
    await page.goto('/manifest.json');
    await page.evaluate(() => caches.open('hdcredit-v3'));
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const version = await page.evaluate(() => window.HD_VERSION);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['hdcredit-' + version]);
    const urls = await page.evaluate(async () => (await (await caches.open('hdcredit-' + window.HD_VERSION)).keys()).map(r => r.url));
    for (const n of ['datos', 'config-real', 'sesion', 'sync', 'negocio', 'ui', 'export', 'rescate', 'app']) {
      expect(urls.some(u => u.endsWith(`/js/${n}.js?v=${version}`)), n).toBe(true);
    }
    expect(urls.some(u => u.endsWith('/index.html'))).toBe(true);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    expect(await page.evaluate(() => [window.HD_VERSION, window.HD_APP_VERSION])).toEqual([version, version]);
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#login-reintentar')).toBeHidden();

    // Sin red, cualquier URL de la app abre la copia guardada
    await page.goto('/index.html?prueba=0', { waitUntil: 'load' });
    expect(await page.evaluate(() => window.HD_APP_VERSION)).toBe(version);
    await context.setOffline(false);
  });

  test('un 404 nunca se guarda ni reemplaza una copia buena', async ({ page }) => {
    await page.addInitScript(local);
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const guardado = await page.evaluate(() => new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'js/no-existe.js';
      s.onerror = s.onload = async () => { await new Promise(r => setTimeout(r, 200)); resolve(!!(await caches.match('js/no-existe.js'))); };
      document.head.appendChild(s);
    }));
    expect(guardado).toBe(false);
  });

  test('la primera instalación no recarga la página', async ({ page }) => {
    await page.addInitScript(local);
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.evaluate(() => { window.__sinRecargar = true; return navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__sinRecargar)).toBe(true);
  });
});

test.describe('6. Modo prueba', () => {
  const URL_PRUEBA = '/index.html?prueba=1';

  test('se niega a iniciar con el projectId real hdcredit12-2c6ba', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: CFG_REAL, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('proyecto REAL');
    await expect(page.locator('#login-msg')).toContainText('se niega');
    await expect(page.locator('#login-form')).toBeHidden();
    const r = await reg(page);
    expect(r.configs).toEqual([]);
    expect(r.firestore).toBe(0);
    await sinDatos(page);
  });

  test('se niega con una configuración mezclada (projectId de prueba con apiKey real)', async ({ page }) => {
    expect(API_KEY_REAL).toBeTruthy();
    await arrancar(page, { url: URL_PRUEBA, prueba: { ...CFG_FICTICIA, apiKey: API_KEY_REAL }, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('se niega');
    expect((await reg(page)).configs).toEqual([]);
  });

  test('sin archivo local de configuración no se conecta (ni cae a la configuración real)', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: 'falta', sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('firebase-prueba.local.js');
    expect((await reg(page)).configs).toEqual([]);
  });

  test('con configuración ficticia: usa solo ese proyecto, muestra el aviso y pide login', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: CFG_FICTICIA, nube: nubeConCliente });
    await expect(page.locator('#login-prueba')).toContainText('MODO PRUEBA');
    await expect(page.locator('#login-prueba')).toContainText('demo-hd-prueba-ficticio');
    await expect(page.locator('#login-btn')).toBeEnabled();
    expect((await reg(page)).configs).toEqual(['demo-hd-prueba-ficticio']);
    await entrar(page);
    await expect(page.locator('#login-scr')).toBeHidden();
    const ls = await page.evaluate(() => ({ ent: localStorage.getItem('hd_entorno'), fb: localStorage.getItem('hd_fb') }));
    expect(ls).toEqual({ ent: 'prueba', fb: null });
    // pegar la configuración real en modo prueba se rechaza
    await page.evaluate(cfg => { document.getElementById('fb-input').value = JSON.stringify(cfg); connectFirebase(); }, CFG_REAL);
    await expect(page.locator('#toasts')).toContainText('Modo prueba');
    expect(await page.evaluate(() => localStorage.getItem('hd_fb'))).toBeNull();
    expect((await reg(page)).configs).toEqual(['demo-hd-prueba-ficticio']);
  });

  test('sitio de prueba SIN ?prueba=1 (app instalada): se fuerza el modo prueba, nunca el real', async ({ page }) => {
    await arrancar(page, { prueba: CFG_FICTICIA, nube: nubeConCliente });
    await expect(page.locator('#login-prueba')).toContainText('MODO PRUEBA');
    expect((await reg(page)).configs).toEqual(['demo-hd-prueba-ficticio']);
  });

  test('navegador marcado de prueba SIN ?prueba=1 y sin archivo: se bloquea, no usa la configuración real', async ({ page }) => {
    await arrancar(page, { ls: { hd_entorno: 'prueba', hd_c: [CLI_LOCAL] }, prueba: 'falta', sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('firebase-prueba.local.js');
    expect((await reg(page)).configs).toEqual([]);
    await sinDatos(page);
  });

  test('reconoce el Hosting de hd-credit-prueba y nada más', async ({ page }) => {
    await arrancar(page, { ls: lsNube });
    const r = await page.evaluate(() => [
      'hd-credit-prueba.web.app', 'hd-credit-prueba--canal-1a2b3c.web.app', 'hd-credit-prueba.firebaseapp.com',
      'hdcredit12-2c6ba.web.app', 'otro-hd-credit-prueba.web.app', 'hd-credit-prueba.web.app.ejemplo.test', 'localhost',
    ].map(h => esHostPrueba(h)));
    expect(r).toEqual([true, true, true, false, false, false, false]);
  });

  test('se niega si el navegador tiene datos de la app real', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: CFG_FICTICIA, ls: { hd_c: [CLI_LOCAL] }, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('datos de la app real');
    expect((await reg(page)).configs).toEqual([]);
    await sinDatos(page);
  });
});

test.describe('Configuración real aparte (js/config-real.js)', () => {
  test('con el archivo, la app publicada funciona igual: usa el proyecto real y entra con login', async ({ page }) => {
    await arrancar(page, { nube: nubeConCliente });
    await entrar(page);
    await expect(page.locator('#login-scr')).toBeHidden();
    expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
    expect(await page.evaluate(() => localStorage.getItem('hd_fb'))).toContain(PROYECTO_REAL); // se guarda como antes
  });

  test('M2: una configuración guardada de otro proyecto no gana; sin datos locales se reemplaza por la real', async ({ page }) => {
    await arrancar(page, { ls: { hd_fb: JSON.stringify(CFG_FICTICIA) }, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_fb')).projectId)).toBe(PROYECTO_REAL);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBeNull();
  });

  test('M2: con datos de otro proyecto en el teléfono, pasan por el rescate y no se reemplazan ni se suben solos', async ({ page }) => {
    await arrancar(page, { ls: { hd_fb: JSON.stringify(CFG_FICTICIA), hd_c: [CLI_LOCAL], hd_h: [] }, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    const r = await reg(page);
    expect(r.configs).toEqual([PROYECTO_REAL]);
    expect(r.escuchas).toBe(0); // no empezó a sincronizar
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c')).map(c => c.nombre))).toEqual(['COPIA LOCAL FICTICIA']);
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
  });

  test('M2: la configuración guardada del proyecto real no cambia nada ni pide rescate', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
    expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
  });

  for (const invalida of ['null', '{no es json', '{}']) {
    test(`M2: una configuración guardada inválida (${invalida}) no bloquea ni deja en blanco`, async ({ page }) => {
      await arrancar(page, { ls: { hd_fb: invalida, hd_c: [CLI_LOCAL], hd_h: [] }, nube: nubeConCliente, sesion: 'normal' });
      await expect(page.locator('#login-scr')).toBeHidden();
      expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hd_fb')).projectId)).toBe(PROYECTO_REAL);
    });
  }

  test('M2: en producción no se puede pegar otra configuración y ya no está en el menú', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    const antes = await page.evaluate(() => localStorage.getItem('hd_fb'));
    await page.evaluate(cfg => { document.getElementById('fb-input').value = JSON.stringify(cfg); connectFirebase(); }, CFG_FICTICIA);
    await expect(page.locator('#toasts')).toContainText('es fija');
    expect(await page.evaluate(() => localStorage.getItem('hd_fb'))).toBe(antes);
    expect((await reg(page)).configs).toEqual([PROYECTO_REAL]);
    expect(await page.locator('#sidebar .ni:has-text("Firebase")').count()).toBe(0);
  });

  test('M2: reintentar la conexión ignora una configuración guardada de otro proyecto', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    const usada = await page.evaluate(cfg => {
      localStorage.setItem('hd_fb', JSON.stringify(cfg));
      _cfgNube = null;
      let recibida = null;
      const original = loadFirebaseSDK;
      loadFirebaseSDK = c => { recibida = c; return Promise.resolve(true); };
      reintentarConexion();
      loadFirebaseSDK = original;
      return recibida && recibida.projectId;
    }, CFG_FICTICIA);
    expect(usada).toBe(PROYECTO_REAL);
  });

  test('sin el archivo y sin configuración de prueba: se detiene con un error claro y no conecta a nada', async ({ page }) => {
    await arrancar(page, { sinConfigReal: true, ls: { hd_fb: JSON.stringify(CFG_FICTICIA), hd_c: [CLI_LOCAL] }, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('Falta la configuración de la app');
    await expect(page.locator('#login-form')).toBeHidden();
    const r = await reg(page);
    expect(r.configs).toEqual([]);   // ni la guardada ni ninguna otra
    expect(r.firestore).toBe(0);
    await sinDatos(page);
    expect(await page.evaluate(() => DEFAULT_FB_CONFIG)).toBeNull();
    await page.evaluate(() => reintentarConexion());
    await expect(page.locator('#toasts')).toContainText('Sin configuración válida');
    expect((await reg(page)).configs).toEqual([]);
  });

  test('sin el archivo, el sitio de prueba funciona con su configuración', async ({ page }) => {
    await arrancar(page, { sinConfigReal: true, prueba: CFG_FICTICIA, nube: nubeConCliente });
    await expect(page.locator('#login-prueba')).toContainText('MODO PRUEBA');
    await entrar(page);
    await expect(page.locator('#login-scr')).toBeHidden();
    expect((await reg(page)).configs).toEqual(['demo-hd-prueba-ficticio']);
  });

  test('sin el archivo, la protección sigue reconociendo el proyecto real (por huellas)', async ({ page }) => {
    const casos = [
      CFG_REAL,                                                   // projectId real
      { ...CFG_FICTICIA, apiKey: API_KEY_REAL },                  // apiKey real
      { ...CFG_FICTICIA, appId: APP_ID_REAL },                    // appId real
      { ...CFG_FICTICIA, messagingSenderId: SENDER_REAL },        // senderId real
      { ...CFG_FICTICIA, authDomain: ' ' + PROYECTO_REAL.toUpperCase() + '.firebaseapp.com ' }, // mayúsculas y espacios
    ];
    await arrancar(page, { sinConfigReal: true, prueba: CFG_FICTICIA });
    expect(await page.evaluate(() => window.HD_FIREBASE_REAL)).toBeUndefined();
    expect(await page.evaluate(c => c.map(esProyectoReal), casos)).toEqual([true, true, true, true, true]);
    expect(await page.evaluate(c => esProyectoReal(c), CFG_FICTICIA)).toBe(false);
  });

  test('sin el archivo, un sitio de prueba con la configuración real se niega a iniciar', async ({ page }) => {
    await arrancar(page, { sinConfigReal: true, url: '/index.html?prueba=1', prueba: CFG_REAL, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('se niega');
    expect((await reg(page)).configs).toEqual([]);
  });

  test('las huellas del código coinciden con js/config-real.js', async ({ page }) => {
    await arrancar(page, { sinConfigReal: true, prueba: CFG_FICTICIA });
    const r = await page.evaluate(v => ({ calc: v.map(x => huella(x.toLowerCase())), codigo: HUELLAS_REAL }),
      [PROYECTO_REAL, SENDER_REAL, API_KEY_REAL, APP_ID_REAL]);
    expect(r.calc).toEqual(r.codigo);
  });

  test('ningún archivo del sitio, salvo js/config-real.js, contiene identificadores reales', () => {
    const publicados = ['index.html', 'sw.js', 'manifest.json',
      ...fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js') && f !== 'config-real.js' && f !== 'firebase-prueba.local.js').map(f => 'js/' + f)];
    for (const f of publicados) {
      const txt = fs.readFileSync(path.join(RAIZ, f), 'utf8');
      for (const id of [PROYECTO_REAL, SENDER_REAL, API_KEY_REAL]) expect(txt.includes(id), f + ' contiene ' + id).toBe(false);
    }
  });
});

test.describe('Reglas y archivos', () => {
  const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  const sinComentarios = reglas.replace(/\/\/.*$/gm, '');
  const codigoApp = () => fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js') && !f.startsWith('firebase-prueba'))
    .map(f => fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8')).join('\n') + fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

  test('firestore.rules: solo UID autorizados con correo y contraseña; anónimos rechazados', () => {
    expect(sinComentarios).toMatch(/rules_version\s*=\s*'2'/);
    expect(sinComentarios).toMatch(/sign_in_provider\s*==\s*'password'/);
    expect(sinComentarios).toMatch(/request\.auth\.uid\s+in\s+\[/);
    const uids = sinComentarios.match(/request\.auth\.uid\s+in\s+\[([^\]]*)\]/)[1].match(/'[^']+'/g);
    expect(uids).toEqual(["'R3rdDFisDjQrkLqnt1LtpS848uB2'", "'nXbh0hlxW1hu757DCQRZKgPcvDm2'"]);
    expect(reglas).not.toContain('ZknvkenxXEgWugfxWbt3GnX7Fp53'); // sin el UID de prueba
    expect(sinComentarios).not.toMatch(/if\s+true/);
    const allows = sinComentarios.match(/allow[^;]+;/g) || [];
    expect(allows.length).toBeGreaterThan(0);
    allows.forEach(a => expect(a).toMatch(/if\s+autorizado\(\)\s*;$/));
    const matches = (sinComentarios.match(/match\s+\/\S+/g) || []).map(m => m.replace(/\s+/g, ' '));
    expect(matches).toEqual(['match /databases/{database}/documents', 'match /usuarios/compartido/{document=**}']);
  });

  test('la configuración de prueba es local e ignorada por git', () => {
    execFileSync('git', ['check-ignore', '-q', 'js/firebase-prueba.local.js'], { cwd: RAIZ }); // lanza si NO está ignorado
    const rastreados = execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' }).split('\n');
    expect(rastreados).not.toContain('js/firebase-prueba.local.js');
    const ejemplo = fs.readFileSync(path.join(RAIZ, 'js/firebase-prueba.example.js'), 'utf8');
    expect(ejemplo).not.toContain('hdcredit12-2c6ba"');
    const local = path.join(RAIZ, 'js/firebase-prueba.local.js');
    if (fs.existsSync(local)) {
      const key = (fs.readFileSync(local, 'utf8').match(/apiKey:\s*"([^"]+)"/) || [])[1];
      expect(key).toBeTruthy();
      expect(ejemplo).not.toContain(key);
      let hit = '';
      try { hit = execFileSync('git', ['grep', '-l', '-F', key], { cwd: RAIZ, encoding: 'utf8' }); } catch (e) { hit = ''; }
      expect(hit.trim()).toBe('');
    }
  });

  test('ya no queda inicio anónimo, Google ni "Solo local" en el código de la app', () => {
    const js = codigoApp();
    expect(js).not.toMatch(/signInAnonymously|signInWithPopup|signInWithRedirect|GoogleAuthProvider/);
    expect(js).not.toMatch(/goLocal/);
  });

  test('7. se quitó seedData y sus datos de clientes', () => {
    const js = codigoApp();
    expect(js).not.toMatch(/seedData|xlDate/);
    expect(js).not.toMatch(/\{n:'[^']+',m:\d+/); // el arreglo de datos incrustado
  });
});
