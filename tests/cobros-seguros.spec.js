// Pruebas de la rama fix/cobros-seguros.
//
// NUNCA tocan el Firebase real:
//  - la app arranca en modo local (hd_fb = 'local'), así no carga el SDK;
//  - cualquier petición a servidores de Firebase se bloquea y hace fallar
//    la prueba;
//  - el "modo Firebase" se prueba con un Firestore FALSO en memoria dentro
//    de la página (window.__crearFirestoreFalso), que imita batch(),
//    runTransaction(), set/get/delete y la cola offline.
//
// Cómo correrlas:  npm test
const { test, expect } = require('@playwright/test');

const FIREBASE_REAL = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|firebaseio\.com|gstatic\.com\/firebasejs/;

// Firestore falso. Se inyecta en la página antes de cargar la app.
function firestoreFalsoInit() {
  window.__crearFirestoreFalso = function () {
    const store = new Map();               // ruta -> datos
    const log = { commits: [], transacciones: 0 };
    const ctl = { commit: 'resolve', tx: 'ok' }; // commit: resolve | hang | reject ; tx: ok | fail
    const clone = o => JSON.parse(JSON.stringify(o));
    function snapDoc(path) {
      const d = store.get(path);
      return { exists: d !== undefined, id: path.split('/').pop(), data: () => (d === undefined ? undefined : clone(d)), ref: docRef(path) };
    }
    function docRef(path) {
      return {
        path, id: path.split('/').pop(),
        collection: n => colRef(path + '/' + n),
        get: async () => snapDoc(path),
        set: (data, opts) => commitOps([{ tipo: 'set', path, data, merge: !!(opts && opts.merge) }]),
        delete: () => commitOps([{ tipo: 'delete', path }]),
      };
    }
    function colRef(path) {
      const leer = () => {
        if (ctl.lectura === 'reject') { const e = new Error('nube no disponible (simulado)'); e.code = 'unavailable'; return Promise.reject(e); }
        log.lecturas = (log.lecturas || 0) + 1;
        const docs = [...store.keys()]
          .filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
          .map(snapDoc);
        return Promise.resolve({ docs, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } });
      };
      const query = {
        path,
        doc: id => docRef(path + '/' + id),
        get: leer,
        orderBy: () => query, where: () => query, limit: () => query, startAfter: () => query,
        onSnapshot: (a, b) => {
          const cb = typeof a === 'function' ? a : b;
          log.listeners = (log.listeners || 0) + 1;
          leer().then(cb, () => {});
          return () => {};
        },
      };
      return query;
    }
    function aplicar(ops) {
      ops.forEach(o => {
        if (o.tipo === 'delete') store.delete(o.path);
        else store.set(o.path, o.merge ? { ...(store.get(o.path) || {}), ...clone(o.data) } : clone(o.data));
      });
    }
    function commitOps(ops) {
      log.commits.push(ops.map(o => ({ tipo: o.tipo, path: o.path })));
      if (ctl.commit === 'hang') return new Promise(() => {}); // sin señal: queda en cola, el servidor nunca confirma
      if (ctl.commit === 'reject') { const e = new Error('permiso denegado (simulado)'); e.code = 'permission-denied'; return Promise.reject(e); }
      aplicar(ops);
      return Promise.resolve();
    }
    const DBf = {
      enablePersistence: () => Promise.resolve(),
      // Escrituras del SDK pendientes: sin señal (commit 'hang') nunca terminan
      waitForPendingWrites: () => (ctl.commit === 'hang' ? new Promise(() => {}) : Promise.resolve()),
      collection: n => colRef(n),
      batch: () => {
        const ops = [];
        return {
          set: (ref, data, opts) => { ops.push({ tipo: 'set', path: ref.path, data, merge: !!(opts && opts.merge) }); },
          delete: ref => { ops.push({ tipo: 'delete', path: ref.path }); },
          commit: () => commitOps(ops),
        };
      },
      runTransaction: async fn => {
        log.transacciones++;
        if (ctl.tx === 'fail') { const e = new Error('unavailable (simulado)'); e.code = 'unavailable'; throw e; }
        if (ctl.tx === 'denied') { const e = new Error('permiso denegado (simulado)'); e.code = 'permission-denied'; throw e; }
        if (ctl.tx === 'hang') return new Promise(() => {});
        const ops = [];
        const tx = {
          get: async ref => snapDoc(ref.path),
          set: (ref, data, opts) => { ops.push({ tipo: 'set', path: ref.path, data, merge: !!(opts && opts.merge) }); },
        };
        const res = await fn(tx);
        if (ops.length) { log.commits.push(ops.map(o => ({ tipo: o.tipo, path: o.path, tx: true }))); aplicar(ops); }
        return res;
      },
    };
    return { DBf, store, log, ctl };
  };
}

// ls: valores iniciales de localStorage (solo la primera carga; un reload
// conserva lo que la app haya guardado). firebaseFalso: instala un
// window.firebase falso (SDK simulado) con el Firestore en memoria.
async function arrancar(page, { reloj, ls = { hd_fb: 'local', hd_local_manual: '1' }, firebaseFalso = false, nube = {}, online = true, esperarLoader = true } = {}) {
  const bloqueadas = [];
  await page.route(FIREBASE_REAL, route => { bloqueadas.push(route.request().url()); route.abort(); });
  // Sitio normal: sin configuración de prueba (si no, se forzaría el modo prueba)
  await page.route('**/js/firebase-prueba.local.js', route => route.fulfill({ status: 404, body: '' }));
  if (reloj) await page.clock.setFixedTime(new Date(reloj));
  await page.addInitScript(ls => {
    if (sessionStorage.getItem('__init')) return;
    sessionStorage.setItem('__init', '1');
    Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }, ls);
  await page.addInitScript(firestoreFalsoInit);
  await page.addInitScript(({ firebaseFalso, nube, online }) => {
    window.__online = online;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__online });
    if (!firebaseFalso) return;
    window.__fs = window.__crearFirestoreFalso();
    Object.entries(nube).forEach(([k, v]) => window.__fs.store.set(k, v));
    window.firebase = {
      apps: [],
      initializeApp(cfg) { this.apps.push(cfg); },
      // Cuenta los usos de Firestore: "conectar" = usar Firestore (Auth sí
      // se inicia antes, para el login)
      firestore: () => { window.__fsUsos = (window.__fsUsos || 0) + 1; return window.__fs.DBf; },
      // Sesión ya iniciada (usuario ficticio con correo y contraseña)
      auth: () => ({
        currentUser: { uid: 'uid-ficticio-cobrador', email: 'cobrador@ejemplo.test', isAnonymous: false },
        onAuthStateChanged(cb) { setTimeout(() => cb(this.currentUser), 0); return () => {}; },
        signOut: () => Promise.resolve(),
        signInAnonymously: () => { throw new Error('no debe usarse el inicio anónimo'); },
      }),
    };
  }, { firebaseFalso, nube, online });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loader').style.display === 'none', null, { timeout: 10000 });
  return { bloqueadas, errores };
}

// Activa el modo "Firebase" con el Firestore falso y siembra un acreditado
async function modoFirebaseFalso(page, { online = true, cliente } = {}) {
  await page.evaluate(({ online, cliente }) => {
    window.__fs = window.__crearFirestoreFalso();
    DB = window.__fs.DBf; USE_FB = true; CURRENT_UID = 'compartido';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__online });
    window.__online = online;
    if (cliente) {
      window.__fs.store.set('usuarios/compartido/clientes/' + cliente.id, JSON.parse(JSON.stringify(cliente)));
      clientes = [JSON.parse(JSON.stringify(cliente))];
      historial = [];
      refresh();
    }
  }, { online, cliente });
}

const CLIENTE = {
  id: 'c_prueba_1', nombre: 'PRUEBA COBRO', producto: 'quincenal_fijo',
  monto: 5000, pq: 1083, nq: 6, pagadas: 0, saldo: 6498,
  pagos: [false, false, false, false, false, false],
  inicio: '2026-01-01', telefono: '', notas: '', alerta: '', createdAt: '2026-01-01T00:00:00.000Z',
};

async function sembrarLocal(page, cliente = CLIENTE) {
  await page.evaluate(c => { clientes = [JSON.parse(JSON.stringify(c))]; historial = []; saveLocal(); refresh(); }, cliente);
}

let ctx;
test.beforeEach(async ({ page }, info) => {
  // esas pruebas arrancan con su propio reloj / localStorage
  if (info.title.includes('[reloj]') || info.title.includes('[arranque]')) return;
  ctx = await arrancar(page);
});
test.afterEach(async ({}, info) => {
  if (!ctx) return;
  // Con [permite-bloqueo] se ESPERA que la app intente cargar el SDK y que
  // el bloqueo lo impida (así se simula la falla de red) — igual nada sale.
  if (!info.title.includes('[permite-bloqueo]')) expect(ctx.bloqueadas, 'ninguna petición al Firebase real').toEqual([]);
  if (!info.title.includes('[permite-error-js]')) expect(ctx.errores, 'sin errores de JavaScript').toEqual([]);
  ctx = null;
});

/* ───────────── 1. PAGO / REVERSO explícito ───────────── */
test.describe('1. el botón dice PAGO o REVERSO', () => {
  test('un segundo PAGO de la misma quincena no anula el primero (local)', async ({ page }) => {
    await sembrarLocal(page);
    const r = await page.evaluate(async () => {
      const a = await registrarCobro('c_prueba_1', 0, 'PAGO');
      const b = await registrarCobro('c_prueba_1', 0, 'PAGO');
      const c = clientes[0];
      return { a, b, pagadas: c.pagadas, saldo: c.saldo, p0: c.pagos[0], acciones: historial.map(h => h.accion) };
    });
    expect(r.a.ok).toBe(true);
    expect(r.b).toMatchObject({ ok: false, motivo: 'sin_cambio' });
    expect(r.pagadas).toBe(1);
    expect(r.p0).toBe(true);
    expect(r.saldo).toBe(5 * 1083);
    expect(r.acciones).toEqual(['PAGO']);
    await expect(page.locator('#toasts')).toContainText('ya estaba cobrada');
  });

  test('REVERSO de una quincena no pagada no la marca como pagada', async ({ page }) => {
    await sembrarLocal(page);
    const r = await page.evaluate(async () => {
      const a = await registrarCobro('c_prueba_1', 2, 'REVERSO');
      return { a, pagadas: clientes[0].pagadas, n: historial.length };
    });
    expect(r.a.motivo).toBe('sin_cambio');
    expect(r.pagadas).toBe(0);
    expect(r.n).toBe(0);
  });

  test('Firebase: otro dispositivo ya cobró → la transacción no escribe nada', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      // En la nube ya está pagada; este teléfono aún no se entera
      const k = 'usuarios/compartido/clientes/c_prueba_1';
      const d = window.__fs.store.get(k); d.pagos[0] = true; d.pagadas = 1; window.__fs.store.set(k, d);
      const res = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { res, commits: window.__fs.log.commits.length, nube: window.__fs.store.get(k) };
    });
    expect(r.res.motivo).toBe('sin_cambio');
    expect(r.commits).toBe(0);
    expect(r.nube.pagos[0]).toBe(true);
    expect(r.nube.pagadas).toBe(1);
  });
});

/* ───────────── 2. Operación atómica ───────────── */
test.describe('2. acreditado + historial en una sola operación', () => {
  test('con red: transacción con las 2 escrituras juntas', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      const res = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { res, commits: window.__fs.log.commits };
    });
    expect(r.res).toMatchObject({ ok: true, estado: 'ok' });
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0].map(o => o.path.split('/')[2])).toEqual(['clientes', 'historial']);
  });

  test('sin conexión: queda en cola sin escribir; al volver la red sube en UNA transacción', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      const t0 = Date.now();
      const res = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { res, ms: Date.now() - t0, commits: window.__fs.log.commits.length, cola: leerCola().length,
               pagadas: clientes[0].pagadas, hist: historial.filter(h => h.clienteId === 'c_prueba_1').length };
    });
    expect(r.res).toMatchObject({ ok: true, estado: 'pendiente' });
    expect(r.commits).toBe(0);                          // sin red no se escribe `pagos` completo
    expect(r.cola).toBe(1);
    expect(r.pagadas).toBe(1);                          // la pantalla ya lo ve cobrado
    expect(r.hist).toBe(1);
    expect(r.ms).toBeLessThan(2000);
    await expect(page.locator('#toasts')).toContainText('pendiente de subir');
    const s = await page.evaluate(async () => {
      window.__online = true; await procesarColaCobros();
      return { commits: window.__fs.log.commits, cola: leerCola().length };
    });
    expect(s.cola).toBe(0);
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0].map(o => o.path.split('/')[2])).toEqual(['clientes', 'historial']);
  });

  test('si la transacción falla por RED, el cobro va a la cola; por otro error, se muestra y no se registra', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      window.__fs.ctl.tx = 'fail';
      const a = await registrarCobro('c_prueba_1', 0, 'PAGO');
      const colaA = leerCola().length;
      await new Promise(res => setTimeout(res, 50));    // deja correr el intento automático de la cola
      localStorage.removeItem('hd_cola_cobros');        // (para probar el otro caso sin cola previa)
      window.__fs.ctl.tx = 'denied';
      const b = await registrarCobro('c_prueba_1', 1, 'PAGO');
      return { a, colaA, b, cola: leerCola().length, commits: window.__fs.log.commits.length };
    });
    expect(r.a).toMatchObject({ ok: true, estado: 'pendiente' });
    expect(r.colaA).toBe(1);
    expect(r.b).toMatchObject({ ok: false, motivo: 'error' });
    expect(r.cola).toBe(0);
    expect(r.commits).toBe(0);
  });
});

/* ───────────── A1. Cobros sin red no pisan a otro teléfono ───────────── */
test.describe('A1. cobros sin red', () => {
  const K = 'usuarios/compartido/clientes/c_prueba_1';

  test('un cobro sin red NO borra el cobro que otro teléfono hizo mientras tanto', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: { ...CLIENTE, pagos: [true, false, false, false, false, false], pagadas: 1, saldo: 5 * 1083 } });
    const r = await page.evaluate(async (K) => {
      await registrarCobro('c_prueba_1', 1, 'PAGO');                  // este teléfono, sin red: Q2
      const d = window.__fs.store.get(K);                              // otro teléfono, con red: Q3
      d.pagos[2] = true; d.pagadas = 2; window.__fs.store.set(K, d);
      window.__online = true; await procesarColaCobros();
      return window.__fs.store.get(K);
    }, K);
    expect(r.pagos.slice(0, 3)).toEqual([true, true, true]);          // antes quedaba [T,T,F]
    expect(r.pagadas).toBe(3);
    expect(r.saldo).toBe(3 * 1083);
  });

  test('duplicados: si el movimiento ya llegó a la nube, reintentar no lo repite', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    const r = await page.evaluate(async (K) => {
      await registrarCobro('c_prueba_1', 0, 'PAGO');
      // Simula: la transacción SÍ llegó al servidor pero el teléfono no recibió respuesta
      const it = leerCola()[0];
      window.__fs.store.set('usuarios/compartido/historial/' + it.log.id, it.log);
      const d = window.__fs.store.get(K); d.pagos[0] = true; d.pagadas = 1; window.__fs.store.set(K, d);
      window.__online = true;
      await procesarColaCobros(); await procesarColaCobros();
      const hist = [...window.__fs.store.keys()].filter(k => k.includes('/historial/'));
      return { hist: hist.length, cola: leerCola().length, pagadas: window.__fs.store.get(K).pagadas, commits: window.__fs.log.commits.length };
    }, K);
    expect(r).toEqual({ hist: 1, cola: 0, pagadas: 1, commits: 0 });
  });

  test('transacción sin respuesta: el botón queda bloqueado mientras tanto y luego pasa a la cola', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    await page.evaluate(() => { window.__fs.ctl.tx = 'hang'; window.__p = registrarCobro('c_prueba_1', 0, 'PAGO'); });
    await expect(page.locator('[data-pago="c_prueba_1_0"]')).toBeDisabled();
    const otro = await page.evaluate(() => registrarCobro('c_prueba_1', 0, 'PAGO'));
    expect(otro.motivo).toBe('ocupado');
    const res = await page.evaluate(() => window.__p);
    expect(res).toMatchObject({ ok: true, estado: 'pendiente' });
    expect(await page.evaluate(() => leerCola().length)).toBe(1);
  });

  test('un cobro en cola no se "olvida" cuando llega la nube, y no se puede cobrar dos veces', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      await registrarCobro('c_prueba_1', 0, 'PAGO');
      startFBSync();                                                  // la nube aún no tiene el cobro
      await new Promise(res => setTimeout(res, 100));
      const segundo = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { p0: clientes[0].pagos[0], enHist: historial.filter(h => h.accion === 'PAGO').length, segundo, cola: leerCola().length };
    });
    expect(r.p0).toBe(true);
    expect(r.enHist).toBe(1);
    expect(r.segundo.motivo).toBe('sin_cambio');
    expect(r.cola).toBe(1);
  });
});

/* ───────────── A2. Ediciones simultáneas ───────────── */
test.describe('A2. editar no borra cobros de otro teléfono', () => {
  const K = 'usuarios/compartido/clientes/c_prueba_1';
  async function abrirYCambiar(page, campos) {
    await page.evaluate(() => editC('c_prueba_1'));
    for (const [sel, v] of Object.entries(campos)) await page.fill(sel, v);
  }

  test('cambiar solo el teléfono no toca los pagos aunque otro teléfono haya cobrado', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    await abrirYCambiar(page, { '#f-tel': '5512345678' });
    await page.evaluate((K) => {                                      // otro teléfono cobra Q1 mientras se edita
      const d = window.__fs.store.get(K); d.pagos[0] = true; d.pagadas = 1; d.saldo = 5 * 1083; window.__fs.store.set(K, d);
      clientes[0] = { ...clientes[0], pagos: d.pagos, pagadas: 1 };
    }, K);
    await page.click('#btn-save-c');
    await expect(page.locator('#m-cliente')).not.toHaveClass(/open/);
    const d = await page.evaluate((K) => window.__fs.store.get(K), K);
    expect(d.telefono).toBe('5512345678');
    expect(d.pagos[0]).toBe(true);
    expect(d.pagadas).toBe(1);
  });

  test('cambiar quincenas pagadas cuando otro teléfono cobró: se rechaza y no escribe', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    await abrirYCambiar(page, { '#f-pag': '3' });
    await page.evaluate((K) => { const d = window.__fs.store.get(K); d.pagos[0] = true; d.pagadas = 1; window.__fs.store.set(K, d); }, K);
    await page.click('#btn-save-c');
    await expect(page.locator('#toasts')).toContainText('Otro teléfono registró un cobro');
    const r = await page.evaluate((K) => ({ d: window.__fs.store.get(K), commits: window.__fs.log.commits.length }), K);
    expect(r.d.pagadas).toBe(1);
    expect(r.commits).toBe(0);
  });

  test('cambiar quincenas pagadas sin conflicto deja un AJUSTE en el historial', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    await abrirYCambiar(page, { '#f-pag': '2' });
    await page.click('#btn-save-c');
    await expect(page.locator('#m-cliente')).not.toHaveClass(/open/);
    const r = await page.evaluate((K) => ({ d: window.__fs.store.get(K),
      aj: [...window.__fs.store.entries()].filter(([k, v]) => k.includes('/historial/') && v.accion === 'AJUSTE').map(([, v]) => v) }), K);
    expect(r.d.pagadas).toBe(2);
    expect(r.d.saldo).toBe(4 * 1083);
    expect(r.aj).toHaveLength(1);
    expect(r.aj[0]).toMatchObject({ monto: 0, antes: { pagadas: 0 }, despues: { pagadas: 2 } });
  });

  test('sin red no se permite cambiar dinero (sí datos básicos)', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await abrirYCambiar(page, { '#f-pag': '2' });
    await page.click('#btn-save-c');
    await expect(page.locator('#toasts')).toContainText('necesita internet');
    expect(await page.evaluate(() => window.__fs.log.commits.length)).toBe(0);
  });
});

/* ───────────── A4 / M1 ───────────── */
test('A4. con el almacenamiento lleno la pantalla se sigue actualizando y el error se ve [permite-error-js]', async ({ page }) => {
  await modoFirebaseFalso(page, { online: true });
  await page.evaluate(() => {
    window.__fs.store.set('usuarios/compartido/clientes/c_nube', { ...{ id: 'c_nube', nombre: 'DESDE LA NUBE', producto: 'quincenal_fijo', monto: 5000, pq: 1083, nq: 6, pagadas: 0, saldo: 6498, pagos: [false,false,false,false,false,false], inicio: '2026-01-01', createdAt: '2026-01-01' } });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'hd_c' || k === 'hd_h') { const e = new Error('QuotaExceededError (simulado)'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
    startFBSync();
  });
  await page.click('#sidebar .ni:has-text("Acreditados")');
  await expect(page.locator('#tb-c')).toContainText('DESDE LA NUBE');
  await expect(page.locator('#err-badge')).toBeVisible();
});

test.describe('M1. fecha local', () => {
  test.use({ timezoneId: 'America/Mexico_City' });
  test('[reloj] a las 19:30 del 14 (hora México) la fecha de inicio es el 14, no el 15', async ({ page }) => {
    ctx = await arrancar(page, { reloj: '2026-08-14T19:30:00-06:00' });
    await page.evaluate(() => openNew());
    await expect(page.locator('#f-ini')).toHaveValue('2026-08-14');
  });
});

/* ───────────── 3. Bloqueos y duplicados ───────────── */
test.describe('3. botón bloqueado y sin duplicados', () => {
  test('dos cobros simultáneos del mismo acreditado: el segundo se rechaza', async ({ page }) => {
    await sembrarLocal(page);
    const r = await page.evaluate(async () => {
      const [a, b] = await Promise.all([registrarCobro('c_prueba_1', 0, 'PAGO'), registrarCobro('c_prueba_1', 1, 'PAGO')]);
      return { a, b, pagadas: clientes[0].pagadas };
    });
    expect(r.a.ok).toBe(true);
    expect(r.b.motivo).toBe('ocupado');
    expect(r.pagadas).toBe(1);
  });

  test('tocar "Guardar" varias veces sin señal crea UN solo acreditado', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false });
    await page.evaluate(() => { window.__fs.ctl.commit = 'hang'; });
    await page.click('#v-checklist >> text=Agregar');
    await page.fill('#f-nom', 'DUPLICADO NO');
    await page.selectOption('#f-monto', '5000');
    await page.selectOption('#f-plazo', '6');
    await page.evaluate(() => { saveC(); saveC(); saveC(); });
    await expect(page.locator('#btn-save-c')).toBeDisabled();
    await expect(page.locator('#m-cliente')).not.toHaveClass(/open/, { timeout: 8000 });
    const ids = await page.evaluate(() => [...new Set(window.__fs.log.commits.flat().filter(o => o.path.includes('/clientes/')).map(o => o.path))]);
    expect(ids).toHaveLength(1);
    await expect(page.locator('#toasts')).toContainText('pendiente de subir');
  });

  test('modo local: guardar dos veces seguidas crea un solo acreditado', async ({ page }) => {
    await page.click('#v-checklist >> text=Agregar');
    await page.fill('#f-nom', 'UNO SOLO');
    await page.selectOption('#f-monto', '5000');
    await page.selectOption('#f-plazo', '6');
    const n = await page.evaluate(async () => { await Promise.all([saveC(), saveC()]); return clientes.filter(c => c.nombre === 'UNO SOLO').length; });
    expect(n).toBe(1);
  });
});

/* ───────────── 6. Deshacer ───────────── */
test.describe('6. deshacer solo dice éxito si funcionó', () => {
  test('deshacer un PAGO registra un REVERSO y lo confirma', async ({ page }) => {
    await sembrarLocal(page);
    const r = await page.evaluate(async () => {
      await registrarCobro('c_prueba_1', 0, 'PAGO');
      const u = await undoLastPago();
      return { u, acciones: historial.map(h => h.accion), pagadas: clientes[0].pagadas };
    });
    expect(r.u.ok).toBe(true);
    expect(r.acciones).toEqual(['REVERSO', 'PAGO']);
    expect(r.pagadas).toBe(0);
    await expect(page.locator('#toasts')).toContainText('Acción deshecha');
  });

  test('si deshacer falla, NO dice "Acción deshecha" y el error queda visible', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      await registrarCobro('c_prueba_1', 0, 'PAGO');
      document.getElementById('toasts').innerHTML = '';
      window.__fs.ctl.tx = 'denied'; // error que NO es de red: no va a la cola
      const u = await undoLastPago();
      return { u, nube: window.__fs.store.get('usuarios/compartido/clientes/c_prueba_1') };
    });
    expect(r.u.ok).toBe(false);
    expect(r.nube.pagos[0]).toBe(true); // el pago sigue
    await expect(page.locator('#toasts')).toContainText('No se pudo deshacer');
    await expect(page.locator('#toasts')).not.toContainText('Acción deshecha');
    await expect(page.locator('#err-badge')).toBeVisible();
  });

  test('si otro dispositivo ya lo revirtió, deshacer no lo vuelve a cobrar', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      await registrarCobro('c_prueba_1', 0, 'PAGO');
      const k = 'usuarios/compartido/clientes/c_prueba_1';
      const d = window.__fs.store.get(k); d.pagos[0] = false; d.pagadas = 0; window.__fs.store.set(k, d);
      document.getElementById('toasts').innerHTML = '';
      const u = await undoLastPago();
      return { u, nube: window.__fs.store.get(k) };
    });
    expect(r.u.motivo).toBe('sin_cambio');
    expect(r.nube.pagos[0]).toBe(false);
    await expect(page.locator('#toasts')).toContainText('No se deshizo');
  });
});

/* ───────────── 7. Quincenas negativas ───────────── */
test('7. no acepta quincenas pagadas negativas', async ({ page }) => {
  await page.click('#v-checklist >> text=Agregar');
  await page.fill('#f-nom', 'NEGATIVO');
  await page.selectOption('#f-monto', '8000');
  await page.selectOption('#f-plazo', '12');
  await page.fill('#f-pag', '-3');
  await page.click('#btn-save-c');
  await expect(page.locator('#toasts')).toContainText('no pueden ser negativas');
  const n = await page.evaluate(() => clientes.filter(c => c.nombre === 'NEGATIVO').length);
  expect(n).toBe(0);
});

/* ───────────── 8. Regla de atraso ───────────── */
test.describe('8. atrasado desde el día siguiente al vencimiento', () => {
  test.use({ timezoneId: 'America/Mexico_City' });
  const Q = { id: 'c_at', nombre: 'ATRASO', producto: 'quincenal_fijo', monto: 5000, pq: 1083, nq: 6, pagadas: 0, saldo: 6498,
              pagos: [false, false, false, false, false, false], inicio: '2026-08-03', createdAt: '2026-08-03T00:00:00Z' };

  async function estado(page, cuando, c = Q) {
    await page.clock.setFixedTime(new Date(cuando));
    return page.evaluate(c => {
      clientes = [c]; syncAlertas(); renderMorosos();
      const rec = calcRecargoPorCliente(c);
      return { alerta: calcAlerta(c), total: rec.total, dias: rec.periodos.map(p => p.diasAtraso),
               mor: document.getElementById('mr-count').textContent, recTxt: document.getElementById('mr-recargos').textContent };
    }, c);
  }

  test('[reloj] día 15 (vencimiento) todavía al corriente; día 16 atrasado con 1 día', async ({ page }) => {
    ctx = await arrancar(page, { reloj: '2026-08-15T08:00:00-06:00' });
    let e = await estado(page, '2026-08-15T08:00:00-06:00');
    expect(e).toMatchObject({ alerta: '', total: 0, mor: '0' });
    e = await estado(page, '2026-08-15T23:59:00-06:00');
    expect(e.alerta).toBe('');
    e = await estado(page, '2026-08-16T00:01:00-06:00');
    expect(e).toMatchObject({ alerta: 'ATRASADO', total: 50, dias: [1], mor: '1', recTxt: '$50' });
  });

  test('[reloj] día 31: Q1 lleva 16 días y Q2 (vence el 30) lleva 1 día', async ({ page }) => {
    ctx = await arrancar(page, { reloj: '2026-08-30T12:00:00-06:00' });
    let e = await estado(page, '2026-08-30T12:00:00-06:00');
    expect(e.dias).toEqual([15]); // el 30 solo cuenta Q1
    e = await estado(page, '2026-08-31T09:00:00-06:00');
    expect(e.dias).toEqual([16, 1]);
    expect(e.total).toBe(17 * 50);
  });

  test('[reloj] préstamo 30 días: el día 30 no es atraso; el 31 sí ($100/día)', async ({ page }) => {
    const U = { ...Q, id: 'c_u', producto: 'unico_30d', monto: 5000, pq: 5750, nq: 1, saldo: 5750, pagos: [false], inicio: '2026-08-01' };
    ctx = await arrancar(page, { reloj: '2026-08-31T10:00:00-06:00' });
    let e = await estado(page, '2026-08-31T10:00:00-06:00', U);
    expect(e.alerta).toBe('');
    e = await estado(page, '2026-09-01T07:00:00-06:00', U);
    expect(e).toMatchObject({ alerta: 'ATRASADO', total: 100, dias: [1] });
  });
});

/* ───────────── 5. Restaurar JSON ───────────── */
test.describe('5. restaurar JSON escribe de verdad en la nube (falsa)', () => {
  const RESPALDO = {
    ts: '2026-10-01T00:00:00Z', v: '2.1',
    clientes: [
      { ...CLIENTE, id: 'c_resp_1', nombre: 'DEL RESPALDO 1' },
      { ...CLIENTE, id: 'c_resp_2', nombre: 'DEL RESPALDO 2', pagadas: 2, pagos: [true, true, false, false, false, false], saldo: 4332 },
      { ...CLIENTE, id: 'c_malo', nombre: 'MALO', pagadas: -3 },
    ],
    historial: [{ id: 'h_resp_1', clienteId: 'c_resp_2', nombre: 'DEL RESPALDO 2', accion: 'PAGO', monto: 1083, qKey: '2026-09-15', ts: '2026-09-15T10:00:00Z' }],
  };

  test('pide confirmación antes y cancelar no escribe nada', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: { ...CLIENTE, id: 'c_viejo', nombre: 'VIEJO' } });
    await page.evaluate(p => prepararRestauracion(p), RESPALDO);
    await expect(page.locator('#m-restaurar')).toHaveClass(/open/);
    await expect(page.locator('#rest-msg')).toContainText('EN LA NUBE');
    await expect(page.locator('#rest-msg')).toContainText('Se omitirán 1');
    await page.click('#rest-cancel');
    const n = await page.evaluate(() => window.__fs.log.commits.length);
    expect(n).toBe(0);
  });

  test('al confirmar: escribe respaldo, borra lo que sobra y luego muestra éxito', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: { ...CLIENTE, id: 'c_viejo', nombre: 'VIEJO' } });
    await page.evaluate(p => prepararRestauracion(p), RESPALDO);
    await page.click('#rest-ok');
    await expect(page.locator('#toasts')).toContainText('restaurados');
    const r = await page.evaluate(() => ({
      llaves: [...window.__fs.store.keys()].sort(),
      ops: window.__fs.log.commits.flat().map(o => o.tipo),
    }));
    expect(r.llaves).toEqual([
      'usuarios/compartido/clientes/c_resp_1',
      'usuarios/compartido/clientes/c_resp_2',
      'usuarios/compartido/historial/h_resp_1',
    ]);
    expect(r.ops).toEqual(['set', 'set', 'set', 'delete']); // borrar va al final
    await expect(page.locator('#m-restaurar')).not.toHaveClass(/open/);
  });

  test('si la nube rechaza, NO muestra éxito y el error queda registrado', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: { ...CLIENTE, id: 'c_viejo', nombre: 'VIEJO' } });
    await page.evaluate(p => { window.__fs.ctl.commit = 'reject'; prepararRestauracion(p); }, RESPALDO);
    await page.click('#rest-ok');
    await expect(page.locator('#toasts')).toContainText('NO se completó');
    await expect(page.locator('#toasts')).not.toContainText('restaurados');
    await expect(page.locator('#m-restaurar')).toHaveClass(/open/);
    await expect(page.locator('#err-badge')).toBeVisible();
    const viejo = await page.evaluate(() => window.__fs.store.has('usuarios/compartido/clientes/c_viejo'));
    expect(viejo).toBe(true);
  });

  test('sin conexión no restaura (necesita confirmación del servidor)', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: { ...CLIENTE, id: 'c_viejo', nombre: 'VIEJO' } });
    await page.evaluate(p => prepararRestauracion(p), RESPALDO);
    await page.click('#rest-ok');
    await expect(page.locator('#toasts')).toContainText('Sin conexión');
    const n = await page.evaluate(() => window.__fs.log.commits.length);
    expect(n).toBe(0);
  });
});

/* ───────────── 9. Errores silenciosos visibles ───────────── */
test('9. un error de JavaScript aparece en el aviso rojo y en la lista [permite-error-js]', async ({ page }) => {
  await expect(page.locator('#err-badge')).toBeHidden();
  await page.evaluate(() => setTimeout(() => { throw new Error('falla de prueba'); }, 0));
  await expect(page.locator('#err-badge')).toBeVisible();
  await expect(page.locator('#err-count')).toHaveText('1');
  await page.click('#err-badge');
  await expect(page.locator('#err-body')).toContainText('falla de prueba');
  // Persiste al recargar (queda en el dispositivo)
  await page.reload();
  await expect(page.locator('#err-badge')).toBeVisible();
});

/* ───────────── 4. Rescate de teléfonos en modo local ───────────── */
test.describe('4. rescate de datos locales', () => {
  const NUBE = 'usuarios/compartido/';
  const A = { ...CLIENTE, id: 'c_A', nombre: 'ANA', pagos: [true, false, false, false, false, false], pagadas: 1, saldo: 5 * 1083 };
  const C = { ...CLIENTE, id: 'c_C', nombre: 'CARLOS', pagos: [true, false, false, false, false, false], pagadas: 1, saldo: 5 * 1083 };
  const mov = (id, cli, nombre) => ({ id, clienteId: cli, nombre, monto: 1083, qIndex: 0, qKey: '2026-09-15', accion: 'PAGO',
                                      fecha: '15/9/2026', hora: '10:00:00', ts: '2026-09-15T16:00:00.000Z' });
  const hA = mov('h_local_A', 'c_A', 'ANA'), hC = mov('h_local_C', 'c_C', 'CARLOS');
  const LEGADO = { hd_fb: 'local', hd_c: [A, C], hd_h: [hA, hC] };            // versión anterior: 'local' por fallo
  const NUBE_BASE = { [NUBE + 'clientes/c_A']: { ...CLIENTE, id: 'c_A', nombre: 'ANA' },  // el cobro de ANA nunca subió
                      [NUBE + 'clientes/c_B']: { ...CLIENTE, id: 'c_B', nombre: 'BETO' } };

  async function pasarPaso1(page) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#resc-descargar')]);
    const json = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    await page.check('#resc-check');
    return json;
  }
  const nube = page => page.evaluate(() => Object.fromEntries(window.__fs.store));
  const marcarTodo = page => page.evaluate(() => document.querySelectorAll('#resc-comparacion input[type=checkbox]').forEach(i => { i.checked = true; }));
  // Antes de confirmar el rescate solo se hace la lectura que confirma el
  // acceso; lo que importa es que no se sincronice ni se escriba nada
  const sdkIniciado = page => page.evaluate(() => window.__fs ? (window.__fs.log.listeners || 0) + window.__fs.log.commits.length : 0);

  test('[arranque] teléfono heredado: no conecta antes de descargar y confirmar', async ({ page }) => {
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: NUBE_BASE });
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    await expect(page.locator('#banner-sinsync')).toBeVisible();
    await expect(page.locator('#resc-comparar')).toBeDisabled();
    await page.check('#resc-check');                       // confirmar sin descargar no basta
    await expect(page.locator('#resc-comparar')).toBeDisabled();
    await page.evaluate(() => rescateComparar());          // ni llamándolo directo
    await expect(page.locator('#toasts')).toContainText('Primero descarga');
    expect(await sdkIniciado(page)).toBe(0);
    await page.keyboard.press('Escape');                   // no se puede cerrar
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    const copia = await page.evaluate(() => Object.keys(localStorage).filter(k => /^hd_rescate_\d+$/.test(k)).length);
    expect(copia).toBe(1);
  });

  test('[arranque] rescate completo: compara, sube solo faltantes y no toca lo demás', async ({ page }) => {
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: NUBE_BASE });
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    const json = await pasarPaso1(page);
    expect(json.clientes).toHaveLength(2);
    expect(json.historial).toHaveLength(2);
    await page.click('#resc-comparar');
    const cmp = page.locator('#resc-comparacion');
    await expect(cmp).toContainText('Acreditados que faltan en la nube: 1');
    await expect(cmp).toContainText('Cobros / reversos que faltan en la nube: 2');
    await expect(cmp).toContainText('la nube NO se reemplaza): 1');
    await expect(cmp).toContainText('Solo en la nube (no se tocan): 1');
    expect(await page.evaluate(() => window.__fs.log.commits.length)).toBe(0); // comparar no escribe
    await expect(page.locator('#resc-subir')).toBeDisabled();
    await marcarTodo(page); // teléfono heredado: sin fecha de sincronización, todo viene desmarcado
    await page.check('#resc-check2');
    await page.click('#resc-subir');
    await expect(page.locator('#resc-resultado')).toContainText('Acreditados creados en la nube: 1');
    await expect(page.locator('#resc-resultado')).toContainText('Movimientos subidos: 2');
    const n = await nube(page);
    expect(n[NUBE + 'clientes/c_A'].pagos[0]).toBe(true);
    expect(n[NUBE + 'clientes/c_A'].pagadas).toBe(1);
    expect(n[NUBE + 'clientes/c_C'].nombre).toBe('CARLOS');
    expect(n[NUBE + 'historial/h_local_A']).toBeTruthy();
    expect(n[NUBE + 'historial/h_local_C']).toBeTruthy();
    expect(n[NUBE + 'clientes/c_B']).toEqual({ ...CLIENTE, id: 'c_B', nombre: 'BETO' }); // intacto
    await page.click('#resc-terminar');
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
    await expect(page.locator('#banner-sinsync')).toBeHidden();
    const ls = await page.evaluate(() => ({ fb: localStorage.getItem('hd_fb'), pend: localStorage.getItem('hd_rescate_pendiente'),
      copias: Object.keys(localStorage).filter(k => /^hd_rescate_\d+$/.test(k)).length }));
    expect(ls.fb.startsWith('{')).toBe(true);
    expect(ls.pend).toBeNull();
    expect(ls.copias).toBe(1); // la copia de rescate NO se borra
  });

  test('[arranque] un cobro que otro teléfono ya registró no se duplica; repetir la subida tampoco', async ({ page }) => {
    const nubeCobrada = { ...NUBE_BASE,
      [NUBE + 'clientes/c_A']: { ...A },
      [NUBE + 'historial/h_otro']: mov('h_otro', 'c_A', 'ANA') };
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: nubeCobrada });
    await pasarPaso1(page);
    await page.click('#resc-comparar');
    await marcarTodo(page);
    await page.check('#resc-check2');
    await page.click('#resc-subir');
    await expect(page.locator('#resc-resultado')).toContainText('Ya estaban en la nube (no se duplicaron): 1');
    await page.evaluate(() => rescateSubir()); // segunda vez (p.ej. reintento)
    const n = await nube(page);
    const histDe = id => Object.entries(n).filter(([k, v]) => k.includes('/historial/') && v.clienteId === id).length;
    expect(histDe('c_A')).toBe(1);   // solo el del otro teléfono
    expect(histDe('c_C')).toBe(1);
    expect(n[NUBE + 'historial/h_local_A']).toBeUndefined();
    expect(n[NUBE + 'clientes/c_A'].pagadas).toBe(1);
    expect(n[NUBE + 'clientes/c_C'].pagadas).toBe(1);
  });

  test('[arranque] sin internet: no conecta y conserva todo en local', async ({ page }) => {
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: NUBE_BASE, online: false });
    await pasarPaso1(page);
    await page.click('#resc-comparar');
    await expect(page.locator('#toasts')).toContainText('Sin internet');
    expect(await sdkIniciado(page)).toBe(0);
    await page.click('#resc-local');
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
    await expect(page.locator('#banner-sinsync')).toBeVisible();
    const ls = await page.evaluate(() => ({ c: JSON.parse(localStorage.getItem('hd_c')), pend: localStorage.getItem('hd_rescate_pendiente') }));
    expect(ls.c.map(c => c.id)).toEqual(['c_A', 'c_C']);
    expect(ls.pend).toBe('1');
    expect(await page.evaluate(() => window.__fs.log.commits.length)).toBe(0);
  });

  test('[arranque] si la nube falla al comparar, no se toca nada', async ({ page }) => {
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: NUBE_BASE });
    await pasarPaso1(page);
    await page.evaluate(() => { window.__fs.ctl.lectura = 'reject'; });
    await page.click('#resc-comparar');
    await expect(page.locator('#toasts')).toContainText('No se pudo comparar');
    await expect(page.locator('#resc-paso1')).toBeVisible();
    const r = await page.evaluate(() => ({ fb: USE_FB, c: JSON.parse(localStorage.getItem('hd_c')).length, commits: window.__fs.log.commits.length }));
    expect(r).toEqual({ fb: false, c: 2, commits: 0 });
  });

  test('[arranque] modo local elegido a mano: no pide rescate', async ({ page }) => {
    ctx = await arrancar(page, { ls: { hd_fb: 'local', hd_local_manual: '1', hd_c: [A] }, firebaseFalso: true });
    await expect(page.locator('#m-rescate')).not.toHaveClass(/open/);
    await expect(page.locator('#banner-sinsync')).toBeHidden();
    expect(await sdkIniciado(page)).toBe(0);
  });

  test('[arranque][permite-bloqueo] falla temporal: no guarda modo local y protege lo cobrado', async ({ page }) => {
    const cfg = JSON.stringify({ apiKey: 'falsa', projectId: 'demo-prueba' });
    // Sesión confirmada por la nube (falsa); luego la conexión falla a media
    // sesión (p. ej. reconectar con red mala) y se trabaja en local temporal.
    // Un SDK que NO carga al abrir ya no muestra datos (ver login.spec.js).
    ctx = await arrancar(page, { ls: { hd_fb: cfg }, firebaseFalso: true, nube: { ['usuarios/compartido/clientes/c_prueba_1']: { ...CLIENTE } } });
    await expect(page.locator('#login-scr')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('hd_c') || '[]')).length)).toBe(1);
    await page.evaluate(() => modoLocalTemporal('Firebase tardó demasiado en responder.'));
    await expect(page.locator('#banner-sinsync')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#sync-lbl')).toContainText('SIN SINCRONIZAR');
    expect(await page.evaluate(() => localStorage.getItem('hd_fb'))).not.toBe('local'); // NO quedó 'local'
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBeNull();
    await page.evaluate(() => registrarCobro('c_prueba_1', 0, 'PAGO'));
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
    await page.reload();
    await expect(page.locator('#m-rescate')).toHaveClass(/open/, { timeout: 10000 }); // al volver: rescate, no reemplazo
    const c = await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c'))[0].pagos[0]);
    expect(c).toBe(true);
  });

  test('[arranque] A3: un acreditado borrado en otro teléfono NO revive por defecto; uno creado aquí sí sube', async ({ page }) => {
    const VIEJO = { ...C, id: 'c_borrado', nombre: 'BORRADO ALLA', createdAt: '2026-01-01T00:00:00.000Z' };
    const NUEVO = { ...C, id: 'c_nuevo', nombre: 'NUEVO AQUI', createdAt: '2026-10-05T00:00:00.000Z' };
    ctx = await arrancar(page, {
      ls: { hd_fb: JSON.stringify({ apiKey: 'falsa', projectId: 'demo-prueba' }), hd_rescate_pendiente: '1',
            hd_ultima_sync: '2026-10-01T00:00:00.000Z', hd_c: [VIEJO, NUEVO], hd_h: [mov('h_b', 'c_borrado', 'BORRADO ALLA')] },
      firebaseFalso: true, nube: {} });
    await pasarPaso1(page);
    await page.click('#resc-comparar');
    await expect(page.locator('#resc-comparacion')).toContainText('podría haberse borrado en otro teléfono');
    await expect(page.locator('input[data-resc-cli="c_borrado"]')).not.toBeChecked();
    await expect(page.locator('input[data-resc-mov="h_b"]')).not.toBeChecked();
    await expect(page.locator('input[data-resc-cli="c_nuevo"]')).toBeChecked();
    await page.check('#resc-check2');
    await page.click('#resc-subir');
    await expect(page.locator('#resc-resultado')).toContainText('Acreditados creados en la nube: 1');
    const n = await nube(page);
    expect(n[NUBE + 'clientes/c_nuevo']).toBeTruthy();
    expect(n[NUBE + 'clientes/c_borrado']).toBeUndefined();
    expect(n[NUBE + 'historial/h_b']).toBeUndefined();
    // …y sigue en el teléfono (no se borra nada local)
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c')).map(c => c.id));
    expect(local).toContain('c_borrado');
  });

  test('[arranque] M7: un movimiento local más viejo que un cambio de la nube no se sube', async ({ page }) => {
    const reversoNuevo = { ...mov('h_rev', 'c_A', 'ANA'), accion: 'REVERSO', ts: '2026-09-20T10:00:00.000Z' };
    ctx = await arrancar(page, { ls: LEGADO, firebaseFalso: true, nube: { ...NUBE_BASE, [NUBE + 'historial/h_rev']: reversoNuevo } });
    await pasarPaso1(page);
    await page.click('#resc-comparar');
    await expect(page.locator('#resc-comparacion')).toContainText('la nube tiene un cambio más reciente');
    await expect(page.locator('input[data-resc-mov="h_local_A"]')).toHaveCount(0);
  });

  test('[arranque] M5: un qIndex malicioso no inyecta HTML en la comparación', async ({ page }) => {
    const malo = { ...mov('h_malo', 'c_A', 'ANA'), qIndex: '<img src=x onerror="window.__xss=1">' };
    ctx = await arrancar(page, { ls: { ...LEGADO, hd_h: [malo] }, firebaseFalso: true, nube: NUBE_BASE });
    await pasarPaso1(page);
    await page.click('#resc-comparar');
    await expect(page.locator('#resc-comparacion')).toContainText('Q?');
    expect(await page.locator('#resc-comparacion img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('[arranque] A4: las copias de rescate solo se borran a mano, con doble confirmación y si ya se descargaron', async ({ page }) => {
    ctx = await arrancar(page, { ls: { hd_fb: 'local', hd_local_manual: '1',
      hd_rescate_111: { clientes: [], historial: [] }, hd_rescate_222: { clientes: [], historial: [] }, hd_rescate_333: { clientes: [], historial: [] },
      hd_rescate_descargados: ['hd_rescate_111', 'hd_rescate_222'], hd_rescate_actual: 'hd_rescate_222' } });
    await page.evaluate(() => abrirErrores());
    await expect(page.locator('#esp-info')).toContainText('ya descargadas: 1');
    await page.click('#esp-borrar');                                   // 1er toque: solo pide confirmar
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_111'))).not.toBeNull();
    await page.click('#esp-borrar');                                   // 2º toque: borra
    const r = await page.evaluate(() => ['hd_rescate_111', 'hd_rescate_222', 'hd_rescate_333'].map(k => localStorage.getItem(k) !== null));
    expect(r).toEqual([false, true, true]); // la actual y la no descargada se quedan
  });
});

test('4. comparación local ↔ nube (función pura)', async ({ page }) => {
  const r = await page.evaluate(() => compararLocalNube(
    { clientes: [{ id: 'a', pagos: [true] }, { id: 'b', pagos: [false] }],
      historial: [{ id: 'h1', clienteId: 'a', qIndex: 0, accion: 'PAGO', ts: '2' }, { id: 'h2', clienteId: 'x', qIndex: 0, accion: 'PAGO', ts: '1' },
                  { id: 'h3', clienteId: 'a', accion: 'PAGO', ts: '3' }, { id: 'h4', clienteId: 'a', qIndex: 0, accion: 'PAGO', ts: '4' }] },
    { clientes: [{ id: 'a', pagos: [false] }, { id: 'z', pagos: [] }], historial: [{ id: 'h4' }] }));
  expect(r.acreditadosFaltantes.map(c => c.id)).toEqual(['b']);
  expect(r.movimientos.map(h => h.id)).toEqual(['h1']);
  expect(r.noAplicables.map(x => x.h.id).sort()).toEqual(['h2', 'h3']);
  expect(r.conDiferencias.map(c => c.id)).toEqual(['a']);
  expect(r.soloEnNube.map(c => c.id)).toEqual(['z']);
});

/* ───────────── Cola: rechazados, cobro doble, orden, rescate, edición ───────────── */
test.describe('Cola de cobros: casos de revisión', () => {
  const K = 'usuarios/compartido/clientes/c_prueba_1';
  // Cobro sin red: queda en cola sin intentar subir
  const cobrarSinRed = (page, qIdx = 0, accion = 'PAGO') => page.evaluate(({ qIdx, accion }) => {
    window.__online = false; return registrarCobro('c_prueba_1', qIdx, accion);
  }, { qIdx, accion });

  test('ALTO: un cobro rechazado por la nube se ve, entra al respaldo y se puede reintentar', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await cobrarSinRed(page);
    const r = await page.evaluate(async (K) => {
      const guardado = window.__fs.store.get(K);
      window.__fs.store.delete(K);                                   // otro teléfono lo borró
      window.__online = true;
      const p = await procesarColaCobros();
      return { p, guardado, rev: leerRevision(), cola: leerCola().length };
    }, K);
    expect(r.p).toMatchObject({ subidos: 0, fallidos: 1 });
    expect(r.cola).toBe(0);
    expect(r.rev).toHaveLength(1);
    expect(r.rev[0].tipo).toBe('fallido');
    await expect(page.locator('#rev-badge')).toBeVisible();
    await expect(page.locator('#rev-count')).toHaveText('1');
    await page.click('#rev-badge');
    await expect(page.locator('#revq-body')).toContainText('NO SE SUBIÓ');
    await expect(page.locator('#revq-body')).toContainText('PRUEBA COBRO');
    // Entra al respaldo JSON
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => doExportJSON())]);
    const json = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    expect(json.cobrosPorRevisar).toHaveLength(1);
    // Reintentar (ya con el acreditado de vuelta en la nube)
    await page.evaluate(({ K, g }) => window.__fs.store.set(K, g), { K, g: r.guardado });
    await page.click('#revq-body button:has-text("Reintentar")');
    await expect.poll(() => page.evaluate((K) => window.__fs.store.get(K).pagos[0], K)).toBe(true);
    expect(await page.evaluate(() => leerRevision().length)).toBe(0);
    await expect(page.locator('#rev-badge')).toBeHidden();
  });

  test('ALTO: descartar un cobro por revisar pide doble confirmación y lo conserva como descartado', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await cobrarSinRed(page);
    await page.evaluate(async (K) => { window.__fs.store.delete(K); window.__online = true; await procesarColaCobros(); abrirRevision(); }, K);
    const btn = page.locator('#revq-body button:has-text("Descartar")');
    await btn.click();
    expect(await page.evaluate(() => leerRevision().length)).toBe(1);   // un toque no basta
    await page.click('#revq-body button[data-descartar]');
    const r = await page.evaluate(() => ({ rev: leerRevision().length, desc: leerCola('hd_cola_descartados').length }));
    expect(r).toEqual({ rev: 0, desc: 1 });
  });

  test('MEDIO 1: si otro teléfono ya cobró, no cuenta como subido, avisa posible cobro doble y lo registra', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await cobrarSinRed(page, 0, 'PAGO');
    await cobrarSinRed(page, 0, 'REVERSO');                          // deshace el propio, también sin red
    const r = await page.evaluate(async (K) => {
      const d = window.__fs.store.get(K); d.pagos[0] = true; d.pagadas = 1; window.__fs.store.set(K, d); // otro teléfono cobró Q1
      document.getElementById('toasts').innerHTML = '';
      window.__online = true;
      const p = await procesarColaCobros();
      return { p, rev: leerRevision(), nube: window.__fs.store.get(K),
               hist: [...window.__fs.store.keys()].filter(k => k.includes('/historial/')).length };
    }, K);
    expect(r.p).toMatchObject({ subidos: 0, revisar: 2 });
    expect(r.rev.map(x => x.tipo)).toEqual(['revision', 'revision']);
    expect(r.rev[0].motivo).toContain('Posible cobro doble');
    expect(r.nube.pagos[0]).toBe(true);   // el REVERSO NO deshizo el cobro real del otro teléfono
    expect(r.hist).toBe(0);
    await expect(page.locator('#toasts')).toContainText('Posible cobro doble');
    await expect(page.locator('#toasts')).not.toContainText('subidos a la nube');
  });

  test('MEDIO 2: un reverso con red mientras el cobro sigue en cola no deja la quincena pagada', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await cobrarSinRed(page, 0, 'PAGO');
    const r = await page.evaluate(async (K) => {
      window.__online = true;                                         // vuelve la red; la cola aún no se procesó
      const rev = await registrarCobro('c_prueba_1', 0, 'REVERSO');
      for (let i = 0; i < 40 && leerCola().length; i++) await new Promise(res => setTimeout(res, 50));
      const hist = [...window.__fs.store.values()].filter(v => v.clienteId === 'c_prueba_1').map(v => v.accion).sort();
      return { rev, nube: window.__fs.store.get(K), hist, cola: leerCola().length };
    }, K);
    expect(r.rev.ok).toBe(true);
    expect(r.cola).toBe(0);
    expect(r.nube.pagos[0]).toBe(false);
    expect(r.nube.pagadas).toBe(0);
    expect(r.hist).toEqual(['PAGO', 'REVERSO']);
  });

  test('MEDIO 4: con cobros en cola, editar dinero avisa que hay pendientes (no un falso "otro teléfono cobró")', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await cobrarSinRed(page, 0, 'PAGO');
    await page.evaluate(() => { window.__online = true; editC('c_prueba_1'); });
    await page.fill('#f-pag', '3');
    await page.click('#btn-save-c');
    await expect(page.locator('#toasts')).toContainText('pendientes de subir');
    await expect(page.locator('#toasts')).not.toContainText('Otro teléfono registró');
    const r = await page.evaluate((K) => ({ pag: window.__fs.store.get(K).pagadas, aj: [...window.__fs.store.values()].filter(v => v.accion === 'AJUSTE').length }), K);
    expect(r).toEqual({ pag: 0, aj: 0 });
  });
});

test.describe('MEDIO 3: la cola no se adelanta al rescate', () => {
  const NUBE = 'usuarios/compartido/';
  const item = { cid: 'c_prueba_1', qIdx: 0, qKey: '2026-09-15', accion: 'PAGO', nq: 6, creado: '2026-09-15T16:00:00.000Z',
                 log: { id: 'h_q1', clienteId: 'c_prueba_1', nombre: 'PRUEBA COBRO', monto: 1083, qIndex: 0, qKey: '2026-09-15', accion: 'PAGO',
                        fecha: '15/9/2026', hora: '10:00:00', ts: '2026-09-15T16:00:00.000Z' } };
  const PAGADO = { ...CLIENTE, pagos: [true, false, false, false, false, false], pagadas: 1, saldo: 5 * 1083 };

  test('[arranque] nada se sube antes de confirmar y una casilla desmarcada se respeta', async ({ page }) => {
    ctx = await arrancar(page, {
      ls: { hd_fb: JSON.stringify({ apiKey: 'falsa', projectId: 'demo-prueba' }), hd_rescate_pendiente: '1',
            hd_c: [PAGADO], hd_h: [], hd_cola_cobros: [item] },
      firebaseFalso: true, nube: { [NUBE + 'clientes/c_prueba_1']: { ...CLIENTE } } });
    await expect(page.locator('#m-rescate')).toHaveClass(/open/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#resc-descargar')]);
    const json = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    expect(json.colaPendiente).toHaveLength(1);                     // la cola va en el respaldo del rescate
    await page.check('#resc-check');
    await page.click('#resc-comparar');
    await expect(page.locator('input[data-resc-mov="h_q1"]')).toBeVisible();
    // Con la nube ya conectada, ni el evento "online" ni el temporizador suben la cola
    await page.evaluate(async () => { window.dispatchEvent(new Event('online')); await procesarColaCobros(); });
    expect(await page.evaluate(() => window.__fs.log.commits.length)).toBe(0);
    await page.uncheck('input[data-resc-mov="h_q1"]');
    await page.check('#resc-check2');
    await page.click('#resc-subir');
    await page.click('#resc-terminar');
    await page.evaluate(async () => { await procesarColaCobros(); await new Promise(r => setTimeout(r, 100)); });
    const r = await page.evaluate((K) => ({
      p0: window.__fs.store.get(K).pagos[0], hist: window.__fs.store.has('usuarios/compartido/historial/h_q1'),
      cola: leerCola().length, rev: leerRevision().map(x => x.log.id) }), NUBE + 'clientes/c_prueba_1');
    expect(r).toEqual({ p0: false, hist: false, cola: 0, rev: ['h_q1'] }); // no se subió y quedó por revisar
  });
});
