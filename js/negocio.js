/* ============================================================
   QUINCENA UTILS
============================================================ */
function getQuincenas(n) {
  const qs = [];
  const now = new Date();
  let y = now.getFullYear(), mo = now.getMonth();
  let d = now.getDate() <= 15 ? 15 : new Date(y, mo+1, 0).getDate();
  for (let i = 0; i < n; i++) {
    qs.unshift({ label: fmtQ(y, mo, d), key: `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` });
    if (d === 15) { d = new Date(y, mo, 0).getDate(); mo--; if (mo<0){mo=11;y--;} }
    else d = 15;
  }
  return qs;
}
function fmtQ(y, m, d) {
  const M = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${d===15?'1ª':'2ª'} Q · ${M[m]} ${y}`;
}
// Etiqueta larga para el Reporte de Cartera Activa, ej. "Primera de Agosto 2026"
function labelQuincenaLarga(qKey) {
  const [y, m, d] = qKey.split('-').map(Number);
  const M = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${d === 15 ? 'Primera' : 'Segunda'} de ${M[m - 1]} ${y}`;
}
function curQKey() {
  const n = new Date(), y = n.getFullYear(), mo = n.getMonth();
  const d = n.getDate()<=15?15:new Date(y,mo+1,0).getDate();
  return `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/* ============================================================
   ATRASADO — cálculo real por fechas
============================================================ */
// Cierre de "segunda quincena" de un mes: día 30 fijo, salvo febrero
// (que no tiene día 30) donde cae en su último día real (28 o 29).
function finQuincena(y, m) {
  const ultimoDia = new Date(y, m + 1, 0).getDate();
  return Math.min(30, ultimoDia);
}
// Menor vencimiento (día 15 o 30) estrictamente posterior a d.
// Si d cae justo en un vencimiento (15 o 30), salta al siguiente
// — el día en que arranca o se paga una quincena no vuelve a vencer ese mismo día.
function nextQBoundary(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (day < 15) return new Date(y, m, 15);
  const fin = finQuincena(y, m);
  if (day < fin) return new Date(y, m, fin);
  return new Date(y, m + 1, 15);
}
// Fecha sin hora (00:00 local) — los vencimientos se comparan por día de
// calendario, no por hora, para que la regla "atrasado desde el día
// siguiente" no dependa de la hora en que se abre la app.
function soloFecha(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
// Primer instante en que un vencimiento ya cuenta como ATRASADO:
// el día del vencimiento todavía NO es atraso; se marca desde el día siguiente.
function inicioAtraso(due) { const f = soloFecha(due); f.setDate(f.getDate() + 1); return f; }
// Días de atraso de un vencimiento (día siguiente al vencimiento = 1 día)
function diasDeAtraso(due, hoy = new Date()) {
  const a = soloFecha(due), b = soloFecha(hoy);
  const dias = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  return Math.max(0, dias);
}

function qsElapsed(inicio, producto = 'quincenal_fijo') {
  if (!inicio) return 0;
  const start = new Date(inicio + 'T12:00:00');
  const now   = new Date();
  if (start >= now) return 0;
  if (producto === 'unico_30d') {
    // Pago único: vence a los 30 días naturales del inicio, sin alinearse a quincenas
    const due = new Date(start);
    due.setDate(due.getDate() + 30);
    return now >= inicioAtraso(due) ? 1 : 0;
  }
  // Sin quincena de gracia: el primer pago vence en el primer día 15/30
  // posterior al inicio, y de ahí en adelante siempre los días 15 y 30.
  // Una quincena cuenta como vencida (exigible) a partir del día SIGUIENTE
  // a su vencimiento.
  let d = nextQBoundary(start);
  let count = 0;
  while (inicioAtraso(d) <= now && count < 36) {
    count++;
    d = nextQBoundary(d);
  }
  return count;
}

function calcAlerta(c) {
  if (!c || !c.nq || c.saldo === 0 || (c.pagadas||0) >= c.nq) return '';
  if (!c.inicio) return '';
  const expected = Math.min(qsElapsed(c.inicio, c.producto), c.nq);
  return (c.pagadas||0) < expected ? 'ATRASADO' : '';
}

/* ============================================================
   RESPALDO AUTOMÁTICO (últimas 2 sesiones)
============================================================ */
function autoBackup() {
  if (!clientes.length) return;
  try {
    localStorage.setItem('hd_bk_1', localStorage.getItem('hd_bk_0') || '');
    localStorage.setItem('hd_bk_0', JSON.stringify({ clientes, historial, ts: new Date().toISOString() }));
  } catch(e) { reportarError('Respaldo automático', e); }
}

/* ============================================================
   ESCRITURAS CON COLA OFFLINE
   Firestore aplica la escritura en la copia local al instante y la sube
   cuando hay señal, pero la promesa de commit() no se resuelve hasta que
   el servidor confirma. Esperarla sin conexión deja la pantalla trabada.
   Aquí se espera un poco: si el servidor confirma → 'ok'; si rechaza →
   lanza el error; si no contesta a tiempo → 'pendiente' (queda en cola) y
   un fallo posterior se registra en el panel de errores.
============================================================ */
function esperarEscritura(promesa, origen, ms = 4000) {
  return new Promise((resolve, reject) => {
    let listo = false;
    const t = setTimeout(() => { if (!listo) { listo = true; resolve('pendiente'); } }, ms);
    promesa.then(
      () => { if (!listo) { listo = true; clearTimeout(t); resolve('ok'); } },
      e => {
        if (!listo) { listo = true; clearTimeout(t); reject(e); }
        else { reportarError(origen + ' (al subir a la nube)', e); toast('❌ ' + origen + ': no se pudo subir a la nube — revisa el panel de errores', 'err'); }
      }
    );
  });
}

/* ============================================================
   CRUD
============================================================ */
function onProductoChange() {
  const producto = document.getElementById('f-producto').value;
  const montoSel = document.getElementById('f-monto');
  const montoActual = montoSel.value;
  const montos = producto === 'unico_30d'
    ? [1000,2000,3000,4000,5000,6000,7000,8000,9000,10000]
    : [1000,2000,3000,4000,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000];
  montoSel.innerHTML = '<option value="">Seleccionar...</option>'
    + montos.map(m => `<option>${m}</option>`).join('');
  if (montos.includes(parseInt(montoActual))) montoSel.value = montoActual;

  document.getElementById('fg-plazo').style.display = producto === 'unico_30d' ? 'none' : '';
  document.getElementById('lbl-pq').textContent = producto === 'unico_30d' ? 'Total a Pagar (30 días)' : 'Pago Quincenal';
  document.getElementById('lbl-pag').textContent = producto === 'unico_30d' ? '¿Ya pagado? (0 o 1)' : 'Q ya Pagadas';
  calcPQ();
}

// Id del acreditado nuevo: se genera UNA vez al abrir el formulario, así que
// tocar "Guardar" varias veces escribe siempre el mismo documento (no crea
// copias del mismo préstamo).
let _nuevoIdPendiente = null, _guardandoCliente = false;
function nuevoIdCliente() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function openNew() {
  _nuevoIdPendiente = nuevoIdCliente();
  document.getElementById('eid').value = '';
  document.getElementById('m-title').textContent = 'Nuevo Acreditado';
  ['f-nom','f-tel','f-notas'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-producto').value = 'quincenal_fijo';
  document.getElementById('f-monto').value = '';
  document.getElementById('f-plazo').value = '';
  document.getElementById('f-pq').value = '';
  document.getElementById('f-ini').value = new Date().toISOString().split('T')[0];
  document.getElementById('f-pag').value = '0';
  onProductoChange();
  om('m-cliente');
}

function editC(id) {
  const c = clientes.find(x=>x.id===id); if(!c) return;
  document.getElementById('eid').value = id;
  document.getElementById('m-title').textContent = 'Editar Acreditado';
  document.getElementById('f-nom').value = c.nombre;
  document.getElementById('f-producto').value = c.producto || 'quincenal_fijo';
  onProductoChange();
  document.getElementById('f-monto').value = c.monto;
  document.getElementById('f-plazo').value = c.nq;
  document.getElementById('f-pq').value = '$' + (c.pq||0).toLocaleString('es-MX');
  document.getElementById('f-ini').value = c.inicio||'';
  document.getElementById('f-pag').value = c.pagadas||0;
  document.getElementById('f-tel').value = c.telefono||'';
  document.getElementById('f-notas').value = c.notas||'';
  om('m-cliente');
}

function calcPQ() {
  const producto = document.getElementById('f-producto').value;
  const m = parseInt(document.getElementById('f-monto').value)||0;
  const pq = document.getElementById('f-pq');
  if (producto === 'unico_30d') {
    if (!m) { pq.value = ''; return; }
    if (!TF30[m]) { pq.value = 'Monto no válido'; return; }
    pq.value = '$' + TF30[m].toLocaleString('es-MX');
    return;
  }
  const p = parseInt(document.getElementById('f-plazo').value)||0;
  if (m && p) {
    if (!TF[m]) { pq.value = 'Monto no válido'; return; }
    if (!TF[m][p]) { pq.value = 'No aplica'; return; }
    pq.value = '$' + TF[m][p].toLocaleString('es-MX');
  } else pq.value = '';
}

async function saveC() {
  // Bloqueo: mientras se guarda, más toques a "Guardar" no hacen nada
  if (_guardandoCliente) return;
  const btn = document.getElementById('btn-save-c');
  _guardandoCliente = true;
  if (btn) btn.disabled = true;
  try { await _saveC(); }
  catch(e) { reportarError('Guardar acreditado', e); toast('❌ Error al guardar: ' + e.message, 'err'); }
  finally { _guardandoCliente = false; if (btn) btn.disabled = false; }
}

async function _saveC() {
  const nombre = document.getElementById('f-nom').value.trim();
  const producto = document.getElementById('f-producto').value || 'quincenal_fijo';
  const monto = parseInt(document.getElementById('f-monto').value)||0;
  const nq = producto === 'unico_30d' ? 1 : (parseInt(document.getElementById('f-plazo').value)||0);
  const inicio = document.getElementById('f-ini').value;
  const pagadasRaw = parseInt(document.getElementById('f-pag').value)||0;
  const telefono = document.getElementById('f-tel').value.replace(/\D/g,'').slice(0,10);
  const notas = document.getElementById('f-notas').value.trim();
  const eid = document.getElementById('eid').value;

  if (!nombre || !monto || !nq) { toast('Completa los campos requeridos', 'wrn'); return; }
  if (pagadasRaw < 0) { toast('Las quincenas pagadas no pueden ser negativas', 'err'); return; }
  const pagadas = Math.min(pagadasRaw, nq);
  let pq;
  if (producto === 'unico_30d') {
    if (!TF30[monto]) { toast('Monto no válido para Préstamo 30 Días', 'err'); return; }
    pq = TF30[monto];
  } else {
    if (!TF[monto] || !TF[monto][nq]) { toast('Combinación monto/plazo no válida', 'err'); return; }
    pq = TF[monto][nq];
  }
  if (!inicio && !eid) toast('⚠️ Sin fecha de inicio: no se podrán detectar atrasos automáticamente', 'wrn');

  const saldo = Math.max(0, (nq - pagadas) * pq);
  // Al editar: preservar el array pagos si el plazo y las quincenas pagadas no cambiaron
  // (evita destruir el patrón de pagos individuales generado por reversiones)
  let pagos;
  if (eid) {
    const existing = clientes.find(x=>x.id===eid);
    if (existing && existing.nq === nq && existing.pagadas === pagadas && Array.isArray(existing.pagos)) {
      pagos = existing.pagos.slice(0, nq);
      while (pagos.length < nq) pagos.push(false);
    } else {
      pagos = Array(nq).fill(false).map((_,i) => i < pagadas);
    }
  } else {
    pagos = Array(nq).fill(false).map((_,i) => i < pagadas);
  }
  const data = { nombre, producto, monto, pq, nq, inicio, pagadas, saldo, pagos, telefono, notas,
    alerta: calcAlerta({saldo, pagadas, nq, inicio, producto}), updatedAt: new Date().toISOString() };

  let estado = 'ok';
  if (eid) {
    if (USE_FB) {
      try { estado = await esperarEscritura(CLI().doc(eid).set(data, {merge:true}), 'Guardar acreditado'); }
      catch(e) { reportarError('Guardar acreditado', e); toast('No se pudo guardar en la nube: ' + e.message, 'err'); return; }
    } else { const i = clientes.findIndex(x=>x.id===eid); if(i>=0) clientes[i]={...clientes[i],...data}; saveLocal(); refresh(); }
    toast(estado === 'pendiente' ? `${nombre} actualizado — pendiente de subir a la nube` : `${nombre} actualizado`, estado === 'pendiente' ? 'wrn' : 'ok');
  } else {
    // Mismo id para todos los intentos de este formulario (ver openNew)
    const id = _nuevoIdPendiente || (_nuevoIdPendiente = nuevoIdCliente());
    data.id = id; data.createdAt = new Date().toISOString();
    if (USE_FB) {
      try { estado = await esperarEscritura(CLI().doc(id).set(data), 'Guardar acreditado'); }
      catch(e) { reportarError('Guardar acreditado', e); toast('No se pudo guardar en la nube: ' + e.message, 'err'); return; }
    } else {
      const i = clientes.findIndex(x => x.id === id);
      if (i >= 0) clientes[i] = data; else clientes.push(data);
      saveLocal(); refresh();
    }
    _nuevoIdPendiente = null;
    toast(estado === 'pendiente' ? `${nombre} agregado — pendiente de subir a la nube` : `${nombre} agregado ✅`, estado === 'pendiente' ? 'wrn' : 'ok');
  }
  cm('m-cliente');
}

function confirmDel(id) {
  const c = clientes.find(x=>x.id===id); if(!c) return;
  document.getElementById('conf-msg').textContent = `¿Eliminar a ${c.nombre}? Esta acción no se puede deshacer.`;
  document.getElementById('conf-ok').onclick = () => delC(id);
  om('m-confirm');
}

async function delC(id) {
  if (USE_FB) {
    try {
      await CLI().doc(id).delete();
    } catch(e) {
      toast('No se pudo eliminar en la nube: ' + e.message, 'err');
      return;
    }
    // Limpiar historial huérfano en Firestore (best-effort: el cliente ya se eliminó)
    try {
      const snap = await HIST().where('clienteId', '==', id).get();
      if (snap.docs.length) {
        const batch = DB.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch(e) {
      console.error('HD Crédit — no se pudo limpiar historial huérfano:', e);
      toast('⚠️ Cliente eliminado, pero no se pudo limpiar su historial — revisa Firestore', 'wrn');
    }
  } else {
    clientes = clientes.filter(x=>x.id!==id);
    historial = historial.filter(h=>h.clienteId!==id);
    saveLocal(); refresh();
  }
  cm('m-confirm');
  toast('Acreditado eliminado', 'wrn');
}

/* ============================================================
   REGISTRAR COBRO / REVERSO
   El botón dice qué quiere hacer ('PAGO' o 'REVERSO'); ya no "invierte"
   el estado. Si la quincena ya está en ese estado (otro dispositivo la
   cobró, o se tocó dos veces), no se escribe nada: un segundo cobro nunca
   anula al primero.
============================================================ */
const _cobrosEnCurso = new Set();
function cobroEnCurso(cid) { return _cobrosEnCurso.has(cid); }

// Calcula el nuevo estado a partir del arreglo de pagos más reciente
// conocido. Devuelve null si no hay nada que cambiar.
function calcularCobro(c, pagosBase, qIdx, qKey, accion) {
  if (accion !== 'PAGO' && accion !== 'REVERSO') throw new Error('Acción de cobro inválida: ' + accion);
  const nq = c.nq || 12;
  if (!Number.isInteger(qIdx) || qIdx < 0 || qIdx >= nq) throw new Error('Quincena fuera de rango: ' + qIdx);
  const pagos = Array.isArray(pagosBase)
    ? [...pagosBase]
    : Array(nq).fill(false).map((_, j) => j < (c.pagadas || 0));
  while (pagos.length < nq) pagos.push(false);
  const deseado = accion === 'PAGO';
  if (!!pagos[qIdx] === deseado) return null; // ya estaba así — no tocar
  pagos[qIdx] = deseado;
  const pagadas = pagos.filter(Boolean).length;
  const saldo = Math.max(0, (c.nq - pagadas) * c.pq);
  const alerta = calcAlerta({...c, pagadas, saldo});
  const now = new Date();
  const log = {
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    clienteId: c.id, nombre: c.nombre,
    monto: c.pq, qIndex: qIdx, qKey,
    accion,
    fecha: now.toLocaleDateString('es-MX'),
    hora: now.toLocaleTimeString('es-MX'),
    ts: now.toISOString()
  };
  return { pagos, pagadas, saldo, alerta, log, now };
}

function camposCliente(r) {
  return { pagos: r.pagos, pagadas: r.pagadas, saldo: r.saldo, alerta: r.alerta, updatedAt: r.now.toISOString() };
}

// Refleja el cobro en memoria al instante (en modo Firebase el siguiente
// snapshot trae lo mismo y lo reemplaza).
function aplicarCobroEnMemoria(cid, r) {
  const i = clientes.findIndex(x => x.id === cid);
  if (i >= 0) clientes[i] = {...clientes[i], pagos: r.pagos, pagadas: r.pagadas, saldo: r.saldo, alerta: r.alerta};
  if (!historial.some(h => h.id === r.log.id)) historial.unshift(r.log);
}

// opts: { qKey, sinDeshacer, silencioso }
// Devuelve { ok:true, estado:'ok'|'pendiente', accion } o
//          { ok:false, motivo:'sin_cambio'|'ocupado'|'no_existe'|'error' }
async function registrarCobro(cid, qIdx, accion, opts = {}) {
  const c = clientes.find(x => x.id === cid);
  if (!c) { toast('Acreditado no encontrado', 'err'); return { ok:false, motivo:'no_existe' }; }
  // Bloqueo: mientras un movimiento de este acreditado está en proceso,
  // no se acepta otro (evita cobros dobles por toques rápidos)
  if (_cobrosEnCurso.has(cid)) {
    toast(`Espera: hay un movimiento de ${c.nombre} en proceso`, 'wrn');
    return { ok:false, motivo:'ocupado' };
  }
  _cobrosEnCurso.add(cid);
  renderCL(); // muestra el botón bloqueado
  try {
    return await _registrarCobro(c, cid, qIdx, accion, opts);
  } catch(e) {
    reportarError('Registrar ' + accion, e);
    toast('❌ No se pudo registrar el movimiento: ' + e.message, 'err');
    return { ok:false, motivo:'error', error:e };
  } finally {
    _cobrosEnCurso.delete(cid);
    renderCL();
    renderDash();
  }
}

async function _registrarCobro(c, cid, qIdx, accion, opts) {
  const qKey = opts.qKey || document.getElementById('qsel').value;
  let r = null, estado = 'ok';

  if (USE_FB) {
    let hecho = false;
    // Con red: transacción real — relee el acreditado en el servidor, así
    // la decisión "ya estaba cobrado" se toma con el dato más reciente.
    if (navigator.onLine) {
      try {
        r = await DB.runTransaction(async (tx) => {
          const ref = CLI().doc(cid);
          const snap = await tx.get(ref);
          if (!snap.exists) { const err = new Error('El acreditado ya no existe en la nube'); err.code = 'hd/no-existe'; throw err; }
          const fresh = {...c, ...snap.data(), id: cid};
          const res = calcularCobro(fresh, fresh.pagos, qIdx, qKey, accion);
          if (!res) return null;
          tx.set(ref, camposCliente(res), {merge:true});
          tx.set(HIST().doc(res.log.id), res.log);
          return res;
        });
        hecho = true;
      } catch(e) {
        if (e.code === 'hd/no-existe') throw e;
        console.warn('HD Crédit — transacción de cobro falló, se usa escritura en lote:', e.code || e.message);
      }
    }
    // Sin red (o la transacción falló): UN SOLO lote atómico con acreditado
    // + historial. Firestore lo guarda en la cola offline y lo sube completo
    // o nada. Se usa la copia local más reciente (incluye los cambios
    // pendientes de este teléfono).
    if (!hecho) {
      r = calcularCobro(c, c.pagos, qIdx, qKey, accion);
      if (r) {
        const batch = DB.batch();
        batch.set(CLI().doc(cid), camposCliente(r), {merge:true});
        batch.set(HIST().doc(r.log.id), r.log);
        estado = await esperarEscritura(batch.commit(), 'Registrar ' + accion);
      }
    }
    if (r) aplicarCobroEnMemoria(cid, r);
  } else {
    r = calcularCobro(c, c.pagos, qIdx, qKey, accion);
    if (r) { aplicarCobroEnMemoria(cid, r); saveLocal(); }
  }

  if (!r) {
    if (!opts.silencioso) {
      toast(accion === 'PAGO'
        ? `${c.nombre}: esa quincena ya estaba cobrada — no se cobró otra vez`
        : `${c.nombre}: esa quincena ya no estaba pagada`, 'wrn');
    }
    return { ok:false, motivo:'sin_cambio' };
  }

  if (!opts.silencioso) {
    const pend = estado === 'pendiente' ? ' (pendiente de subir)' : '';
    toast(accion === 'PAGO'
      ? `✅ Pago — ${c.nombre} $${c.pq.toLocaleString('es-MX')}${pend}`
      : `↩️ Revertido — ${c.nombre}${pend}`, accion === 'PAGO' ? 'ok' : 'wrn');
  }
  if (!opts.sinDeshacer) { _lastPago = { cid, qIdx, accion, qKey }; showUndo(c.nombre, accion === 'PAGO'); }
  return { ok:true, estado, accion };
}

/* ============================================================
   RETROCEDER PAGO
============================================================ */
function openReverso(id) {
  const c = clientes.find(x => x.id === id); if (!c) return;
  const pagos = c.pagos || Array(c.nq).fill(false);
  const pagadas = pagos.map((p, i) => p ? i : -1).filter(i => i >= 0);
  if (!pagadas.length) { toast('Este acreditado no tiene pagos registrados', 'wrn'); return; }

  const revOk = document.getElementById('rev-ok');
  revOk.style.opacity = '.45';
  revOk.style.pointerEvents = 'none';

  document.getElementById('rev-body').innerHTML = `
    <p style="color:var(--muted);font-size:.84rem;margin-bottom:14px">
      Selecciona la quincena a revertir de <strong>${esc(c.nombre)}</strong>:
    </p>
    ${pagadas.map(i => {
      const dueDate = getQDueDate(c.inicio, i, c.producto);
      const dueLbl = dueDate
        ? dueDate.toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'2-digit'})
        : '—';
      return `<div class="rev-item" onclick="selReverso('${c.id}',${i},this)">
        <div>
          <div style="font-weight:700;font-size:.87rem">Quincena ${i + 1}</div>
          <div style="font-size:.73rem;color:var(--muted);font-family:'DM Mono',monospace">Vto. ${dueLbl}</div>
        </div>
        <span style="font-family:'DM Mono',monospace;color:var(--accent)">$${c.pq.toLocaleString('es-MX')}</span>
        <i class="fas fa-chevron-right" style="color:var(--muted);font-size:.8rem"></i>
      </div>`;
    }).join('')}`;

  om('m-reverso');
}

function selReverso(cid, qIdx, el) {
  document.querySelectorAll('#m-reverso .rev-item').forEach(x => x.classList.remove('rev-sel'));
  el.classList.add('rev-sel');
  const revOk = document.getElementById('rev-ok');
  revOk.style.opacity = '1';
  revOk.style.pointerEvents = 'auto';
  revOk.onclick = () => doReverso(cid, qIdx);
}

async function doReverso(cid, qIdx) {
  cm('m-reverso');
  // La verificación "ya no está pagada" la hace registrarCobro con el dato
  // más reciente (dentro de la transacción si hay red)
  return registrarCobro(cid, qIdx, 'REVERSO', { sinDeshacer: true });
}

