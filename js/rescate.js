/* ============================================================
   RESCATE DE DATOS LOCALES
   Para teléfonos que quedaron en modo local (versiones anteriores lo
   guardaban como permanente al fallar la red) o que trabajaron sin
   sincronizar. Reglas:
   - Nunca se borran automáticamente los datos locales ni la copia de
     rescate (localStorage 'hd_rescate_<ts>').
   - No se reconecta hasta descargar el respaldo JSON y confirmarlo.
   - Se muestra la comparación local ↔ nube; solo se suben acreditados y
     movimientos FALTANTES, después de confirmar, sin duplicarlos.
   - Nunca se reemplazan datos que ya están en la nube.
   - Sin internet, todo se queda en el teléfono.
============================================================ */
let _rescate = null; // { cfg, key, descargado, local, nube, diff }

function _leerLS(k) {
  try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; }
  catch(e) { reportarError('Leer ' + k, e); return []; }
}
function _datosLocalesActuales() {
  // Los cobros en cola (sin subir) también entran a la comparación: así
  // se ven y respetan las casillas como cualquier otro movimiento
  const historial = _leerLS('hd_h');
  const ids = new Set(historial.map(h => h && h.id));
  _leerLS('hd_cola_cobros').forEach(it => { if (it && it.log && !ids.has(it.log.id)) { historial.unshift(it.log); ids.add(it.log.id); } });
  return { clientes: _leerLS('hd_c'), historial };
}
// Lo que va en la copia de rescate y en el JSON descargado: además de
// acreditados e historial, la cola sin subir y los cobros por revisar.
function _paqueteRescate() {
  return { ..._datosLocalesActuales(), colaPendiente: _leerLS('hd_cola_cobros'), cobrosPorRevisar: _leerLS('hd_cola_fallidos') };
}

function iniciarRescate(cfg) {
  USE_FB = false;
  _modoLocalTemporal = true;
  loadLocal(); // se trabaja con lo local, sin tocar nada
  setSyncLbl('sin-sync');
  mostrarBannerSinSync('rescate pendiente');

  // Copia de rescate: se crea una nueva cada vez que los datos locales
  // cambiaron desde la última; las anteriores nunca se borran.
  const local = _datosLocalesActuales();
  const contenido = JSON.stringify(local);
  let key = localStorage.getItem('hd_rescate_actual');
  let copiaPrevia = null;
  if (key) { try { copiaPrevia = localStorage.getItem(key); } catch(e) { copiaPrevia = null; } }
  let previa = null;
  try { previa = copiaPrevia ? JSON.stringify((({clientes, historial}) => ({clientes, historial}))(JSON.parse(copiaPrevia))) : null; } catch(e) { previa = null; }
  if (!key || previa !== contenido) {
    key = 'hd_rescate_' + Date.now();
    try {
      localStorage.setItem(key, JSON.stringify({ ..._paqueteRescate(), ts: new Date().toISOString(), v: '2.1', origen: 'rescate' }));
      localStorage.setItem('hd_rescate_actual', key);
    } catch(e) {
      reportarError('Guardar copia de rescate', e);
      toast('⚠️ No hay espacio para la copia de rescate: descarga el respaldo JSON ahora', 'err');
      key = null;
    }
  }
  _rescate = { cfg, key, descargado: !!key && localStorage.getItem('hd_rescate_descargado') === key, local };

  document.getElementById('resc-resumen').textContent =
    `Este teléfono tiene ${local.clientes.length} acreditados y ${local.historial.length} movimientos que podrían no estar en la nube.\n\n`
    + 'Antes de volver a conectar:\n1. Descarga el respaldo JSON.\n2. Confirma que lo guardaste.\n3. Revisa la comparación con la nube.';
  document.getElementById('resc-paso1').hidden = false;
  document.getElementById('resc-paso2').hidden = true;
  document.getElementById('resc-paso3').hidden = true;
  document.getElementById('resc-check').checked = false;
  document.getElementById('resc-check2').checked = false;
  document.getElementById('resc-check').onchange = _rescateBotones;
  document.getElementById('resc-check2').onchange = _rescateBotones;
  _rescateBotones();
  om('m-rescate');
}

function _rescateBotones() {
  if (!_rescate) return;
  const ok1 = _rescate.descargado && document.getElementById('resc-check').checked;
  document.getElementById('resc-comparar').disabled = !ok1;
  const ok2 = document.getElementById('resc-check2').checked;
  document.getElementById('resc-subir').disabled = !ok2;
  document.getElementById('resc-sinsubir').disabled = !ok2;
}

function _fechaLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rescateDescargar() {
  if (!_rescate) return;
  const payload = { ..._paqueteRescate(), ts: new Date().toISOString(), v: '2.1', origen: 'rescate' };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = 'HDCredit_rescate_' + _fechaLocalISO() + '.json';
  a.click();
  _rescate.descargado = true;
  if (_rescate.key) {
    try {
      localStorage.setItem('hd_rescate_descargado', _rescate.key);
      const lista = _leerLS('hd_rescate_descargados');
      if (!lista.includes(_rescate.key)) { lista.push(_rescate.key); localStorage.setItem('hd_rescate_descargados', JSON.stringify(lista)); }
    } catch(e) { reportarError('Marcar copia de rescate como descargada', e); }
  }
  toast('Respaldo descargado. Confirma que lo guardaste para continuar.', 'ok');
  _rescateBotones();
}

// Comparación pura (sin red) — se exporta para las pruebas.
// ultimaSync: momento (ISO) de la última copia confirmada por la nube en
// este teléfono. Un acreditado que falta en la nube y ya existía antes de
// esa fecha probablemente lo BORRÓ otro teléfono: no se marca por defecto.
function compararLocalNube(local, nube, ultimaSync = null) {
  const nubeC = new Map(nube.clientes.map(c => [c.id, c]));
  const nubeH = new Set(nube.historial.map(h => h.id));
  const localC = new Map(local.clientes.filter(c => c && c.id).map(c => [c.id, c]));
  const acreditadosFaltantes = local.clientes.filter(c => c && c.id && !nubeC.has(c.id));
  const posiblesBorrados = acreditadosFaltantes
    .filter(c => !(ultimaSync && c.createdAt && String(c.createdAt) > String(ultimaSync)))
    .map(c => c.id);
  // Último movimiento de la nube por acreditado + quincena
  const ultimoNube = new Map();
  nube.historial.forEach(h => {
    if (!h || !Number.isInteger(h.qIndex)) return;
    const k = h.clienteId + '|' + h.qIndex, prev = ultimoNube.get(k);
    if (!prev || String(h.ts) > String(prev.ts)) ultimoNube.set(k, h);
  });
  const movimientos = [], noAplicables = [];
  local.historial.filter(h => h && h.id && !nubeH.has(h.id)).forEach(h => {
    if (!localC.has(h.clienteId) && !nubeC.has(h.clienteId)) { noAplicables.push({ h, motivo: 'el acreditado ya no existe' }); return; }
    if (!Number.isInteger(h.qIndex) || (h.accion !== 'PAGO' && h.accion !== 'REVERSO')) { noAplicables.push({ h, motivo: 'movimiento sin quincena o acción (revisar a mano)' }); return; }
    const u = ultimoNube.get(h.clienteId + '|' + h.qIndex);
    if (u && String(u.ts) > String(h.ts)) { noAplicables.push({ h, motivo: 'la nube tiene un cambio más reciente en esa quincena' }); return; }
    movimientos.push(h);
  });
  movimientos.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const conDiferencias = local.clientes.filter(c => c && nubeC.has(c.id)
    && JSON.stringify(c.pagos || []) !== JSON.stringify(nubeC.get(c.id).pagos || []));
  const soloEnNube = nube.clientes.filter(c => !localC.has(c.id));
  return { acreditadosFaltantes, posiblesBorrados, movimientos, noAplicables, conDiferencias, soloEnNube };
}

function _lista(items, fmt) {
  if (!items.length) return '';
  const max = 50;
  return '<ul>' + items.slice(0, max).map(x => `<li>${fmt(x)}</li>`).join('')
    + (items.length > max ? `<li>… y ${items.length - max} más</li>` : '') + '</ul>';
}

function _pintarComparacion(diff) {
  // Todo lo que viene de datos se escapa (incluido qIndex, que puede venir
  // de un respaldo o documento manipulado)
  const q = h => Number.isInteger(h.qIndex) ? 'Q' + (h.qIndex + 1) : 'Q?';
  const mov = h => `${esc(h.nombre || h.clienteId)} · ${q(h)} · ${esc(h.accion)} · ${esc(h.fecha || h.ts || '')}`;
  const borr = new Set(diff.posiblesBorrados || []);
  const nada = !diff.acreditadosFaltantes.length && !diff.movimientos.length;
  const chk = (attr, id, on, texto) =>
    `<label style="display:flex;gap:6px;align-items:flex-start;margin:3px 0"><input type="checkbox" ${attr}="${esc(id)}"${on ? ' checked' : ''}><span>${texto}</span></label>`;
  const cliHtml = diff.acreditadosFaltantes.map(c => chk('data-resc-cli', c.id, !borr.has(c.id),
    `${esc(c.nombre)} <span style="color:var(--muted)">(alta ${esc(String(c.createdAt || '—').slice(0, 10))})</span>`
    + (borr.has(c.id) ? ' <strong style="color:var(--warn)">⚠️ podría haberse borrado en otro teléfono — márcalo solo si es correcto</strong>' : ' · creado en este teléfono'))).join('');
  const movHtml = diff.movimientos.map(h => chk('data-resc-mov', h.id, !borr.has(h.clienteId), mov(h))).join('');
  document.getElementById('resc-comparacion').innerHTML = `
    ${nada ? '<p style="color:var(--accent);margin-bottom:8px">✅ Todo lo de este teléfono ya está en la nube.</p>' : ''}
    <div class="rsc-sec"><h4>Acreditados que faltan en la nube: ${diff.acreditadosFaltantes.length}</h4>${cliHtml}</div>
    <div class="rsc-sec"><h4>Cobros / reversos que faltan en la nube: ${diff.movimientos.length}</h4>${movHtml}</div>
    <div class="rsc-sec"><h4>Acreditados con pagos distintos (la nube NO se reemplaza): ${diff.conDiferencias.length}</h4>${_lista(diff.conDiferencias, c => esc(c.nombre))}</div>
    <div class="rsc-sec"><h4>Solo en la nube (no se tocan): ${diff.soloEnNube.length}</h4></div>
    ${(() => { const rv = _leerLS('hd_cola_fallidos'); return rv.length
      ? `<div class="rsc-sec"><h4>Cobros por revisar en este teléfono: ${rv.length}</h4><p style="color:var(--muted);font-size:.78rem">No se suben desde aquí; se revisan en "Cobros por revisar". Van incluidos en el respaldo.</p>${_lista(rv, it => mov(it.log || {}) + ' — ' + esc(it.motivo || ''))}</div>` : ''; })()}
    ${diff.noAplicables.length ? `<div class="rsc-sec"><h4>No se pueden subir automáticamente (quedan en la copia de rescate): ${diff.noAplicables.length}</h4>${_lista(diff.noAplicables, x => mov(x.h) + ' — ' + esc(x.motivo))}</div>` : ''}`;
  document.getElementById('resc-subir').innerHTML = nada
    ? '<i class="fas fa-check"></i> Nada que subir — continuar'
    : '<i class="fas fa-cloud-upload-alt"></i> Subir los marcados';
}

async function rescateComparar() {
  if (!_rescate) return;
  if (!(_rescate.descargado && document.getElementById('resc-check').checked)) {
    toast('Primero descarga el respaldo y confirma que lo guardaste', 'wrn'); return;
  }
  if (!navigator.onLine) { toast('Sin internet: todo se conserva en este teléfono', 'wrn'); return; }
  const btn = document.getElementById('resc-comparar');
  btn.disabled = true;
  const txt = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando…';
  try {
    const ok = await loadFirebaseSDK(_rescate.cfg, { rescate: true });
    if (!ok) throw new Error('No se pudo conectar con la nube');
    const [cs, hs] = await Promise.all([
      conTiempoLimite(CLI().get({ source: 'server' }), 30000, 'La nube no respondió (acreditados)'),
      conTiempoLimite(HIST().get({ source: 'server' }), 60000, 'La nube no respondió (historial)'),
    ]);
    _rescate.nube = {
      clientes: cs.docs.map(d => ({ id: d.id, ...d.data() })),
      historial: hs.docs.map(d => ({ id: d.id, ...d.data() })),
    };
    _rescate.local = _datosLocalesActuales();
    _rescate.diff = compararLocalNube(_rescate.local, _rescate.nube, localStorage.getItem('hd_ultima_sync'));
    _pintarComparacion(_rescate.diff);
    document.getElementById('resc-paso1').hidden = true;
    document.getElementById('resc-paso2').hidden = false;
    document.getElementById('resc-error').hidden = true;
    _rescateBotones();
  } catch(e) {
    USE_FB = false; // seguir en local: no se tocó nada
    reportarError('Rescate: comparar con la nube', e);
    toast('No se pudo comparar: ' + e.message + '. Todo se conserva en este teléfono.', 'err');
  } finally {
    btn.innerHTML = txt;
    _rescateBotones();
  }
}

// Sube lo faltante de UN acreditado en una transacción: si no existe en la
// nube se crea con lo local; si existe, cada movimiento se aplica como
// PAGO/REVERSO explícito sobre el dato de la nube (lo que ya está igual no
// se vuelve a escribir → sin duplicados).
// crearSiFalta: el usuario marcó este acreditado para crearlo en la nube.
// Si no lo marcó y no existe, no se revive (ni con sus movimientos).
async function _subirAcreditado(id, localCli, movsTodos, crearSiFalta) {
  return DB.runTransaction(async tx => {
    // Firestore exige leer todo antes de escribir
    const ref = CLI().doc(id);
    const snap = await tx.get(ref);
    const existentes = [];
    for (const h of movsTodos) existentes.push((await tx.get(HIST().doc(h.id))).exists);
    const res = { creado: 0, aplicados: 0, yaEstaban: 0, omitidos: 0, ids: [] };
    // Movimiento con el mismo id ya en la nube → no se duplica
    const movs = movsTodos.filter((h, i) => { if (existentes[i]) { res.yaEstaban++; res.ids.push(h.id); return false; } return true; });
    if (!snap.exists) {
      if (!localCli || !crearSiFalta) { res.omitidos += movs.length; return res; }
      tx.set(ref, { ...localCli, createdAt: localCli.createdAt || new Date().toISOString() });
      res.creado = 1;
      movs.forEach(h => { tx.set(HIST().doc(h.id), h); res.aplicados++; res.ids.push(h.id); });
      return res;
    }
    let estado = { ...snap.data(), id };
    let cambio = false;
    for (const h of movs) {
      let r = null;
      try { r = calcularCobro(estado, estado.pagos, h.qIndex, h.qKey, h.accion); }
      catch(e) { res.omitidos++; continue; }
      if (!r) { res.yaEstaban++; continue; } // la nube ya lo tiene así
      estado = { ...estado, pagos: r.pagos, pagadas: r.pagadas, saldo: r.saldo, alerta: r.alerta };
      tx.set(HIST().doc(h.id), h); // mismo id que en el teléfono: idempotente
      res.aplicados++;
      res.ids.push(h.id);
      cambio = true;
    }
    if (cambio) tx.set(ref, { pagos: estado.pagos, pagadas: estado.pagadas, saldo: estado.saldo, alerta: estado.alerta, updatedAt: new Date().toISOString() }, { merge: true });
    return res;
  });
}

async function rescateSubir() {
  if (!_rescate || !_rescate.diff) return;
  if (!document.getElementById('resc-check2').checked) { toast('Confirma que revisaste la comparación', 'wrn'); return; }
  if (!navigator.onLine) { toast('Sin internet: todo se conserva en este teléfono', 'wrn'); return; }
  const diff = _rescate.diff;
  const localC = new Map(_rescate.local.clientes.map(c => [c.id, c]));
  // Solo lo que el usuario dejó marcado
  const cliSel = new Set([...document.querySelectorAll('#resc-comparacion input[data-resc-cli]:checked')].map(i => i.getAttribute('data-resc-cli')));
  const movSel = new Set([...document.querySelectorAll('#resc-comparacion input[data-resc-mov]:checked')].map(i => i.getAttribute('data-resc-mov')));
  const movimientos = diff.movimientos.filter(h => movSel.has(h.id));
  const ids = new Set([...cliSel, ...movimientos.map(h => h.clienteId)]);
  const btn = document.getElementById('resc-subir');
  btn.disabled = true;
  const noMarcados = (diff.acreditadosFaltantes.length - cliSel.size) + (diff.movimientos.length - movimientos.length);
  const tot = { creados: 0, aplicados: 0, yaEstaban: 0, omitidos: diff.noAplicables.length + noMarcados, fallidos: 0 };
  for (const id of ids) {
    const movs = movimientos.filter(h => h.clienteId === id);
    try {
      const r = await conTiempoLimite(_subirAcreditado(id, localC.get(id), movs, cliSel.has(id)), 30000, 'La nube no confirmó a tiempo');
      tot.creados += r.creado; tot.aplicados += r.aplicados; tot.yaEstaban += r.yaEstaban; tot.omitidos += r.omitidos;
      // Movimientos que quedaron confirmados en la nube (subidos o ya con ese id)
      _rescate.subidos = _rescate.subidos || new Set();
      r.ids.forEach(x => _rescate.subidos.add(x));
    } catch(e) {
      tot.fallidos++;
      reportarError('Rescate: subir ' + ((localC.get(id) || {}).nombre || id), e);
    }
  }
  _rescateBotones();
  if (tot.fallidos) {
    const el = document.getElementById('resc-error');
    el.textContent = `⚠️ ${tot.fallidos} acreditados no se pudieron subir. Puedes reintentar (no se duplica nada) o seguir sin conectar. Ver panel de errores.`;
    el.hidden = false;
    toast('Rescate incompleto — nada se perdió, puedes reintentar', 'err');
    return;
  }
  document.getElementById('resc-resultado').textContent =
    `✅ Rescate completado\n\nAcreditados creados en la nube: ${tot.creados}\nMovimientos subidos: ${tot.aplicados}\n`
    + `Ya estaban en la nube (no se duplicaron): ${tot.yaEstaban}\nNo subidos (quedan en la copia de rescate): ${tot.omitidos}`;
  document.getElementById('resc-paso2').hidden = true;
  document.getElementById('resc-paso3').hidden = false;
}

// Termina el rescate y empieza a sincronizar. La copia de rescate NO se
// borra; solo se quita la marca de "pendiente".
function rescateTerminar() {
  if (!_rescate || !USE_FB) return;
  if (!document.getElementById('resc-paso3').hidden || document.getElementById('resc-check2').checked) {
    // La cola respeta lo decidido en el rescate: lo que ya quedó en la nube
    // sale de la cola; lo desmarcado o no aplicable NO se sube solo después:
    // pasa a "Cobros por revisar" (no se pierde).
    const subidos = _rescate.subidos || new Set();
    leerCola().forEach(it => {
      if (!subidos.has(it.log.id)) moverARevision(it, 'revision', 'No se subió en el rescate (desmarcado, no aplicable o la nube ya lo tenía): revisar');
    });
    guardarCola([]);
    localStorage.setItem('hd_fb', JSON.stringify(_rescate.cfg));
    localStorage.removeItem('hd_rescate_pendiente');
    localStorage.removeItem('hd_local_manual');
    localStorage.removeItem('hd_rescate_actual'); // solo el puntero; la copia se queda
    _modoLocalTemporal = false;
    const b = document.getElementById('banner-sinsync');
    if (b) b.hidden = true;
    cm('m-rescate');
    _rescate = null;
    setSyncLbl('ok');
    startFBSync();
    toast('Conectado a la nube ✅', 'ok');
  }
}

function rescateSeguirLocal() {
  USE_FB = false;
  _modoLocalTemporal = true;
  cm('m-rescate');
  loadLocal();
  setSyncLbl('sin-sync');
  mostrarBannerSinSync('rescate pendiente');
  toast('Todo se conserva en este teléfono. Toca "Reintentar" cuando tengas internet.', 'wrn');
}

/* ============================================================
   ESPACIO DEL TELÉFONO
   Las copias de rescate NUNCA se borran solas. Desde el panel de errores
   se pueden borrar a mano (con doble confirmación) SOLO las que ya se
   descargaron y que no son la copia del rescate en curso.
============================================================ */
function espacioUsadoKB() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } }
  catch(e) {}
  return Math.round(n * 2 / 1024); // UTF-16: ~2 bytes por carácter
}
function copiasBorrables() {
  const actual = localStorage.getItem('hd_rescate_actual');
  return _leerLS('hd_rescate_descargados').filter(k => k !== actual && localStorage.getItem(k) !== null);
}
function pintarEspacio() {
  const el = document.getElementById('esp-info');
  if (!el) return;
  const n = copiasBorrables().length;
  el.textContent = `Espacio usado en este teléfono: ~${espacioUsadoKB()} KB · Copias de rescate ya descargadas: ${n}`;
  const btn = document.getElementById('esp-borrar');
  if (btn) { btn.hidden = n === 0; btn.dataset.confirmar = ''; btn.textContent = `Borrar ${n} copia(s) ya descargada(s)`; }
}
function borrarCopiasDescargadas() {
  const btn = document.getElementById('esp-borrar');
  const borrables = copiasBorrables();
  if (!borrables.length) return 0;
  if (btn && btn.dataset.confirmar !== '1') {
    btn.dataset.confirmar = '1';
    btn.textContent = '¿Seguro? Toca otra vez para borrar (ya están descargadas)';
    return 0;
  }
  borrables.forEach(k => localStorage.removeItem(k));
  localStorage.setItem('hd_rescate_descargados', JSON.stringify(_leerLS('hd_rescate_descargados').filter(k => !borrables.includes(k))));
  toast(`Se borraron ${borrables.length} copia(s) de rescate ya descargadas`, 'ok');
  pintarEspacio();
  return borrables.length;
}

function reintentarConexion() {
  // Se reintenta con la MISMA configuración con la que arrancó la sesión
  // (en modo prueba nunca se cae a la configuración real por defecto)
  let cfg = _cfgNube;
  if (!cfg) {
    if (MODO_PRUEBA || !DEFAULT_FB_CONFIG) { toast('Sin configuración válida de la app: recarga la página.', 'err'); return; }
    cfg = DEFAULT_FB_CONFIG;
    const saved = localStorage.getItem('hd_fb');
    if (saved && saved !== 'local') { try { cfg = JSON.parse(saved); } catch(e) {} }
  }
  if (localStorage.getItem('hd_rescate_pendiente') === '1' && hayDatosLocales()) { iniciarRescate(cfg); return; }
  loadFirebaseSDK(cfg);
}
