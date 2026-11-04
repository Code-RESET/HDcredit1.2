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
  return { clientes: _leerLS('hd_c'), historial: _leerLS('hd_h') };
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
      localStorage.setItem(key, JSON.stringify({ ...local, ts: new Date().toISOString(), v: '2.1', origen: 'rescate' }));
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
  const local = _datosLocalesActuales();
  const payload = { ...local, ts: new Date().toISOString(), v: '2.1', origen: 'rescate' };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = 'HDCredit_rescate_' + _fechaLocalISO() + '.json';
  a.click();
  _rescate.descargado = true;
  if (_rescate.key) { try { localStorage.setItem('hd_rescate_descargado', _rescate.key); } catch(e) {} }
  toast('Respaldo descargado. Confirma que lo guardaste para continuar.', 'ok');
  _rescateBotones();
}

// Comparación pura (sin red) — se exporta para las pruebas
function compararLocalNube(local, nube) {
  const nubeC = new Map(nube.clientes.map(c => [c.id, c]));
  const nubeH = new Set(nube.historial.map(h => h.id));
  const localC = new Map(local.clientes.filter(c => c && c.id).map(c => [c.id, c]));
  const acreditadosFaltantes = local.clientes.filter(c => c && c.id && !nubeC.has(c.id));
  const movimientos = [], noAplicables = [];
  local.historial.filter(h => h && h.id && !nubeH.has(h.id)).forEach(h => {
    if (!localC.has(h.clienteId) && !nubeC.has(h.clienteId)) noAplicables.push({ h, motivo: 'el acreditado ya no existe' });
    else if (!Number.isInteger(h.qIndex) || (h.accion !== 'PAGO' && h.accion !== 'REVERSO')) noAplicables.push({ h, motivo: 'movimiento sin quincena o acción' });
    else movimientos.push(h);
  });
  movimientos.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const conDiferencias = local.clientes.filter(c => c && nubeC.has(c.id)
    && JSON.stringify(c.pagos || []) !== JSON.stringify(nubeC.get(c.id).pagos || []));
  const soloEnNube = nube.clientes.filter(c => !localC.has(c.id));
  return { acreditadosFaltantes, movimientos, noAplicables, conDiferencias, soloEnNube };
}

function _lista(items, fmt) {
  if (!items.length) return '';
  const max = 50;
  return '<ul>' + items.slice(0, max).map(x => `<li>${fmt(x)}</li>`).join('')
    + (items.length > max ? `<li>… y ${items.length - max} más</li>` : '') + '</ul>';
}

function _pintarComparacion(diff) {
  const mov = h => `${esc(h.nombre || h.clienteId)} · Q${(h.qIndex ?? 0) + 1} · ${esc(h.accion)} · ${esc(h.fecha || h.ts || '')}`;
  const nada = !diff.acreditadosFaltantes.length && !diff.movimientos.length;
  document.getElementById('resc-comparacion').innerHTML = `
    ${nada ? '<p style="color:var(--accent);margin-bottom:8px">✅ Todo lo de este teléfono ya está en la nube.</p>' : ''}
    <div class="rsc-sec"><h4>Acreditados que faltan en la nube: ${diff.acreditadosFaltantes.length}</h4>${_lista(diff.acreditadosFaltantes, c => esc(c.nombre))}</div>
    <div class="rsc-sec"><h4>Cobros / reversos que faltan en la nube: ${diff.movimientos.length}</h4>${_lista(diff.movimientos, mov)}</div>
    <div class="rsc-sec"><h4>Acreditados con pagos distintos (la nube NO se reemplaza): ${diff.conDiferencias.length}</h4>${_lista(diff.conDiferencias, c => esc(c.nombre))}</div>
    <div class="rsc-sec"><h4>Solo en la nube (no se tocan): ${diff.soloEnNube.length}</h4></div>
    ${diff.noAplicables.length ? `<div class="rsc-sec"><h4>No se pueden subir automáticamente (quedan en la copia de rescate): ${diff.noAplicables.length}</h4>${_lista(diff.noAplicables, x => mov(x.h) + ' — ' + esc(x.motivo))}</div>` : ''}`;
  document.getElementById('resc-subir').innerHTML = nada
    ? '<i class="fas fa-check"></i> Nada que subir — continuar'
    : `<i class="fas fa-cloud-upload-alt"></i> Subir ${diff.acreditadosFaltantes.length} acreditados y ${diff.movimientos.length} movimientos`;
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
    _rescate.diff = compararLocalNube(_rescate.local, _rescate.nube);
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
async function _subirAcreditado(id, localCli, movs) {
  return DB.runTransaction(async tx => {
    const ref = CLI().doc(id);
    const snap = await tx.get(ref);
    const res = { creado: 0, aplicados: 0, yaEstaban: 0, omitidos: 0 };
    if (!snap.exists) {
      if (!localCli) { res.omitidos += movs.length; return res; }
      tx.set(ref, { ...localCli, createdAt: localCli.createdAt || new Date().toISOString() });
      res.creado = 1;
      movs.forEach(h => { tx.set(HIST().doc(h.id), h); res.aplicados++; });
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
  const ids = new Set([...diff.acreditadosFaltantes.map(c => c.id), ...diff.movimientos.map(h => h.clienteId)]);
  const btn = document.getElementById('resc-subir');
  btn.disabled = true;
  const tot = { creados: 0, aplicados: 0, yaEstaban: 0, omitidos: diff.noAplicables.length, fallidos: 0 };
  for (const id of ids) {
    const movs = diff.movimientos.filter(h => h.clienteId === id);
    try {
      const r = await conTiempoLimite(_subirAcreditado(id, localC.get(id), movs), 30000, 'La nube no confirmó a tiempo');
      tot.creados += r.creado; tot.aplicados += r.aplicados; tot.yaEstaban += r.yaEstaban; tot.omitidos += r.omitidos;
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

function reintentarConexion() {
  let cfg = DEFAULT_FB_CONFIG;
  const saved = localStorage.getItem('hd_fb');
  if (saved && saved !== 'local') { try { cfg = JSON.parse(saved); } catch(e) {} }
  if (localStorage.getItem('hd_rescate_pendiente') === '1' && hayDatosLocales()) { iniciarRescate(cfg); return; }
  loadFirebaseSDK(cfg);
}
