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
      firestore: () => window.__fs.DBf,
      auth: () => ({ signInAnonymously: () => Promise.resolve({}) }),
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

  test('sin conexión: un solo lote (cliente + historial), sin trabar la pantalla', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      window.__fs.ctl.commit = 'hang'; // el servidor nunca confirma (sin señal)
      const t0 = Date.now();
      const res = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { res, ms: Date.now() - t0, commits: window.__fs.log.commits, tx: window.__fs.log.transacciones,
               pagadas: clientes[0].pagadas, hist: historial.filter(h => h.clienteId === 'c_prueba_1').length };
    });
    expect(r.res).toMatchObject({ ok: true, estado: 'pendiente' });
    expect(r.tx).toBe(0);
    expect(r.commits).toHaveLength(1);                  // UNA operación…
    expect(r.commits[0]).toHaveLength(2);               // …con las dos escrituras
    expect(r.commits[0].map(o => o.path.split('/')[2])).toEqual(['clientes', 'historial']);
    expect(r.pagadas).toBe(1);
    expect(r.hist).toBe(1);                             // el checklist ya lo ve cobrado
    expect(r.ms).toBeLessThan(6000);
    await expect(page.locator('#toasts')).toContainText('pendiente de subir');
  });

  test('si la transacción falla con red, el respaldo también es un solo lote', async ({ page }) => {
    await modoFirebaseFalso(page, { online: true, cliente: CLIENTE });
    const r = await page.evaluate(async () => {
      window.__fs.ctl.tx = 'fail';
      const res = await registrarCobro('c_prueba_1', 0, 'PAGO');
      return { res, commits: window.__fs.log.commits };
    });
    expect(r.res.ok).toBe(true);
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]).toHaveLength(2);
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

  test('el botón de cobro se ve bloqueado mientras procesa', async ({ page }) => {
    await modoFirebaseFalso(page, { online: false, cliente: CLIENTE });
    await page.evaluate(() => { window.__fs.ctl.commit = 'hang'; window.__p = registrarCobro('c_prueba_1', 0, 'PAGO'); });
    const btn = page.locator('[data-pago="c_prueba_1_0"]');
    await expect(btn).toBeDisabled();
    // tocar mientras procesa no inicia otro cobro
    await page.evaluate(() => initPago('c_prueba_1', 0));
    const res = await page.evaluate(() => window.__p);
    expect(res.estado).toBe('pendiente');
    const n = await page.evaluate(() => window.__fs.log.commits.length);
    expect(n).toBe(1);
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
      window.__fs.ctl.tx = 'fail'; window.__fs.ctl.commit = 'reject';
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
  const sdkIniciado = page => page.evaluate(() => window.firebase ? window.firebase.apps.length : 0);

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
    ctx = await arrancar(page, { ls: { hd_fb: cfg, hd_c: [{ ...CLIENTE }] } }); // sin SDK falso: la carga real se bloquea
    await expect(page.locator('#banner-sinsync')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#sync-lbl')).toContainText('SIN SINCRONIZAR');
    expect(await page.evaluate(() => localStorage.getItem('hd_fb'))).toBe(cfg); // NO quedó 'local'
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBeNull();
    await page.evaluate(() => registrarCobro('c_prueba_1', 0, 'PAGO'));
    expect(await page.evaluate(() => localStorage.getItem('hd_rescate_pendiente'))).toBe('1');
    await page.reload();
    await expect(page.locator('#m-rescate')).toHaveClass(/open/, { timeout: 10000 }); // al volver: rescate, no reemplazo
    const c = await page.evaluate(() => JSON.parse(localStorage.getItem('hd_c'))[0].pagos[0]);
    expect(c).toBe(true);
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
