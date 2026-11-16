/* ============================================================
   TABLA DE FACTORES
============================================================ */
const TF = {
  1000:{6:240,8:194,10:167,12:null},
  2000:{6:467,8:364,10:307,12:null},
  3000:{6:650,8:545,10:456,12:400},
  4000:{6:850,8:722,10:601,12:534},
  5000:{6:1083,8:900,10:751,12:667},
  6000:{6:1300,8:1077,10:900,12:800},
  7000:{6:1514,8:1264,10:1050,12:934},
  8000:{6:1734,8:1431,10:1200,12:1067},
  9000:{6:1954,8:1598,10:1350,12:1200},
  10000:{6:2176,8:1764,10:1501,12:1334},
  11000:{6:2384,8:1931,10:1651,12:1467},
  12000:{6:2600,8:2097,10:1800,12:1600},
  13000:{6:2817,8:2264,10:1950,12:1734},
  14000:{6:3034,8:2431,10:2100,12:1867},
  15000:{6:3251,8:2601,10:2251,12:2001}
};

/* ============================================================
   TABLA DE FACTORES — PRÉSTAMO 30 DÍAS (pago único, +15%)
============================================================ */
const TF30 = {
  1000:1150, 2000:2300, 3000:3450, 4000:4600, 5000:5750,
  6000:6900, 7000:8050, 8000:9200, 9000:10350, 10000:11500
};
const RECARGO_DIA = { quincenal_fijo: 50, unico_30d: 100 };

/* ============================================================
   STATE
============================================================ */
let DB = null, USE_FB = false, CURRENT_UID = null;
let clientes = [], historial = [];
let _pendingPago = {}, _pendingOrigHtml = {}, _lastPago = null;
let _unsubClientes = null, _unsubHistorial = null;

/* Paginación de historial: por defecto solo se sincroniza en vivo lo
   reciente (suficiente para checklist/reportes/dashboard) — esto reduce
   drásticamente las lecturas de Firestore en cada apertura de la app.
   El resto queda disponible bajo demanda con "Cargar más historial". */
const HIST_DIAS_RECIENTES = 200; // cubre de sobra los 12 quincenas del selector (~180 días)
let _histReciente = [], _histAntiguo = [];
let _histCursor = null, _histPaginando = false, _histHayMas = true, _histCargando = false;

/* ============================================================
   REGISTRO VISIBLE DE ERRORES
   Antes muchos errores solo iban a la consola (o a un catch vacío) y
   nadie se enteraba. Ahora cada error queda guardado en este teléfono
   (localStorage 'hd_err', últimos 50) y aparece un aviso rojo fijo con el
   conteo; al tocarlo se ve la lista. No se envía nada a la nube.
============================================================ */
// Fecha de HOY en la zona del teléfono (AAAA-MM-DD). No usar
// toISOString(): da la fecha UTC y en México, de noche, sale el día siguiente.
function fechaLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MAX_ERRORES = 50;
let _errores = [];
try { _errores = JSON.parse(localStorage.getItem('hd_err') || '[]'); if (!Array.isArray(_errores)) _errores = []; }
catch(e) { _errores = []; }

function reportarError(origen, err, extra = {}) {
  const mensaje = (err && (err.message || err.code)) ? String(err.message || err.code) : String(err ?? 'Error desconocido');
  const reg = { ts: new Date().toISOString(), origen: String(origen || '—'), mensaje, codigo: err && err.code ? String(err.code) : '', ...extra };
  _errores.unshift(reg);
  if (_errores.length > MAX_ERRORES) _errores.length = MAX_ERRORES;
  try { localStorage.setItem('hd_err', JSON.stringify(_errores)); } catch(e) { /* sin espacio: queda solo en memoria y en el aviso */ }
  try { console.error('HD Crédit — ' + reg.origen + ':', err); } catch(e) {}
  pintarAvisoErrores();
  return reg;
}

function pintarAvisoErrores() {
  const el = document.getElementById('err-badge');
  if (!el) return;
  const n = _errores.length;
  el.hidden = n === 0;
  const cnt = document.getElementById('err-count');
  if (cnt) cnt.textContent = n;
}

function abrirErrores() {
  const body = document.getElementById('err-body');
  if (!body) return;
  body.innerHTML = _errores.length
    ? _errores.map(r => `<div class="err-item">
        <div class="err-meta">${esc(new Date(r.ts).toLocaleString('es-MX'))} · <strong>${esc(r.origen)}</strong>${r.codigo ? ' · ' + esc(r.codigo) : ''}${r.donde ? ' · ' + esc(r.donde) : ''}</div>
        <div class="err-msg">${esc(r.mensaje)}</div>
      </div>`).join('')
    : '<p style="color:var(--muted)">Sin errores registrados ✅</p>';
  if (typeof pintarEspacio === 'function') pintarEspacio();
  om('m-errores');
}

function limpiarErrores() {
  _errores = [];
  try { localStorage.removeItem('hd_err'); } catch(e) {}
  pintarAvisoErrores();
  cm('m-errores');
}

