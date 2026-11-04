/* ============================================================
   EXPORT / IMPORT
============================================================ */
function doExport() {
  const rows = [['#','Nombre','Producto','Monto','Pago Q','Plazo','Q Pagadas','Saldo','Estado'],
    ...clientes.map((c,i)=>[i+1,c.nombre,c.producto==='unico_30d'?'Préstamo 30 Días':'Quincenal',c.monto,c.pq,plazoLabel(c),c.pagadas,c.saldo,
      c.saldo===0?'Liquidado':calcAlerta(c)||'Al corriente'])];
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download = 'HDCredit_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  toast('Exportado CSV ✅', 'ok');
}

function doExportXLSX() {
  if (typeof XLSX === 'undefined') {
    toast('Cargando exportador Excel...', 'wrn');
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = _generateXLSX;
    s.onerror = () => toast('Error al cargar librería Excel', 'err');
    document.head.appendChild(s);
  } else {
    _generateXLSX();
  }
}

async function _generateXLSX() {
  if (!clientes.length) { toast('No hay datos para exportar', 'err'); return; }

  // La vista solo mantiene sincronizado el historial reciente (ver
  // HIST_DIAS_RECIENTES) — para que el Excel exportado sea un respaldo
  // completo, se trae todo el historial de Firestore en este momento
  let historialCompleto = historial;
  if (USE_FB && _histHayMas) {
    toast('Preparando historial completo…', 'wa');
    try { historialCompleto = await obtenerHistorialCompleto(); }
    catch(e) { toast('No se pudo traer el historial completo, se exporta lo disponible: ' + e.message, 'wrn'); }
  }

  const wb = XLSX.utils.book_new();

  // Hoja 1: Acreditados
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['#','Nombre','Producto','Monto','Pago Q','Plazo','Q Pagadas','Q Restantes','Saldo','Estado','Inicio','Teléfono','Notas'],
    ...clientes.map((c, i) => [
      i + 1, c.nombre, c.producto==='unico_30d'?'Préstamo 30 Días':'Quincenal', c.monto, c.pq, plazoLabel(c),
      c.pagadas, c.nq - c.pagadas, c.saldo,
      c.saldo === 0 ? 'Liquidado' : calcAlerta(c) === 'ATRASADO' ? 'Atrasado' : 'Al corriente',
      c.inicio || '', c.telefono || '', c.notas || ''
    ])
  ]);
  ws1['!cols'] = [
    {wch:4},{wch:22},{wch:16},{wch:10},{wch:10},{wch:8},
    {wch:10},{wch:12},{wch:12},{wch:14},{wch:12},{wch:14},{wch:22}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Acreditados');

  // Hoja 2: Historial
  if (historialCompleto.length) {
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Acreditado','Monto','Quincena','Fecha','Hora','Tipo'],
      ...historialCompleto.map(h => [
        h.nombre || '', h.monto || 0, h.qKey || '',
        h.fecha || '', h.hora || '', h.accion || ''
      ])
    ]);
    ws2['!cols'] = [{wch:22},{wch:10},{wch:14},{wch:14},{wch:12},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Historial');
  }

  const fname = 'HDCredit_' + new Date().toISOString().split('T')[0] + '.xlsx';
  XLSX.writeFile(wb, fname);
  toast('Excel descargado ✅', 'ok');
}

/* ============================================================
   REPORTE DE CARTERA ACTIVA (por quincena)
============================================================ */
function descargarReporteCartera() {
  if (typeof XLSX === 'undefined') {
    toast('Cargando exportador Excel...', 'wrn');
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = _generarReporteCartera;
    s.onerror = () => toast('Error al cargar librería Excel', 'err');
    document.head.appendChild(s);
  } else {
    _generarReporteCartera();
  }
}

function _generarReporteCartera() {
  // Mismas cuentas que muestra Control de Cobros/Morosos: activas (con saldo),
  // liquidadas excluidas — igual que el formato de referencia.
  const activos = clientes.filter(c => (c.saldo || 0) > 0);
  if (!activos.length) { toast('No hay cuentas activas para reportar', 'err'); return; }

  const qselEl = document.getElementById('qsel');
  const qKey = (qselEl && qselEl.value) || curQKey();
  const labelQ = labelQuincenaLarga(qKey);

  const cuentasActivas = activos.length;
  const saldoPorCobrar = activos.reduce((a, c) => a + (c.saldo || 0), 0);
  const cobroEsperadoQ = activos.reduce((a, c) => a + (c.pq || 0), 0);
  const montoTotal = activos.reduce((a, c) => a + (c.monto || 0), 0);
  const atrasados = activos.filter(c => calcAlerta(c) === 'ATRASADO').length;

  const fmtFechaDMY = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const filas = activos.map(c => [
    c.nombre,
    c.monto,
    c.pq,
    plazoLabel(c),
    c.pagadas || 0,
    (c.nq || 0) - (c.pagadas || 0),
    c.saldo || 0,
    calcAlerta(c) === 'ATRASADO' ? 'ATRASADO' : 'AL CORRIENTE',
    fmtFechaDMY(c.inicio)
  ]);

  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;

  const STAT_VALUES_ROW = 6;              // fila 6 (1-indexed) = ['cuentasActivas','saldoPorCobrar','cobroEsperadoQ','atrasados']
  const HEADER_ROW = 8;                   // fila 8 = encabezado NOMBRE/MONTO/...
  const DATA_START_ROW = HEADER_ROW + 1;  // 9
  const TOTALES_ROW = DATA_START_ROW + filas.length;

  const aoa = [
    ['HD Crédit'],
    ['Reporte de Cartera Activa'],
    ['QUINCENA', labelQ],
    [],
    ['CUENTAS ACTIVAS', 'SALDO POR COBRAR', 'COBRO ESPERADO / Q', 'ATRASADOS'],
    [cuentasActivas, saldoPorCobrar, cobroEsperadoQ, atrasados],
    [],
    ['NOMBRE', 'MONTO', 'PAGO Q', 'PLAZO', 'Q PAGADAS', 'Q RESTANTES', 'SALDO', 'ESTADO', 'INICIO'],
    ...filas,
    [`TOTALES (${cuentasActivas} cuentas)`, montoTotal, cobroEsperadoQ, '', '', '', saldoPorCobrar, '', ''],
    [],
    [`Generado el ${fechaHoy} · Cuentas liquidadas excluidas`]
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:22},{wch:12},{wch:11},{wch:8},{wch:11},{wch:12},{wch:12},{wch:14},{wch:12}];

  // Formato de moneda en las columnas de dinero (los montos se guardan como
  // número, no como texto — así el Excel resultante permite sumar/filtrar).
  const monedaFmt = '"$"#,##0';
  const setMoneda = (addr) => { const cell = ws[addr]; if (cell) cell.z = monedaFmt; };
  ['B', 'C'].forEach(col => setMoneda(col + STAT_VALUES_ROW));
  for (let i = 0; i < filas.length; i++) {
    const r = DATA_START_ROW + i;
    ['B', 'C', 'G'].forEach(col => setMoneda(col + r));
  }
  ['B', 'C', 'G'].forEach(col => setMoneda(col + TOTALES_ROW));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cartera Activa');

  const slug = labelQ.replace(/\s+de\s+/i, '_').replace(/\s+/g, '');
  XLSX.writeFile(wb, `HDCredit_CarteraActiva_${slug}.xlsx`);
  toast('Reporte de Cartera descargado ✅', 'ok');
}

async function doExportJSON() {
  if (!clientes.length) { toast('No hay datos para exportar', 'err'); return; }
  // Igual que en el Excel: el respaldo debe incluir TODO el historial, no
  // solo la ventana reciente que se mantiene sincronizada en vivo
  let historialCompleto = historial;
  if (USE_FB && _histHayMas) {
    toast('Preparando respaldo completo…', 'wa');
    try { historialCompleto = await obtenerHistorialCompleto(); }
    catch(e) { toast('No se pudo traer el historial completo, se respalda lo disponible: ' + e.message, 'wrn'); }
  }
  const payload = { clientes, historial: historialCompleto, ts: new Date().toISOString(), v: '2.1' };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
  a.download = 'HDCredit_respaldo_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  toast('Respaldo JSON descargado ✅', 'ok');
}

function doImportJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        prepararRestauracion(JSON.parse(ev.target.result));
      } catch(err) {
        reportarError('Leer respaldo JSON', err);
        toast('Error al leer el archivo: ' + err.message, 'err');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

const ID_VALIDO = /^[\w-]{1,120}$/;
function clienteImportadoValido(c) {
  return !!(c && typeof c === 'object'
    && typeof c.id === 'string' && ID_VALIDO.test(c.id)
    && typeof c.nombre === 'string' && c.nombre.trim()
    && Number.isFinite(c.nq) && c.nq > 0
    && Number.isFinite(c.monto) && c.monto > 0
    && Number.isFinite(c.pq) && c.pq >= 0
    && Number.isFinite(c.pagadas) && c.pagadas >= 0 && c.pagadas <= c.nq
    && (c.saldo === undefined || Number.isFinite(c.saldo))
    && (c.pagos === undefined || Array.isArray(c.pagos)));
}

// Valida el archivo y muestra la confirmación. No escribe nada todavía.
function prepararRestauracion(payload) {
  if (!payload || !Array.isArray(payload.clientes) || !payload.clientes.length) {
    toast('Archivo inválido o sin clientes', 'err'); return null;
  }
  const validos = payload.clientes.filter(clienteImportadoValido)
    .map(c => ({ ...c, createdAt: c.createdAt || new Date().toISOString() }));
  const omitidos = payload.clientes.length - validos.length;
  if (!validos.length) { toast('Archivo inválido: sin registros con estructura correcta', 'err'); return null; }
  const hist = (Array.isArray(payload.historial) ? payload.historial : [])
    .filter(h => h && typeof h === 'object' && typeof h.clienteId === 'string')
    .map((h, i) => ({ ...h, id: (typeof h.id === 'string' && ID_VALIDO.test(h.id)) ? h.id : 'h_rest_' + Date.now() + '_' + i }));
  const tsLabel = payload.ts ? new Date(payload.ts).toLocaleDateString('es-MX') : 'fecha desconocida';

  const destino = USE_FB
    ? 'Se guardará EN LA NUBE y lo verán TODOS los dispositivos.\nLos acreditados que no estén en el respaldo se eliminarán de la nube.\nEl historial del respaldo se agrega; no se borra historial existente.'
    : 'Se guardará en este dispositivo y reemplazará los datos actuales.';
  document.getElementById('rest-msg').textContent =
    `¿Restaurar ${validos.length} acreditados y ${hist.length} movimientos del respaldo del ${tsLabel}?\n\n${destino}`
    + (omitidos ? `\n\n⚠️ Se omitirán ${omitidos} registros con datos inválidos.` : '');
  const ok = document.getElementById('rest-ok');
  ok.disabled = false;
  ok.onclick = async () => {
    ok.disabled = true;
    const exito = await restaurarRespaldo(validos, hist, omitidos);
    ok.disabled = false;
    if (exito) cm('m-restaurar');
  };
  om('m-restaurar');
  return { validos, hist, omitidos };
}

function conTiempoLimite(promesa, ms, mensaje) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(mensaje)), ms);
    promesa.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Escribe el respaldo. En modo Firebase solo muestra éxito después de que
// el servidor confirmó TODOS los lotes.
async function restaurarRespaldo(validos, hist, omitidos = 0) {
  autoBackup(); // copia de lo que había, en este dispositivo
  if (!USE_FB) {
    clientes = validos;
    historial = hist.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    syncAlertas();
    saveLocal();
    refresh();
  } else {
    let lotesOk = 0, totalLotes = 0;
    try {
      if (!navigator.onLine) throw new Error('Sin conexión: restaurar necesita internet para confirmar con la nube');
      toast('Restaurando en la nube…', 'wa');
      const actuales = await conTiempoLimite(CLI().get({ source: 'server' }), 30000, 'La nube no respondió al leer los acreditados actuales');
      const idsRespaldo = new Set(validos.map(c => c.id));
      // Orden: primero se escribe lo del respaldo y al final se borra lo que
      // sobra — si algo falla a la mitad, nunca queda menos información.
      const ops = [];
      validos.forEach(c => ops.push(b => b.set(CLI().doc(c.id), { ...c, alerta: calcAlerta(c) })));
      hist.forEach(h => ops.push(b => b.set(HIST().doc(h.id), h)));
      actuales.docs.forEach(d => { if (!idsRespaldo.has(d.id)) ops.push(b => b.delete(d.ref)); });
      const TAM = 450; // límite de Firestore: 500 operaciones por lote
      totalLotes = Math.ceil(ops.length / TAM);
      for (let i = 0; i < ops.length; i += TAM) {
        const batch = DB.batch();
        ops.slice(i, i + TAM).forEach(f => f(batch));
        await conTiempoLimite(batch.commit(), 60000, 'La nube no confirmó la escritura a tiempo');
        lotesOk++;
      }
    } catch(e) {
      reportarError('Restaurar respaldo en la nube', e, { lotes: `${lotesOk}/${totalLotes}` });
      toast(`❌ La restauración NO se completó: ${e.message}` + (totalLotes ? ` (lotes confirmados: ${lotesOk} de ${totalLotes})` : ''), 'err');
      return false;
    }
  }
  if (omitidos) toast(`${validos.length} acreditados restaurados · ${omitidos} omitidos por datos inválidos`, 'wrn');
  else toast(`${validos.length} acreditados restaurados ✅`, 'ok');
  return true;
}

