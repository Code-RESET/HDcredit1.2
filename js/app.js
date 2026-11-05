/* ============================================================
   MOROSOS Y RECARGOS
============================================================ */
function getQDueDate(inicio, periodIdx, producto = 'quincenal_fijo') {
  if (!inicio) return null;
  const start = new Date(inicio + 'T12:00:00');
  if (producto === 'unico_30d') {
    // Pago único: siempre el mismo vencimiento, 30 días naturales después del inicio
    const due = new Date(start);
    due.setDate(due.getDate() + 30);
    return due;
  }
  // Sin quincena de gracia: el primer pago vence en el primer día 15/30
  // posterior al inicio, y de ahí en adelante siempre los días 15 y 30.
  let d = nextQBoundary(start);
  for (let i = 0; i < periodIdx; i++) d = nextQBoundary(d);
  return d;
}

function calcRecargoPorCliente(c) {
  if (!c || !c.inicio || calcAlerta(c) !== 'ATRASADO') return { periodos: [], total: 0 };
  const producto = c.producto || 'quincenal_fijo';
  const porDia = RECARGO_DIA[producto] ?? 50;
  const elapsed = Math.min(qsElapsed(c.inicio, producto), c.nq);
  const atrasadas = elapsed - c.pagadas;
  if (atrasadas <= 0) return { periodos: [], total: 0 };
  const today = new Date();
  const periodos = [];
  for (let i = c.pagadas; i < elapsed; i++) {
    const dueDate = getQDueDate(c.inicio, i, producto);
    if (!dueDate) continue;
    // Días de calendario desde el vencimiento: el día del vencimiento = 0
    // (no atrasado), el día siguiente = 1 día de recargo, y así.
    const diasAtraso = diasDeAtraso(dueDate, today);
    periodos.push({ idx: i + 1, dueDate, diasAtraso, recargo: diasAtraso * porDia });
  }
  return { periodos, total: periodos.reduce((a, p) => a + p.recargo, 0) };
}

/* ============================================================
   RESUMEN DE CLIENTE — cálculo único de saldo/atraso/recargo,
   usado por Reporte Personal y Estado de Cuenta (antes cada uno
   recalculaba el saldo por separado y podían mostrar cifras distintas)
============================================================ */
function resumenCliente(c) {
  const elapsed = Math.min(qsElapsed(c.inicio, c.producto), c.nq);
  const atrasadas = Math.max(0, elapsed - c.pagadas);
  const capitalAt = atrasadas * c.pq;
  const faltantes = c.nq - c.pagadas;
  const saldo = faltantes * c.pq;
  const rec = calcRecargoPorCliente(c);
  const totalCobrar = capitalAt + rec.total;
  const esAtrasado = calcAlerta(c) === 'ATRASADO';
  const esLiquidado = saldo === 0;
  return { elapsed, atrasadas, capitalAt, faltantes, saldo, rec, totalCobrar, esAtrasado, esLiquidado };
}

// Etiqueta de plazo/periodos legible según producto — evita mostrar "1Q"
// en un préstamo de pago único a 30 días
function plazoLabel(c) {
  return c.producto === 'unico_30d' ? 'Pago único' : `${c.nq}Q`;
}
function periodosLabel(n, c) {
  return c.producto === 'unico_30d' ? (n > 0 ? 'Vencido' : 'Al corriente') : `${n}Q`;
}

function switchMorososTab(tab) {
  document.querySelectorAll('#v-morosos .tab-btn').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  document.querySelectorAll('#v-morosos .tab-panel').forEach(p => p.classList.toggle('on', p.id === 'mp-' + tab));
}

function renderMorosos() {
  const morosos = clientes.filter(c => calcAlerta(c) === 'ATRASADO' && (c.saldo||0) > 0);

  const nbMor = document.getElementById('nb-mor');
  if (nbMor) { nbMor.textContent = morosos.length; nbMor.style.display = morosos.length ? '' : 'none'; }

  const totalCapital = morosos.reduce((a, c) => {
    const elapsed = Math.min(qsElapsed(c.inicio||'', c.producto), c.nq||0);
    return a + Math.max(0, elapsed - (c.pagadas||0)) * (c.pq||0);
  }, 0);
  const totalRecargos = morosos.reduce((a, c) => a + calcRecargoPorCliente(c).total, 0);

  const elMrCount = document.getElementById('mr-count');
  if (elMrCount) {
    set('mr-count', morosos.length);
    set('mr-capital', '$' + totalCapital.toLocaleString('es-MX'));
    set('mr-recargos', '$' + totalRecargos.toLocaleString('es-MX'));
    set('mr-total', '$' + (totalCapital + totalRecargos).toLocaleString('es-MX'));
  }

  const tb1 = document.getElementById('tb-at');
  if (tb1) {
    tb1.innerHTML = !morosos.length
      ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted)">✅ Sin pagos atrasados</td></tr>'
      : morosos.map(c => {
          const elapsed = Math.min(qsElapsed(c.inicio, c.producto), c.nq);
          const atrasadas = Math.max(0, elapsed - c.pagadas);
          const capitalAt = atrasadas * c.pq;
          const firstDue = c.pagadas < elapsed ? getQDueDate(c.inicio, c.pagadas, c.producto) : null;
          const firstDueLbl = firstDue
            ? firstDue.toLocaleDateString('es-MX', {day:'2-digit',month:'short',year:'2-digit'})
            : '—';
          return `<tr>
            <td><strong>${esc(c.nombre)}</strong></td>
            <td><span class="badge br">${periodosLabel(atrasadas, c)}</span></td>
            <td><span style="font-family:'DM Mono',monospace">$${c.pq.toLocaleString('es-MX')}</span></td>
            <td><span style="font-family:'DM Mono',monospace;color:var(--danger)">$${capitalAt.toLocaleString('es-MX')}</span></td>
            <td><span style="font-family:'DM Mono',monospace;font-size:.76rem;color:var(--muted)">${firstDueLbl}</span></td>
            <td><div style="display:flex;gap:5px">
              <button class="btn btn-s btn-sm btn-ic" onclick="openReporte('${c.id}')" title="Reporte Personal" style="color:var(--purple)"><i class="fas fa-clipboard-list"></i></button>
              <button class="btn btn-s btn-sm btn-ic" onclick="openEC('${c.id}')" title="Estado de cuenta"><i class="fas fa-file-invoice"></i></button>
              ${c.telefono ? `<button class="btn btn-wa btn-sm btn-ic" onclick="waCliente('${c.id}')" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>` : ''}
            </div></td>
          </tr>`;
        }).join('');
  }

  const tb2 = document.getElementById('tb-rec');
  if (tb2) {
    tb2.innerHTML = !morosos.length
      ? '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">✅ Sin recargos</td></tr>'
      : morosos.map(c => {
          const elapsed = Math.min(qsElapsed(c.inicio, c.producto), c.nq);
          const atrasadas = Math.max(0, elapsed - c.pagadas);
          const capitalAt = atrasadas * c.pq;
          const rec = calcRecargoPorCliente(c);
          const totalCobrar = capitalAt + rec.total;
          const desglose = rec.periodos.map(p =>
            `<span style="white-space:nowrap">Q${p.idx}: ${p.diasAtraso}d → $${p.recargo.toLocaleString('es-MX')}</span>`
          ).join('<br>');
          return `<tr>
            <td><strong>${esc(c.nombre)}</strong></td>
            <td><span class="badge br">${periodosLabel(atrasadas, c)}</span></td>
            <td style="font-family:'DM Mono',monospace;font-size:.74rem;color:var(--muted);line-height:1.6">${desglose || '—'}</td>
            <td><span style="font-family:'DM Mono',monospace;color:var(--warn);font-weight:700">+$${rec.total.toLocaleString('es-MX')}</span></td>
            <td><span style="font-family:'DM Mono',monospace;color:var(--danger)">$${capitalAt.toLocaleString('es-MX')}</span></td>
            <td><span style="font-family:'DM Mono',monospace;color:var(--accent);font-weight:700">$${totalCobrar.toLocaleString('es-MX')}</span></td>
            <td><div style="display:flex;gap:5px">
              <button class="btn btn-s btn-sm btn-ic" onclick="openReporte('${c.id}')" title="Reporte Personal" style="color:var(--purple)"><i class="fas fa-clipboard-list"></i></button>
              <button class="btn btn-s btn-sm btn-ic" onclick="openEC('${c.id}')" title="Estado de cuenta"><i class="fas fa-file-invoice"></i></button>
              ${c.telefono ? `<button class="btn btn-wa btn-sm btn-ic" onclick="waCliente('${c.id}')" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>` : ''}
            </div></td>
          </tr>`;
        }).join('');
  }
}

/* ============================================================
   MODAL / TOAST / VIEW HELPERS
============================================================ */
// Escapa también comillas: se usa dentro de atributos (data-*, onclick)
function esc(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function om(id){document.getElementById(id).classList.add('open')}
function cm(id){document.getElementById(id).classList.remove('open')}
function set(id,v){document.getElementById(id).textContent=v}
function toast(msg,type='ok'){
  const el=document.createElement('div');
  el.className='toast '+type;
  const ic=type==='ok'?'fa-check-circle':type==='err'?'fa-times-circle':type==='wa'?'fa-whatsapp':'fa-exclamation-triangle';
  const col=type==='ok'?'var(--accent)':type==='err'?'var(--danger)':type==='wa'?'#25d366':'var(--warn)';
  // Usar textContent para el mensaje — previene XSS con datos de usuario
  const icon=document.createElement('i');
  icon.className=(type==='wa'?'fab':'fas')+' '+ic;
  icon.style.color=col;
  const txt=document.createElement('span');
  txt.textContent=msg;
  el.appendChild(icon);
  el.appendChild(document.createTextNode(' '));
  el.appendChild(txt);
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}

function gv(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  document.getElementById('v-'+name).classList.add('on');
  document.querySelectorAll('.ni').forEach(n=>{
    if(n.getAttribute('onclick')?.includes(name)) n.classList.add('on');
  });
  if(window.innerWidth<768){
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sbov').classList.remove('open');
  }
  if(name==='dashboard') renderDash();
  if(name==='checklist') renderCL();
  if(name==='historial') renderH();
  if(name==='reportes') renderRep();
  if(name==='morosos') renderMorosos();
}

function toggleSB(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sbov').classList.toggle('open');
}

function refresh(){
  autoBackup();
  const activeId = document.querySelector('.view.on')?.id;
  renderDash();
  renderC();
  renderCL();
  // Vistas de solo lectura: render diferido — solo si están activas
  if (activeId === 'v-historial') renderH();
  if (activeId === 'v-reportes') renderRep();
  renderMorosos();
}

/* ============================================================
   VISIBILITYCHANGE — re-evaluar atrasos al volver a la pestaña
   (cubre el caso donde el día cambia con la app abierta)
============================================================ */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && clientes.length) {
    syncAlertas();
    renderDash();
    renderMorosos();
  }
});

/* ============================================================
   TECLA ESCAPE — cerrar cualquier modal abierto
============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // El rescate no se puede cerrar con Escape (hay que decidir qué hacer)
    document.querySelectorAll('.overlay.open:not([data-bloqueante])').forEach(o => o.classList.remove('open'));
  }
});

/* ============================================================
   MANEJADOR GLOBAL DE ERRORES — evita fallos silenciosos
============================================================ */
window.addEventListener('unhandledrejection', e => {
  console.error('HD Crédit — promise rejection:', e.reason);
  reportarError('Promesa sin manejar', e.reason);
  if (e.reason?.message) toast('Error inesperado: ' + e.reason.message, 'err');
});
window.onerror = (msg, src, line, col, err) => {
  console.error('HD Crédit — JS error:', msg, 'en línea', line);
  reportarError('Error de JavaScript', err || new Error(String(msg)), { donde: (src || '').split('/').pop() + ':' + line });
};

/* ============================================================
   QUINZENA SELECTOR INIT
============================================================ */
function initQSel(){
  const sel=document.getElementById('qsel');
  const qs=getQuincenas(12);
  sel.innerHTML=qs.map(q=>`<option value="${q.key}">${q.label}</option>`).join('');
  const cur=curQKey();
  const opt=[...sel.options].find(o=>o.value===cur);
  if(opt) sel.value=cur; else sel.selectedIndex=sel.options.length-1;
}

/* ============================================================
   FIREBASE CONFIG POR DEFECTO: viene de js/config-real.js (solo en la app
   publicada). Si ese archivo falta (p. ej. el sitio de prueba), es null y
   la app se detiene con un error en vez de conectarse por accidente.
============================================================ */
const DEFAULT_FB_CONFIG = (window.HD_FIREBASE_REAL && window.HD_FIREBASE_REAL.apiKey && window.HD_FIREBASE_REAL.projectId)
  ? window.HD_FIREBASE_REAL : null;

/* ============================================================
   INIT
============================================================ */
function init(){
  // Animate loader bar
  setTimeout(()=>document.getElementById('lf').style.width='100%', 50);

  initQSel();
  renderTF();
  pintarAvisoErrores(); // errores guardados de sesiones anteriores
  pintarAvisoRevision(); // cobros por revisar guardados en el teléfono

  // Pide almacenamiento persistente para reducir el riesgo de que el
  // navegador borre localStorage bajo presión de espacio.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(()=>{});
  }

  const saved=localStorage.getItem('hd_fb');

  // Hide loader after 1.6s then check config
  setTimeout(()=>{
    document.getElementById('loader').classList.add('hide');
    setTimeout(()=>document.getElementById('loader').style.display='none',450);

    arrancarConexion(saved);
  },1600);
}

// Decide cómo conectar SIN arriesgar datos que solo existen en este teléfono.
// En modo nube, primero se inicia sesión: antes de eso no se carga ni se
// muestra ningún dato (ni de la nube ni la copia local).
async function arrancarConexion(saved){
  // 1. "Solo local" ya no existe para los usuarios: un teléfono que lo usaba
  //    inicia sesión y pasa por el rescate (paso 2), sin perder sus datos.
  //    Solo las pruebas automáticas (navegador controlado por Playwright,
  //    navigator.webdriver) siguen corriendo en local, sin Firebase.
  if (navigator.webdriver === true && !MODO_PRUEBA && saved === 'local' && localStorage.getItem('hd_local_manual') === '1') {
    _modoLocalAutomatizado = true; ocultarLogin(); loadLocal(); return;
  }
  // El sitio de prueba se reconoce aunque falte ?prueba=1 (app instalada)
  await detectarEntorno();
  const cfg = await configNube(saved);
  if (!cfg) return; // bloqueado: se queda en la pantalla de aviso, sin datos
  _cfgNube = cfg;
  mostrarLogin();
  const conSesion = await loadFirebaseSDK(cfg, { soloSesion: true });
  if (!conSesion) return; // sin sesión: no se muestra nada
  // 2. Modo local heredado (versiones anteriores lo guardaban solo al
  //    fallar la red) o cambios hechos en modo local temporal: rescate
  //    obligatorio antes de reconectar — si hay algo que rescatar.
  const pendiente = localStorage.getItem('hd_rescate_pendiente') === '1';
  if ((saved === 'local' || pendiente) && hayDatosLocales()) {
    localStorage.setItem('hd_rescate_pendiente', '1');
    iniciarRescate(cfg);
    return;
  }
  // 3. Normal: conectar a la nube
  if (!MODO_PRUEBA && (!saved || saved === 'local')) localStorage.setItem('hd_fb', JSON.stringify(cfg));
  loadFirebaseSDK(cfg);
}

// Expose globals
window.openNew=openNew; window.editC=editC; window.saveC=saveC;
window.onProductoChange=onProductoChange;
window.calcPQ=calcPQ; window.confirmDel=confirmDel;
window.registrarCobro=registrarCobro; window.openEC=openEC; window.sendEC=sendEC;
window.waCliente=waCliente; window.waAll=waAll;
window.filterC=filterC; window.filterH=filterH;
window.renderCL=renderCL; window.gv=gv; window.toggleSB=toggleSB;
window.doExport=doExport; window.doExportXLSX=doExportXLSX; window.doExportJSON=doExportJSON; window.doImportJSON=doImportJSON;
window.connectFirebase=connectFirebase;
window.om=om; window.cm=cm;
window.initPago=initPago; window.undoLastPago=undoLastPago;
window.switchMorososTab=switchMorososTab; window.renderMorosos=renderMorosos;
window.openReporte=openReporte; window.sendReporte=sendReporte;
window.openReverso=openReverso; window.selReverso=selReverso; window.doReverso=doReverso;
window.cargarMasHistorial=cargarMasHistorial;
window.abrirErrores=abrirErrores; window.limpiarErrores=limpiarErrores;
window.rescateDescargar=rescateDescargar; window.rescateComparar=rescateComparar;
window.rescateSubir=rescateSubir; window.rescateSeguirLocal=rescateSeguirLocal;
window.rescateTerminar=rescateTerminar; window.reintentarConexion=reintentarConexion;
window.borrarCopiasDescargadas=borrarCopiasDescargadas;
window.abrirRevision=abrirRevision; window.reintentarRevision=reintentarRevision; window.descartarRevision=descartarRevision;

init();
