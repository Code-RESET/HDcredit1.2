// Pruebas del login con correo y contraseña y del modo prueba.
//
// NUNCA tocan ningún Firebase (ni el real ni el de prueba):
//  - toda petición a servidores de Firebase/Google se bloquea;
//  - el SDK es FALSO (window.firebase en memoria) con Auth y Firestore simulados;
//  - en modo prueba, js/firebase-prueba.local.js se sustituye por una
//    configuración ficticia (no se lee el archivo real del disco).
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
const CFG_FICTICIA = { apiKey: 'clave-api-ficticia', authDomain: 'demo-hd-prueba.firebaseapp.com', projectId: 'demo-hd-prueba-ficticio', appId: '1:0:web:0' };
const CFG_REAL = { apiKey: 'x', authDomain: 'hdcredit12-2c6ba.firebaseapp.com', projectId: 'hdcredit12-2c6ba', appId: '1:1:web:1' };

// SDK falso. sesion: null | 'normal' | 'anonima' (estado inicial; luego se
// conserva entre recargas en sessionStorage, como hace Firebase).
function sdkFalso({ sesion, nube, correo, clave }) {
  const usuarios = {
    normal: { uid: 'uid-ficticio-cobrador', email: correo, isAnonymous: false },
    anonima: { uid: 'uid-ficticio-anonimo', email: null, isAnonymous: true },
  };
  if (sessionStorage.getItem('__sesionFalsa') === null) sessionStorage.setItem('__sesionFalsa', sesion || 'ninguna');
  const reg = window.__reg = JSON.parse(sessionStorage.getItem('__reg') || '{"intentos":[],"anonimo":0,"signOut":0,"configs":[],"firestore":0}');
  const guardar = () => sessionStorage.setItem('__reg', JSON.stringify(reg));
  const store = new Map(Object.entries(nube || {}));
  const snap = p => {
    const docs = [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
      .map(k => ({ id: k.split('/').pop(), exists: true, data: () => JSON.parse(JSON.stringify(store.get(k))) }));
    return { docs, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const docRef = p => ({ path: p, id: p.split('/').pop(), collection: n => col(p + '/' + n),
    get: async () => ({ exists: store.has(p), data: () => store.get(p) }), set: async () => {}, delete: async () => {} });
  const col = p => {
    const q = { path: p, doc: id => docRef(p + '/' + id), orderBy: () => q, where: () => q, limit: () => q, startAfter: () => q,
      get: async () => snap(p),
      onSnapshot: (a, b) => { const cb = typeof a === 'function' ? a : b; setTimeout(() => cb(snap(p)), 0); return () => {}; } };
    return q;
  };
  const DB = { enablePersistence: () => Promise.resolve(), collection: n => col(n),
    batch: () => ({ set() {}, delete() {}, commit: async () => {} }), runTransaction: async fn => fn({ get: async r => r.get(), set() {} }) };
  const escuchas = [];
  const actual = () => usuarios[sessionStorage.getItem('__sesionFalsa')] || null;
  const avisar = () => escuchas.forEach(cb => setTimeout(() => cb(actual()), 0));
  const auth = {
    get currentUser() { return actual(); },
    onAuthStateChanged(cb) { escuchas.push(cb); setTimeout(() => cb(actual()), 0); return () => {}; },
    signInWithEmailAndPassword(e, p) {
      reg.intentos.push(e); guardar(); // solo el correo: la contraseña no se registra
      if (e === correo && p === clave) { sessionStorage.setItem('__sesionFalsa', 'normal'); avisar(); return Promise.resolve({ user: actual() }); }
      const err = new Error('credencial inválida (simulado)'); err.code = 'auth/invalid-credential';
      return Promise.reject(err);
    },
    signOut() { reg.signOut++; guardar(); sessionStorage.setItem('__sesionFalsa', 'ninguna'); avisar(); return Promise.resolve(); },
    signInAnonymously() { reg.anonimo++; guardar(); return Promise.reject(new Error('el inicio anónimo no debe usarse')); },
  };
  window.firebase = {
    apps: [],
    initializeApp(cfg) { this.apps.push(cfg); reg.configs.push(cfg.projectId); guardar(); },
    auth: () => auth,
    firestore: () => { reg.firestore++; guardar(); return DB; },
  };
}

// prueba: undefined (modo normal) | objeto de configuración | 'falta' (404)
async function arrancar(page, { ls = {}, sesion = null, nube = {}, sdk = true, prueba, url = '/index.html' } = {}) {
  const bloqueadas = [];
  await page.route(BLOQUEAR, r => { bloqueadas.push(r.request().url()); r.abort(); });
  await page.route('**/js/firebase-prueba.local.js', r => {
    if (prueba === 'falta' || !prueba) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.HD_FIREBASE_PRUEBA = ' + JSON.stringify(prueba) + ';' });
  });
  await page.addInitScript(ls => {
    if (sessionStorage.getItem('__init')) return;
    sessionStorage.setItem('__init', '1');
    Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }, ls);
  if (sdk) await page.addInitScript(sdkFalso, { sesion, nube, correo: CORREO, clave: CLAVE });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loader').style.display === 'none', null, { timeout: 10000 });
  return { bloqueadas, errores };
}
const reg = page => page.evaluate(() => window.__reg || { configs: [], firestore: 0, intentos: [], anonimo: 0, signOut: 0 });
const textoVisible = page => page.evaluate(() => document.body.innerText);
const nubeConCliente = { [NUBE + 'clientes/c_ficticio_1']: CLI_FICTICIO };
const lsNube = { hd_fb: JSON.stringify(CFG_FICTICIA), hd_c: [CLI_LOCAL], hd_h: [] };

async function entrar(page, correo = CORREO, clave = CLAVE) {
  await expect(page.locator('#login-btn')).toBeEnabled();
  await page.fill('#login-email', correo);
  await page.fill('#login-pass', clave);
  await page.click('#login-btn');
}

test.describe('Login con correo y contraseña', () => {
  test('antes del login no se muestra ningún dato ni se usa Firestore', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente });
    await expect(page.locator('#login-scr')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeEnabled();
    await page.waitForTimeout(500);
    const txt = await textoVisible(page);
    expect(txt).not.toContain('ZOILA FICTICIA');
    expect(txt).not.toContain('COPIA LOCAL FICTICIA');
    expect(await page.evaluate(() => clientes.length + historial.length)).toBe(0);
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
    expect(await textoVisible(page)).not.toContain('ZOILA FICTICIA');
    const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(guardado).not.toContain('clave-equivocada-ficticia');
    expect((await reg(page)).firestore).toBe(0);
  });

  test('correo y contraseña correctos: entra, muestra los datos y nunca usa el inicio anónimo', async ({ page }) => {
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
    const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(guardado).not.toContain(CLAVE);
    expect(await page.evaluate(() => localStorage.getItem('hd_sesion'))).toBe('uid-ficticio-cobrador');
    expect(ctx.errores).toEqual([]);
  });

  test('una sesión anónima vieja se cierra y pide login (sin datos)', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'anonima' });
    await expect(page.locator('#login-scr')).toBeVisible();
    await expect.poll(async () => (await reg(page)).signOut).toBe(1);
    await page.waitForTimeout(300);
    expect(await textoVisible(page)).not.toContain('ZOILA FICTICIA');
    expect((await reg(page)).firestore).toBe(0);
  });

  test('con sesión guardada entra directo; cerrar sesión quita los datos y vuelve al login', async ({ page }) => {
    await arrancar(page, { ls: lsNube, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => gv('clientes'));
    await expect(page.locator('body')).toContainText('ZOILA FICTICIA');
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => document.getElementById('ni-salir').click()),
    ]);
    await page.waitForFunction(() => document.getElementById('loader').style.display === 'none', null, { timeout: 10000 });
    await expect(page.locator('#login-scr')).toBeVisible();
    expect(await textoVisible(page)).not.toContain('ZOILA FICTICIA');
    expect((await reg(page)).signOut).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('hd_sesion'))).toBeNull();
  });

  test('sin internet y sin sesión previa: se queda en el login y no muestra la copia local', async ({ page }) => {
    await arrancar(page, { ls: lsNube, sdk: false }); // el SDK real se bloquea → no carga
    await expect(page.locator('#login-msg')).toContainText('internet', { timeout: 20000 });
    await expect(page.locator('#login-scr')).toBeVisible();
    expect(await textoVisible(page)).not.toContain('COPIA LOCAL FICTICIA');
    await expect(page.locator('#banner-sinsync')).toBeHidden();
  });

  test('modo local elegido a mano sigue funcionando sin login', async ({ page }) => {
    await arrancar(page, { ls: { hd_fb: 'local', hd_local_manual: '1', hd_c: [CLI_LOCAL] } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await page.evaluate(() => gv('clientes'));
    await expect(page.locator('body')).toContainText('COPIA LOCAL FICTICIA');
    expect((await reg(page)).configs).toEqual([]);
  });
});

test.describe('Modo prueba (?prueba=1)', () => {
  const URL_PRUEBA = '/index.html?prueba=1';

  test('se niega a iniciar con el projectId real hdcredit12-2c6ba', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: CFG_REAL, nube: nubeConCliente, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('hdcredit12-2c6ba');
    await expect(page.locator('#login-msg')).toContainText('se niega');
    await expect(page.locator('#login-form')).toBeHidden();
    const r = await reg(page);
    expect(r.configs).toEqual([]);
    expect(r.firestore).toBe(0);
    expect(await textoVisible(page)).not.toContain('ZOILA FICTICIA');
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

  test('se niega si el navegador tiene datos de la app real', async ({ page }) => {
    await arrancar(page, { url: URL_PRUEBA, prueba: CFG_FICTICIA, ls: { hd_c: [CLI_LOCAL] }, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('datos de la app real');
    expect((await reg(page)).configs).toEqual([]);
    expect(await textoVisible(page)).not.toContain('COPIA LOCAL FICTICIA');
  });

  test('la app real se niega a conectar en un navegador usado para pruebas', async ({ page }) => {
    await arrancar(page, { ls: { hd_entorno: 'prueba', hd_c: [CLI_LOCAL] }, sesion: 'normal' });
    await expect(page.locator('#login-msg')).toContainText('modo prueba');
    expect((await reg(page)).configs).toEqual([]);
    expect(await textoVisible(page)).not.toContain('COPIA LOCAL FICTICIA');
  });
});

test.describe('Reglas y archivos', () => {
  const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  const sinComentarios = reglas.replace(/\/\/.*$/gm, '');

  test('firestore.rules: solo UID autorizados con correo y contraseña; anónimos rechazados', () => {
    expect(sinComentarios).toMatch(/rules_version\s*=\s*'2'/);
    expect(sinComentarios).toMatch(/sign_in_provider\s*==\s*'password'/);
    expect(sinComentarios).toMatch(/request\.auth\.uid\s+in\s+\[/);
    expect(sinComentarios).toContain("'ZknvkenxXEgWugfxWbt3GnX7Fp53'");
    expect(sinComentarios).not.toMatch(/if\s+true/);
    // cada allow pasa por autorizado()
    const allows = sinComentarios.match(/allow[^;]+;/g) || [];
    expect(allows.length).toBeGreaterThan(0);
    allows.forEach(a => expect(a).toMatch(/if\s+autorizado\(\)\s*;$/));
    // solo la ruta compartida
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
      // ningún archivo rastreado por git contiene la apiKey de prueba
      let hit = '';
      try { hit = execFileSync('git', ['grep', '-l', '-F', key], { cwd: RAIZ, encoding: 'utf8' }); } catch (e) { hit = ''; }
      expect(hit.trim()).toBe('');
    }
  });

  test('ya no queda inicio de sesión anónimo en el código de la app', () => {
    const js = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8')).join('\n') + fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    expect(js).not.toMatch(/signInAnonymously|signInWithPopup|signInWithRedirect|GoogleAuthProvider/);
  });
});
