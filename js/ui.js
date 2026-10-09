/* ============================================================
   REPORTE PERSONAL
============================================================ */
function openReporte(id) {
  const c = clientes.find(x => x.id === id); if (!c) return;
  const { rec, atrasadas, capitalAt, faltantes, saldo, totalCobrar, esAtrasado, esLiquidado } = resumenCliente(c);
  const iniLabel = c.inicio
    ? new Date(c.inicio + 'T12:00:00').toLocaleDateString('es-MX', {day:'2-digit', month:'long', year:'numeric'})
    : '—';
  const estado = esLiquidado ? '✅ Liquidado'
    : esAtrasado ? '⚠️ Con atraso'
    : '🟢 Al corriente';

  const porDia = RECARGO_DIA[c.producto||'quincenal_fijo'] ?? 50;
  const recHtml = rec.periodos.length ? `
    <div class="ec-card" style="border-color:rgba(255,184,0,.25)">
      <div class="ec-title" style="color:var(--warn)"><i class="fas fa-clock" style="margin-right:6px"></i>Recargos por Atraso ($${porDia}/día)</div>
      ${rec.periodos.map(p => `
        <div class="ec-row">
          <span class="ec-lbl">Q${p.idx} — ${p.diasAtraso} días de atraso</span>
          <span class="ec-val" style="color:var(--warn)">+$${p.recargo.toLocaleString('es-MX')}</span>
        </div>`).join('')}
      <div class="ec-row" style="padding-top:10px">
        <span class="ec-lbl" style="font-weight:700">Total recargo</span>
        <span class="ec-val" style="color:var(--warn)">+$${rec.total.toLocaleString('es-MX')}</span>
      </div>
    </div>
    <div class="ec-card" style="border-color:rgba(0,229,160,.3);background:rgba(0,229,160,.04)">
      <div class="ec-row">
        <span class="ec-lbl">Capital atrasado</span>
        <span class="ec-val" style="color:var(--danger)">$${capitalAt.toLocaleString('es-MX')}</span>
      </div>
      <div class="ec-row">
        <span class="ec-lbl">Recargo acumulado</span>
        <span class="ec-val" style="color:var(--warn)">+$${rec.total.toLocaleString('es-MX')}</span>
      </div>
      <div class="ec-row" style="padding-top:10px">
        <span class="ec-lbl" style="font-weight:700;font-size:.9rem">TOTAL A LIQUIDAR</span>
        <span class="ec-val" style="color:var(--accent);font-size:1.05rem;font-weight:800">$${totalCobrar.toLocaleString('es-MX')}</span>
      </div>
    </div>` : `
    <div class="ec-card">
      <div class="ec-row">
        <span class="ec-lbl">Saldo pendiente</span>
        <span class="ec-val" style="color:${saldo > 0 ? 'var(--warn)' : 'var(--accent)'}">$${saldo.toLocaleString('es-MX')}</span>
      </div>
    </div>`;

  document.getElementById('rep-body').innerHTML = `
    <div class="ec-card">
      <div class="ec-title"><i class="fas fa-user" style="margin-right:6px"></i>Datos del Acreditado</div>
      <div class="ec-row"><span class="ec-lbl">Nombre</span><span class="ec-val">${esc(c.nombre)}</span></div>
      ${c.telefono ? `<div class="ec-row"><span class="ec-lbl">Teléfono</span><span class="ec-val" style="font-family:'DM Mono',monospace">${esc(c.telefono)}</span></div>` : ''}
      ${c.notas ? `<div class="ec-row"><span class="ec-lbl">Notas</span><span class="ec-val" style="font-size:.8rem;white-space:pre-wrap;word-break:break-word">${esc(c.notas)}</span></div>` : ''}
      <div class="ec-row"><span class="ec-lbl">Estado</span><span class="ec-val">${estado}</span></div>
    </div>
    <div class="ec-card">
      <div class="ec-title"><i class="fas fa-file-invoice-dollar" style="margin-right:6px"></i>Detalles del Préstamo</div>
      <div class="ec-row"><span class="ec-lbl">Monto prestado</span><span class="ec-val" style="color:var(--accent)">$${c.monto.toLocaleString('es-MX')}</span></div>
      ${c.producto==='unico_30d' ? `
      <div class="ec-row"><span class="ec-lbl">Plazo</span><span class="ec-val">30 días (pago único)</span></div>
      <div class="ec-row"><span class="ec-lbl">Total a pagar</span><span class="ec-val">$${c.pq.toLocaleString('es-MX')}</span></div>
      <div class="ec-row"><span class="ec-lbl">Fecha de inicio</span><span class="ec-val">${iniLabel}</span></div>
      <div class="ec-row"><span class="ec-lbl">Estado de pago</span><span class="ec-val" style="color:${faltantes>0?'var(--warn)':'var(--accent)'}">${faltantes>0?'Pendiente':'Pagado'}</span></div>
      ` : `
      <div class="ec-row"><span class="ec-lbl">Plazo total</span><span class="ec-val">${c.nq} quincenas</span></div>
      <div class="ec-row"><span class="ec-lbl">Pago quincenal</span><span class="ec-val">$${c.pq.toLocaleString('es-MX')}</span></div>
      <div class="ec-row"><span class="ec-lbl">Fecha de inicio</span><span class="ec-val">${iniLabel}</span></div>
      <div class="ec-row"><span class="ec-lbl">Quincenas pagadas</span><span class="ec-val" style="color:var(--accent)">${c.pagadas} de ${c.nq}</span></div>
      <div class="ec-row"><span class="ec-lbl">Quincenas restantes</span><span class="ec-val" style="color:${faltantes > 0 ? 'var(--warn)' : 'var(--accent)'}">${faltantes}</span></div>
      ${atrasadas > 0 ? `<div class="ec-row"><span class="ec-lbl">Quincenas atrasadas</span><span class="ec-val" style="color:var(--danger)">${atrasadas}</span></div>` : ''}
      `}
    </div>
    ${recHtml}`;

  const waBtn = document.getElementById('rep-wa-btn');
  if (c.telefono) { waBtn.style.display = 'flex'; waBtn.onclick = () => sendReporte(c); }
  else waBtn.style.display = 'none';
  om('m-reporte');
}

function sendReporte(c) {
  const { rec, atrasadas, capitalAt, faltantes, saldo, totalCobrar, esAtrasado, esLiquidado } = resumenCliente(c);
  const iniLabel = c.inicio
    ? new Date(c.inicio + 'T12:00:00').toLocaleDateString('es-MX', {day:'2-digit', month:'long', year:'numeric'})
    : '—';
  const estado = esLiquidado ? 'LIQUIDADO ✅'
    : esAtrasado ? 'CON ATRASO ⚠️'
    : 'AL CORRIENTE ✅';

  const porDia = RECARGO_DIA[c.producto||'quincenal_fijo'] ?? 50;
  let recStr = '';
  if (rec.periodos.length) {
    recStr += `\n\n⏰ *RECARGOS POR ATRASO ($${porDia}/día)*`;
    recStr += rec.periodos.map(p =>
      `\n• Q${p.idx}: ${p.diasAtraso} días → *$${p.recargo.toLocaleString('es-MX')}*`
    ).join('');
    recStr += `\n• Total recargo: *$${rec.total.toLocaleString('es-MX')}*`;
    recStr += `\n\n💰 *TOTAL A LIQUIDAR*`;
    recStr += `\n• Capital pendiente: $${capitalAt.toLocaleString('es-MX')}`;
    recStr += `\n• Recargo acumulado: +$${rec.total.toLocaleString('es-MX')}`;
    recStr += `\n• *TOTAL: $${totalCobrar.toLocaleString('es-MX')}*`;
  } else {
    recStr = `\n\n💰 *Saldo pendiente: $${saldo.toLocaleString('es-MX')}*`;
  }

  const detalleStr = c.producto === 'unico_30d'
    ? `• Monto prestado: *$${c.monto.toLocaleString('es-MX')}*
• Plazo: *30 días (pago único)*
• Total a pagar: *$${c.pq.toLocaleString('es-MX')}*
• Fecha de inicio: *${iniLabel}*`
    : `• Monto prestado: *$${c.monto.toLocaleString('es-MX')}*
• Plazo: *${c.nq} quincenas*
• Pago quincenal: *$${c.pq.toLocaleString('es-MX')}*
• Fecha de inicio: *${iniLabel}*`;

  const avanceStr = c.producto === 'unico_30d'
    ? `• Estado de pago: *${faltantes>0?'Pendiente':'Pagado'}*`
    : `• Pagadas: *${c.pagadas} de ${c.nq}*
• Restantes: *${faltantes}*${atrasadas > 0 ? `\n• Atrasadas: *${atrasadas}*` : ''}`;

  const msg =
`━━━━━━━━━━━━━━━━━━━━
📋 *REPORTE PERSONAL*
*HD Crédit*
━━━━━━━━━━━━━━━━━━━━
👤 *${c.nombre}*
${c.telefono ? `📱 ${c.telefono}` : ''}

📄 *DETALLES DEL PRÉSTAMO*
${detalleStr}

📊 *AVANCE DE PAGOS*
${avanceStr}${recStr}

📌 Estado: *${estado}*
━━━━━━━━━━━━━━━━━━━━
_Cualquier duda, con gusto te atendemos._
_¡Gracias por tu confianza! 🙏_`;

  window.open(`https://wa.me/52${c.telefono}?text=${encodeURIComponent(msg)}`, '_blank');
  toast(`Reporte enviado a ${c.nombre}`, 'wa');
}

/* ============================================================
   ESTADO DE CUENTA
============================================================ */
function openEC(id) {
  const c = clientes.find(x=>x.id===id); if(!c) return;

  const { faltantes, saldo, elapsed: elapsedEC, esAtrasado, esLiquidado } = resumenCliente(c);

  // Timeline de quincenas — usa array real de pagos y marca vencidas en rojo
  const pagosArr = (c.pagos || Array(c.nq).fill(false)).slice(0, c.nq);
  const nextUnpaid = pagosArr.findIndex(p => !p);
  const timeline = pagosArr.map((paid, i) => {
    if (paid) return `<div class="ec-q ck" title="Q${i+1} pagada">${i+1}</div>`;
    if (i < elapsedEC) return `<div class="ec-q" style="background:rgba(255,69,96,.15);border:1px solid var(--danger);color:var(--danger)" title="Q${i+1} vencida">${i+1}</div>`;
    if (i === nextUnpaid) return `<div class="ec-q nx" title="Q${i+1} próxima">${i+1}</div>`;
    return `<div class="ec-q pd" title="Q${i+1} pendiente">${i+1}</div>`;
  }).join('');

  const estado = esLiquidado ? '✅ Liquidado'
    : esAtrasado ? '⚠️ Con atraso'
    : '🟢 Al corriente';

  document.getElementById('ec-body').innerHTML = `
    <div class="ec-card">
      <div class="ec-title">Información del préstamo</div>
      <div class="ec-row"><span class="ec-lbl">Acreditado</span><span class="ec-val">${esc(c.nombre)}</span></div>
      <div class="ec-row"><span class="ec-lbl">Monto prestado</span><span class="ec-val" style="color:var(--accent)">$${c.monto.toLocaleString('es-MX')}</span></div>
      <div class="ec-row"><span class="ec-lbl">Plazo total</span><span class="ec-val">${c.producto==='unico_30d'?'30 días (pago único)':`${c.nq} quincenas`}</span></div>
      <div class="ec-row"><span class="ec-lbl">${c.producto==='unico_30d'?'Total a pagar':'Pago quincenal'}</span><span class="ec-val">$${c.pq.toLocaleString('es-MX')}</span></div>
      <div class="ec-row"><span class="ec-lbl">Estado</span><span class="ec-val">${estado}</span></div>
    </div>
    <div class="ec-card">
      <div class="ec-title">Avance de pagos</div>
      ${c.producto==='unico_30d' ? `
      <div class="ec-row"><span class="ec-lbl">Estado de pago</span><span class="ec-val" style="color:${faltantes>0?'var(--warn)':'var(--accent)'}">${faltantes>0?'Pendiente':'Pagado'}</span></div>
      ` : `
      <div class="ec-row"><span class="ec-lbl">Quincenas pagadas</span><span class="ec-val" style="color:var(--accent)">${c.pagadas} de ${c.nq}</span></div>
      <div class="ec-row"><span class="ec-lbl">Quincenas restantes</span><span class="ec-val" style="color:${faltantes>0?'var(--warn)':'var(--accent)'}">${faltantes}</span></div>
      `}
      <div class="ec-row"><span class="ec-lbl">Saldo pendiente</span><span class="ec-val" style="color:${saldo>0?'var(--warn)':'var(--accent)'}">$${saldo.toLocaleString('es-MX')}</span></div>
      <div style="margin-top:12px">
        <div class="ec-title" style="margin-bottom:8px">Progreso visual</div>
        <div class="ec-timeline">${timeline}</div>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:.72rem;color:var(--muted)">
          <span>🟢 Pagada</span><span style="color:var(--warn)">🟡 Próxima</span><span>⬜ Pendiente</span>
        </div>
      </div>
    </div>`;

  // WhatsApp button
  const waBtn = document.getElementById('ec-wa-btn');
  if (c.telefono) {
    waBtn.style.display = 'flex';
    waBtn.onclick = () => sendEC(c);
  } else {
    waBtn.style.display = 'none';
  }

  om('m-ec');
}

function sendEC(c) {
  const { faltantes, saldo, esAtrasado, esLiquidado } = resumenCliente(c);
  const estado = esLiquidado ? 'LIQUIDADO ✅'
    : esAtrasado ? 'CON ATRASO ⚠️'
    : 'AL CORRIENTE ✅';

  const detalleStr = c.producto === 'unico_30d'
    ? `• Monto prestado: *$${c.monto.toLocaleString('es-MX')}*
• Plazo: *30 días (pago único)*
• Total a pagar: *$${c.pq.toLocaleString('es-MX')}*`
    : `• Monto prestado: *$${c.monto.toLocaleString('es-MX')}*
• Plazo: *${c.nq} quincenas*
• Pago quincenal: *$${c.pq.toLocaleString('es-MX')}*`;

  const avanceStr = c.producto === 'unico_30d'
    ? `• Estado de pago: *${faltantes>0?'Pendiente':'Pagado'}*`
    : `• Quincenas pagadas: *${c.pagadas} de ${c.nq}*
• Quincenas restantes: *${faltantes}*`;

  const msg =
`━━━━━━━━━━━━━━━━━━━━
💳 *ESTADO DE CUENTA*
*HD Crédit*
━━━━━━━━━━━━━━━━━━━━
👤 *${c.nombre}*

📋 *DETALLES DEL PRÉSTAMO*
${detalleStr}

📊 *AVANCE DE PAGOS*
${avanceStr}
• Saldo pendiente: *$${saldo.toLocaleString('es-MX')}*

📌 Estado: *${estado}*
━━━━━━━━━━━━━━━━━━━━
_Cualquier duda, con gusto te atendemos._
_¡Gracias por tu confianza! 🙏_`;

  window.open(`https://wa.me/52${c.telefono}?text=${encodeURIComponent(msg)}`, '_blank');
  toast(`Estado de cuenta enviado a ${c.nombre}`, 'wa');
}

/* ============================================================
   WHATSAPP RECORDATORIO
============================================================ */
function waCliente(id) {
  const c = clientes.find(x=>x.id===id); if(!c) return;
  if (!c.telefono) { toast('Sin teléfono registrado', 'wrn'); return; }
  const faltantes = c.nq - c.pagadas;
  const msg = c.producto === 'unico_30d'
    ? `Hola ${c.nombre} 👋\n\nTe recordamos que tu pago único de *$${c.pq.toLocaleString('es-MX')}* está próximo a vencer.\n\n💰 Saldo: $${c.saldo.toLocaleString('es-MX')}\n\n¡Gracias! — HD Crédit 🙏`
    : `Hola ${c.nombre} 👋\n\nTe recordamos que tu pago quincenal de *$${c.pq.toLocaleString('es-MX')}* está próximo.\n\n📊 Quincenas: ${c.pagadas}/${c.nq} · Faltan: ${faltantes}\n💰 Saldo: $${c.saldo.toLocaleString('es-MX')}\n\n¡Gracias! — HD Crédit 🙏`;
  window.open(`https://wa.me/52${c.telefono}?text=${encodeURIComponent(msg)}`, '_blank');
}

function waAll() {
  const activos = clientes.filter(c => c.saldo > 0 && c.telefono);
  if (!activos.length) { toast('Sin acreditados con teléfono', 'wrn'); return; }
  if (!confirm(`¿Enviar recordatorio a ${activos.length} acreditados?\n\nNota: el navegador puede bloquear ventanas emergentes después de la primera. Permite las ventanas emergentes si se solicita.`)) return;
  activos.forEach((c, i) => setTimeout(() => waCliente(c.id), i * 900));
  toast(`Iniciando envío a ${activos.length} acreditados — permite ventanas emergentes si se solicita`, 'ok');
}

/* ============================================================
   RENDER DASHBOARD
============================================================ */
function renderDash() {
  const morosos = clientes.filter(c=>calcAlerta(c)==='ATRASADO');
  const activos = clientes.filter(c=>c.saldo>0);
  const capital = clientes.reduce((a,c)=>a+c.monto,0);
  const saldoTotal = clientes.reduce((a,c)=>a+c.saldo,0);
  const qCobro = activos.reduce((a,c)=>a+c.pq,0);
  const qKey = curQKey();
  const cobrado = Math.max(0, historial
    .filter(h=>h.qKey===qKey)
    .reduce((a,h)=>h.accion==='PAGO' ? a+(h.monto||0) : h.accion==='REVERSO' ? a-(h.monto||0) : a, 0));

  set('s-total', clientes.length);
  set('s-activos', activos.length);
  set('s-capital', '$'+capital.toLocaleString('es-MX'));
  set('s-morosos', morosos.length);
  set('s-saldo', '$'+saldoTotal.toLocaleString('es-MX'));
  set('s-qcobro', '$'+qCobro.toLocaleString('es-MX'));
  set('s-cobrado', '$'+cobrado.toLocaleString('es-MX'));
  set('dash-date', new Date().toLocaleDateString('es-MX',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));

  // Badge sidebar + título dinámico
  const nb = document.getElementById('nb-late');
  morosos.length > 0 ? (nb.textContent=morosos.length, nb.style.display='') : nb.style.display='none';
  document.title = morosos.length ? `⚠️ ${morosos.length} morosos · HD Crédit` : 'HD Crédit — Control de Pagos';

  // Morosos
  const ml = document.getElementById('d-morosos');
  ml.innerHTML = morosos.length ? morosos.slice(0,6).map(c=>`
    <div class="mi">
      <div class="mav">${esc((c.nombre||'?')[0])}</div>
      <div><div class="mn">${esc(c.nombre||'—')}</div><div class="md">$${(c.saldo||0).toLocaleString('es-MX')} · ${(c.nq||0)-(c.pagadas||0)}Q rest.</div></div>
      ${c.telefono?`<button class="btn btn-wa btn-sm btn-ic" onclick="waCliente('${c.id}')" style="margin-left:auto"><i class="fab fa-whatsapp"></i></button>`:''}
    </div>`).join('')
    : '<p style="color:var(--muted);font-size:.84rem;text-align:center;padding:18px">✅ Sin morosos</p>';

  // Próximos
  const prox = clientes.filter(c=>c.saldo>0&&(c.nq-c.pagadas)<=2).sort((a,b)=>a.pagadas-b.pagadas);
  const pl = document.getElementById('d-prox');
  pl.innerHTML = prox.length ? prox.slice(0,5).map(c=>`
    <div class="mi">
      <div class="mav" style="background:rgba(255,184,0,.14);border-color:rgba(255,184,0,.3);color:var(--warn)">${esc((c.nombre||'?')[0])}</div>
      <div><div class="mn">${esc(c.nombre||'—')}</div><div style="font-size:.73rem;color:var(--warn);font-family:'DM Mono',monospace">${(c.nq||0)-(c.pagadas||0)}Q restantes</div></div>
      <span class="badge by" style="margin-left:auto">${(c.nq||0)-(c.pagadas||0)}Q</span>
    </div>`).join('')
    : '<p style="color:var(--muted);font-size:.84rem;text-align:center;padding:18px">Sin vencimientos próximos</p>';

  // Mini chart
  const qs = getQuincenas(6);
  const vals = qs.map(q => Math.max(0, historial.filter(h=>h.qKey===q.key).reduce((a,h)=>h.accion==='PAGO' ? a+(h.monto||0) : h.accion==='REVERSO' ? a-(h.monto||0) : a, 0)));
  const mx = Math.max(...vals, 1);
  document.getElementById('d-chart').innerHTML = qs.map((q,i)=>`
    <div class="bc">
      <div class="bv" style="height:${Math.max(8,(vals[i]/mx)*130)}px" title="$${vals[i].toLocaleString('es-MX')}"></div>
      <div class="bl">${q.label.split('·')[0].trim()}</div>
    </div>`).join('');
}

/* ============================================================
   RENDER CLIENTES
============================================================ */
function renderC(list) {
  const data = list || clientes;
  const tb = document.getElementById('tb-c');
  if (!data.length) { tb.innerHTML='<tr><td colspan="12" style="text-align:center;padding:28px;color:var(--muted)">Sin acreditados</td></tr>'; return; }
  tb.innerHTML = data.map((c,i)=>{
    const pct = c.nq ? Math.round(((c.pagadas||0)/c.nq)*100) : 0;
    const est = c.saldo===0?'liq':calcAlerta(c)==='ATRASADO'?'at':'ok';
    const eb = est==='liq'?'<span class="badge bi">Liquidado</span>'
      :est==='at'?'<span class="badge br">⚠ Atrasado</span>'
      :'<span class="badge bg">✓ Al corriente</span>';
    const esNuevo = (c.pagadas||0) === 0 && (c.saldo||0) > 0;
    const badgeNuevo = esNuevo ? '<span class="badge bnn" style="margin-left:5px;font-size:.62rem;vertical-align:middle"><i class="fas fa-certificate" style="font-size:.55rem;margin-right:2px"></i>Nuevo</span>' : '';
    const fv = calcVenc(c.inicio, c.nq, c.producto);
    const iniLabel = c.inicio ? new Date(c.inicio+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
    const elapsed = c.inicio ? qsElapsed(c.inicio, c.producto) : 0;
    const iniTitle = c.inicio ? esc(`Inicio: ${c.inicio} | Q esperadas: ${Math.min(elapsed,c.nq)} | Q pagadas: ${c.pagadas||0}`).replace(/"/g,'&quot;') : 'Sin fecha de inicio';
    return `<tr>
      <td><span style="font-family:'DM Mono',monospace;color:var(--muted)">${String(i+1).padStart(2,'0')}</span></td>
      <td><strong>${esc(c.nombre||'—')}</strong>${badgeNuevo}</td>
      <td><span style="font-family:'DM Mono',monospace;color:var(--accent)">$${c.monto.toLocaleString('es-MX')}</span></td>
      <td><span style="font-family:'DM Mono',monospace">$${c.pq.toLocaleString('es-MX')}</span></td>
      <td><span class="badge bb">${plazoLabel(c)}</span></td>
      <td><span style="font-family:'DM Mono',monospace">${c.producto==='unico_30d' ? (c.pagadas>=1?'Pagado':'Pendiente') : `${c.pagadas}/${c.nq}`}</span></td>
      <td><div class="pb"><div class="pf ${pct<50?'d':pct<80?'w':''}" style="width:${pct}%"></div></div></td>
      <td><span style="font-family:'DM Mono',monospace;color:${c.saldo>0?'var(--warn)':'var(--accent)'}">$${c.saldo.toLocaleString('es-MX')}</span></td>
      <td>${eb}</td>
      <td title="${iniTitle}"><span style="font-family:'DM Mono',monospace;font-size:.76rem;color:var(--muted)">${iniLabel}</span></td>
      <td><span style="font-family:'DM Mono',monospace;font-size:.76rem;color:var(--muted)">${fv}</span></td>
      <td><div style="display:flex;gap:5px">
        ${c.producto==='unico_30d' ? (c.saldo>0
          ? `<button class="btn btn-s btn-sm btn-ic" data-pago="${c.id}_0" onclick="initPago('${c.id}',0)" title="Toca 2 veces para marcar pagado" style="color:var(--accent)"><i class="far fa-circle"></i></button>`
          : `<button class="btn btn-s btn-sm btn-ic" onclick="openReverso('${c.id}')" title="Pagado · clic para revertir" style="color:var(--accent)"><i class="fas fa-check"></i></button>`) : ''}
        <button class="btn btn-s btn-sm btn-ic" onclick="openReporte('${c.id}')" title="Reporte Personal" style="color:var(--purple)"><i class="fas fa-clipboard-list"></i></button>
        <button class="btn btn-s btn-sm btn-ic" onclick="openEC('${c.id}')" title="Estado de cuenta"><i class="fas fa-file-invoice"></i></button>
        <button class="btn btn-s btn-sm btn-ic" onclick="editC('${c.id}')" title="Editar"><i class="fas fa-edit"></i></button>
        ${c.telefono?`<button class="btn btn-wa btn-sm btn-ic" onclick="waCliente('${c.id}')" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>`:''}
        <button class="btn btn-d btn-sm btn-ic" onclick="confirmDel('${c.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

let _filterCTimer;
function filterC() {
  clearTimeout(_filterCTimer);
  _filterCTimer = setTimeout(() => {
    const q = document.getElementById('srch-c').value.toLowerCase();
    const est = document.getElementById('flt-est').value;
    const plazo = document.getElementById('flt-plazo').value;
    const prod = document.getElementById('flt-prod').value;
    renderC(clientes.filter(c=>{
      const e = c.saldo===0?'liquidado':calcAlerta(c)==='ATRASADO'?'atrasado':'al_corriente';
      return (c.nombre||'').toLowerCase().includes(q)
        && (!est||e===est)
        && (!plazo||String(c.nq)===plazo)
        && (!prod||(c.producto||'quincenal_fijo')===prod);
    }));
  }, 180);
}

function calcVenc(inicio, nq, producto = 'quincenal_fijo') {
  if (!inicio||!nq) return '—';
  const d = getQDueDate(inicio, nq - 1, producto);
  if (!d) return '—';
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'2-digit'});
}

/* ============================================================
   DOBLE TOQUE + DESHACER
============================================================ */
async function initPago(cid, qIdx) {
  const key = cid + '_' + qIdx;
  const btn = document.querySelector(`[data-pago="${key}"]`);
  if (_pendingPago[key]) {
    // segundo toque — confirmar
    clearTimeout(_pendingPago[key]);
    delete _pendingPago[key];
    if (btn) { btn.classList.remove('confirming'); btn.innerHTML = _pendingOrigHtml[key] || ''; }
    delete _pendingOrigHtml[key];
    await togglePago(cid, qIdx);
  } else {
    // primer toque — pedir confirmación visual
    if (!btn) return;
    _pendingOrigHtml[key] = btn.innerHTML;
    btn.classList.add('confirming');
    btn.innerHTML = '<i class="fas fa-question"></i>';
    _pendingPago[key] = setTimeout(() => {
      delete _pendingPago[key];
      const freshBtn = document.querySelector(`[data-pago="${key}"]`);
      if (freshBtn) {
        freshBtn.classList.remove('confirming');
        freshBtn.innerHTML = _pendingOrigHtml[key] || '';
      }
      delete _pendingOrigHtml[key];
    }, 2500);
  }
}

function showUndo(nombre, wasPago) {
  const existing = document.getElementById('undo-bar');
  if (existing) { clearTimeout(Number(existing.dataset.timer)); existing.remove(); }
  const bar = document.createElement('div');
  bar.id = 'undo-bar';
  bar.innerHTML = `
    <span class="undo-msg">${wasPago ? '✅' : '↩️'} <strong>${esc(nombre)}</strong> — ${wasPago ? 'cobrado' : 'revertido'}</span>
    <button class="undo-btn" onclick="undoLastPago()"><i class="fas fa-undo"></i> Deshacer</button>
    <div class="undo-prog"></div>`;
  const container = document.getElementById('cl-items');
  if (container) container.parentNode.insertBefore(bar, container);
  const t = setTimeout(() => { const b = document.getElementById('undo-bar'); if(b) b.remove(); }, 8000);
  bar.dataset.timer = String(t);
}

async function undoLastPago() {
  if (!_lastPago) return;
  const bar = document.getElementById('undo-bar');
  if (bar) { clearTimeout(Number(bar.dataset.timer)); bar.remove(); }
  _undoing = true;
  try { await togglePago(_lastPago.cid, _lastPago.qIdx); } finally { _undoing = false; }
  _lastPago = null;
  toast('↩️ Acción deshecha', 'wrn');
}

/* ============================================================
   RENDER CHECKLIST
============================================================ */
function renderCL() {
  const qKey = document.getElementById('qsel').value;
  // Calcular isPaid por adelantado para poder ordenar
  const activos = clientes
    // El checklist está organizado por quincena — el préstamo a 30 días no
    // pertenece a ninguna en particular, se cobra desde Acreditados/Morosos
    .filter(c => (c.saldo > 0 || c.pagadas < c.nq) && (c.producto||'quincenal_fijo') !== 'unico_30d')
    .map(c => ({...c, _isPaid: (() => { const h = historial.find(e => e.clienteId===c.id && e.qKey===qKey); return h?.accion === 'PAGO'; })() }))
    .sort((a, b) => {
      if (a._isPaid === b._isPaid) return 0;
      return a._isPaid ? 1 : -1; // pagados van al final
    });
  let pagados = 0;
  const html = activos.map((c,i)=>{
    const isPaid = c._isPaid;
    if(isPaid) pagados++;
    const isLate = calcAlerta(c)==='ATRASADO';
    const esNuevo = (c.pagadas||0) === 0 && (c.saldo||0) > 0;
    const cls = isPaid?'ck':isLate?'lt':'u';
    const ico = isPaid?'fas fa-check':isLate?'fas fa-exclamation':'far fa-circle';
    // Usar la primera quincena sin pagar (no necesariamente c.pagadas, que puede apuntar a una ya pagada tras un reverso)
    const _pagosArr = c.pagos || Array(c.nq).fill(false).map((_,j) => j < (c.pagadas||0));
    const _nextIdx = _pagosArr.findIndex(p => !p);
    const nextQIdx = _nextIdx >= 0 ? _nextIdx : (c.pagadas||0);
    return `<div class="ci${isPaid?' paid':''}">
      <div class="cn">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="cname">${esc(c.nombre||'—')}</div>
        ${esNuevo ? `<span class="badge bnn" style="font-size:.62rem;padding:1px 7px;margin-bottom:1px;display:inline-flex;align-items:center"><i class="fas fa-certificate" style="font-size:.55rem;margin-right:3px"></i>Cliente Nuevo</span>` : ''}
        <div style="font-size:.7rem;margin-top:2px">${isPaid?'<span style="color:var(--accent);font-weight:700">✓ Cobrado esta quincena</span>':`<span style="color:var(--muted)">${c.pagadas||0}/${c.nq}Q · ${c.nq-(c.pagadas||0)} restantes</span>`}</div>
      </div>
      <div class="cdet">$${(c.saldo||0).toLocaleString('es-MX')}<br><span style="font-size:.68rem;color:var(--muted)">saldo</span></div>
      <div class="camt">$${(c.pq||0).toLocaleString('es-MX')}</div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
        ${isPaid
          ?`<button class="pb2 ck" onclick="openReverso('${c.id}')" title="Cobrado · clic para retroceder pago"><i class="fas fa-check"></i></button>`
          :`<button class="pb2 ${cls}" data-pago="${c.id}_${nextQIdx}" onclick="initPago('${c.id}',${nextQIdx})" title="Toca 2 veces para cobrar"><i class="${ico}"></i></button>`}
        <button class="pb2 u" onclick="openReporte('${c.id}')" title="Morosos y Recargos" style="width:30px;height:30px;font-size:.72rem"><i class="fas fa-clipboard-list" style="color:var(--purple)"></i></button>
        <button class="pb2 u" onclick="openReverso('${c.id}')" title="Retroceder pago" style="width:30px;height:30px;font-size:.72rem"><i class="fas fa-undo" style="color:var(--danger)"></i></button>
        <button class="pb2 u" onclick="openEC('${c.id}')" title="Estado de cuenta" style="width:30px;height:30px;font-size:.72rem"><i class="fas fa-file-invoice" style="color:var(--info)"></i></button>
        ${c.telefono?`<button class="pb2 u" onclick="waCliente('${c.id}')" title="WhatsApp" style="width:30px;height:30px;font-size:.72rem"><i class="fab fa-whatsapp" style="color:#25d366"></i></button>`:''}
      </div>
    </div>`;
  }).join('') || '<div style="padding:32px;text-align:center;color:var(--muted)">Sin acreditados activos</div>';
  document.getElementById('cl-items').innerHTML = html;
  const total = activos.length;
  const pct = total ? Math.round((pagados/total)*100) : 0;
  document.getElementById('cl-prog').textContent = `${pagados} / ${total} cobrados`;
  document.getElementById('cl-pct').textContent = pct + '%';
  const bar = document.getElementById('cl-bar');
  bar.style.width = pct + '%';
  bar.className = 'pf ' + (pct<50?'d':pct<80?'w':'');
}

/* ============================================================
   RENDER HISTORIAL
============================================================ */
function renderH(list) {
  const filtrando = !!list;
  const data = (list||historial).slice(0,300);
  const tb = document.getElementById('tb-h');
  tb.innerHTML = data.length ? data.map(h=>`<tr>
    <td><strong>${esc(h.nombre||'—')}</strong></td>
    <td><span style="font-family:'DM Mono',monospace;color:var(--accent)">$${(h.monto||0).toLocaleString('es-MX')}</span></td>
    <td><span style="font-family:'DM Mono',monospace;font-size:.76rem">${esc(h.qKey||'—')}</span></td>
    <td>${esc(h.fecha||'—')}</td>
    <td style="font-family:'DM Mono',monospace;font-size:.75rem;color:var(--muted)">${esc(h.hora||'—')}</td>
    <td><span class="badge ${h.accion==='PAGO'?'bg':'by'}">${esc(h.accion||'—')}</span></td>
  </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted)">Sin registros</td></tr>';

  // Botón "Cargar historial anterior": solo aplica a la lista completa (sin
  // filtro de búsqueda) y mientras haya páginas viejas fuera de la ventana
  // en vivo por traer desde Firestore
  const wrap = document.getElementById('h-mas');
  if (wrap) {
    wrap.style.display = (!filtrando && USE_FB && _histHayMas) ? '' : 'none';
    const btn = document.getElementById('h-mas-btn');
    if (btn) {
      btn.disabled = _histCargando;
      btn.innerHTML = _histCargando
        ? '<i class="fas fa-spinner fa-spin"></i> Cargando…'
        : '<i class="fas fa-history"></i> Cargar historial anterior';
    }
  }
}

let _filterHTimer;
function filterH() {
  clearTimeout(_filterHTimer);
  _filterHTimer = setTimeout(() => {
    const q = document.getElementById('srch-h').value.toLowerCase();
    renderH(historial.filter(h=>(h.nombre||'').toLowerCase().includes(q)));
  }, 180);
}

/* ============================================================
   RENDER REPORTES
============================================================ */
function renderRep() {
  const cap = clientes.reduce((a,c)=>a+c.monto,0);
  const saldoT = clientes.reduce((a,c)=>a+c.saldo,0);
  const morosos = clientes.filter(c=>calcAlerta(c)==='ATRASADO').length;
  document.getElementById('rep-stats').innerHTML = `
    <div class="sc"><div class="si"><i class="fas fa-users"></i></div><div class="sv">${clientes.length}</div><div class="sl">Total Acreditados</div></div>
    <div class="sc w"><div class="si"><i class="fas fa-money-bill"></i></div><div class="sv">$${cap.toLocaleString('es-MX')}</div><div class="sl">Capital Total</div></div>
    <div class="sc d"><div class="si"><i class="fas fa-exclamation"></i></div><div class="sv">${morosos}</div><div class="sl">Morosos</div></div>
    <div class="sc i"><div class="si"><i class="fas fa-coins"></i></div><div class="sv">$${saldoT.toLocaleString('es-MX')}</div><div class="sl">Saldo por Cobrar</div></div>`;
  document.getElementById('tb-rep').innerHTML = clientes.map(c=>{
    const est = c.saldo===0?'Liquidado':calcAlerta(c)==='ATRASADO'?'Atrasado':'Activo';
    const bc = est==='Liquidado'?'bi':est==='Atrasado'?'br':'bg';
    return `<tr>
      <td><strong>${esc(c.nombre)}</strong></td>
      <td style="font-family:'DM Mono',monospace">$${c.monto.toLocaleString('es-MX')}</td>
      <td style="font-family:'DM Mono',monospace">${c.pagadas}/${c.nq}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--warn)">$${c.saldo.toLocaleString('es-MX')}</td>
      <td><span class="badge ${bc}">${est}</span></td>
    </tr>`;
  }).join('');
}

/* ============================================================
   TABLA FACTORES
============================================================ */
function renderTF() {
  const ms = [1000,2000,3000,4000,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000];
  document.getElementById('tb-f').innerHTML = ms.map(m=>`<tr>
    <td><strong style="font-family:'DM Mono',monospace">$${m.toLocaleString('es-MX')}</strong></td>
    <td style="font-family:'DM Mono',monospace;color:var(--accent)">$${TF[m][6]}</td>
    <td style="font-family:'DM Mono',monospace">$${TF[m][8]}</td>
    <td style="font-family:'DM Mono',monospace">$${TF[m][10]}</td>
    <td style="font-family:'DM Mono',monospace">${TF[m][12]?'$'+TF[m][12]:'<span class="badge bb">N/A</span>'}</td>
    <td><span class="badge bg">+${Math.round(((TF[m][6]*6-m)/m)*100)}%</span></td>
  </tr>`).join('');

  const ms30 = Object.keys(TF30).map(Number).sort((a,b)=>a-b);
  document.getElementById('tb-f30').innerHTML = ms30.map(m=>`<tr>
    <td><strong style="font-family:'DM Mono',monospace">$${m.toLocaleString('es-MX')}</strong></td>
    <td style="font-family:'DM Mono',monospace;color:var(--accent)">$${TF30[m].toLocaleString('es-MX')}</td>
    <td><span class="badge bg">+${Math.round(((TF30[m]-m)/m)*100)}%</span></td>
  </tr>`).join('');
}

