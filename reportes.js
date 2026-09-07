const selReporteEmpleado = document.querySelector('#reporte-empleado');
const inputDesde = document.querySelector('#reporte-desde');
const inputHasta = document.querySelector('#reporte-hasta');
const btnGenerarReporte = document.querySelector('#btn-generar-reporte');
const btnExportarReporte = document.querySelector('#btn-exportar-reporte');
const contenedorReporte = document.querySelector('#contenedor-reporte');

let ultimoReporte = null; // guarda filas para exportar CSV
let ultimoCrudo = null; // { registros, horarios, empleados, desde, hasta } — para exportar la planilla XLSX

async function cargarSelectorReportes() {
  if (!sesionActual.es_encargado) {
    // Empleado normal: solo su propio reporte, sin selector.
    selReporteEmpleado.innerHTML = `<option value="${sesionActual.id}">${sesionActual.nombre} (tú)</option>`;
    selReporteEmpleado.disabled = true;
  } else {
    const empleados = await obtenerEmpleadosCache();
    selReporteEmpleado.disabled = false;
    selReporteEmpleado.innerHTML = '<option value="">Todos</option>' +
      empleados.sort((a, b) => a.nombre.localeCompare(b.nombre)).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  }

  if (!inputHasta.value) {
    const hoy = new Date();
    const hace7 = new Date(hoy.getTime() - 6 * 86400000);
    inputHasta.value = hoy.toISOString().slice(0, 10);
    inputDesde.value = hace7.toISOString().slice(0, 10);
  }
}

function diaSemanaISO(fechaYYYYMMDD) {
  const d = new Date(fechaYYYYMMDD + 'T12:00:00');
  const dia = d.getDay();
  return dia === 0 ? 7 : dia;
}
function horaHHMM(iso) {
  return new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function horasEntreISO(isoA, isoB) {
  return (new Date(isoB) - new Date(isoA)) / 3600000;
}
function horasEntreHHMM(hA, hB) {
  if (!hA || !hB) return 0;
  const [ha, ma] = hA.split(':').map(Number);
  const [hb, mb] = hB.split(':').map(Number);
  return Math.max(0, (hb * 60 + mb - (ha * 60 + ma)) / 60);
}
function fmtHoras(h) {
  return h.toFixed(2) + ' h';
}

btnGenerarReporte.addEventListener('click', generarReporte);

async function generarReporte() {
  const empleadoId = selReporteEmpleado.value || null;
  const desde = inputDesde.value ? `${inputDesde.value}T00:00:00` : null;
  const hasta = inputHasta.value ? `${inputHasta.value}T23:59:59` : null;

  let registros, horarios, empleados;
  empleados = await obtenerEmpleadosCache();
  if (nubeDisponible()) {
    try {
      registros = await nubeListarRegistros({ empleadoId, desde, hasta, autorizador: sesionActual });
      horarios = await nubeListarTodosHorarios();
      await cachearRegistros(registros);
    } catch (err) {
      console.error(err);
      mostrarEstado('No se pudo generar el reporte: ' + err.message, 'error');
      registros = (await obtenerRegistrosCache({ empleadoId })).filter(r => (!desde || r.marca >= desde) && (!hasta || r.marca <= hasta));
      horarios = await obtenerHorariosCache();
    }
  } else {
    registros = (await obtenerRegistrosCache({ empleadoId })).filter(r => (!desde || r.marca >= desde) && (!hasta || r.marca <= hasta));
    horarios = await obtenerHorariosCache();
  }

  const nombrePorId = Object.fromEntries(empleados.map(e => [e.id, e.nombre]));
  const horarioPorEmpleadoDia = {};
  for (const h of horarios) horarioPorEmpleadoDia[`${h.empleado_id}_${h.dia_semana}`] = h;

  // Agrupar por empleado + fecha local del registro
  const grupos = {};
  for (const r of registros.sort((a, b) => a.marca.localeCompare(b.marca))) {
    const fecha = fechaLocalDe(r.marca);
    const clave = `${r.empleado_id}_${fecha}`;
    (grupos[clave] ??= { empleado_id: r.empleado_id, fecha, marcas: [] }).marcas.push(r);
  }

  const filas = [];
  for (const g of Object.values(grupos)) {
    let trabajadas = 0, abierto = false, entradaPendiente = null;
    const horasTexto = [];
    for (const m of g.marcas) {
      horasTexto.push(`${m.tipo === 'entrada' ? '→' : '←'}${horaHHMM(m.marca)}`);
      if (m.tipo === 'entrada') {
        entradaPendiente = m.marca;
      } else if (m.tipo === 'salida' && entradaPendiente) {
        trabajadas += horasEntreISO(entradaPendiente, m.marca);
        entradaPendiente = null;
      }
    }
    if (entradaPendiente) abierto = true;

    const dow = diaSemanaISO(g.fecha);
    const h = horarioPorEmpleadoDia[`${g.empleado_id}_${dow}`];
    const programadas = h ? horasEntreHHMM(h.hora_entrada?.slice(0, 5), h.hora_salida?.slice(0, 5)) : 0;
    const extra = Math.max(0, trabajadas - programadas);

    filas.push({
      fecha: g.fecha,
      empleado: nombrePorId[g.empleado_id] || '(eliminado)',
      marcas: horasTexto.join('  '),
      trabajadas, programadas, extra, abierto,
    });
  }
  filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.empleado.localeCompare(b.empleado));

  ultimoReporte = filas;
  ultimoCrudo = { registros, horarios, empleados, desde: inputDesde.value, hasta: inputHasta.value };
  renderReporte(filas);
}

function renderReporte(filas) {
  if (filas.length === 0) {
    contenedorReporte.innerHTML = '<p class="vacio">Sin marcas en ese rango.</p>';
    return;
  }
  const totalesPorEmpleado = {};
  for (const f of filas) {
    const t = (totalesPorEmpleado[f.empleado] ??= { trabajadas: 0, extra: 0, dias: 0 });
    t.trabajadas += f.trabajadas; t.extra += f.extra; t.dias += 1;
  }

  const filasHtml = filas.map(f => `
    <div class="fila-reporte ${f.abierto ? 'abierto' : ''}">
      <span class="col-fecha">${f.fecha}</span>
      <span class="col-nombre">${f.empleado}</span>
      <span class="col-marcas">${f.marcas}${f.abierto ? ' ⚠️' : ''}</span>
      <span class="col-horas">${fmtHoras(f.trabajadas)}</span>
      <span class="col-extra">${f.extra > 0 ? '+' + fmtHoras(f.extra) : '—'}</span>
    </div>
  `).join('');

  const resumenHtml = Object.entries(totalesPorEmpleado).map(([nombre, t]) => `
    <div class="fila-resumen">
      <strong>${nombre}</strong>
      <span>${t.dias} día(s) · ${fmtHoras(t.trabajadas)} trabajadas · ${t.extra > 0 ? '+' + fmtHoras(t.extra) + ' extra' : 'sin extra'}</span>
    </div>
  `).join('');

  contenedorReporte.innerHTML = `
    <div class="cabecera-reporte">
      <span class="col-fecha">Fecha</span><span class="col-nombre">Empleado</span>
      <span class="col-marcas">Marcas</span><span class="col-horas">Horas</span><span class="col-extra">Extra</span>
    </div>
    ${filasHtml}
    <div class="resumen-reporte"><h3>Resumen del rango</h3>${resumenHtml}</div>
    <p class="nota-reporte">⚠️ = turno sin salida marcada todavía. "Extra" = horas trabajadas por encima del horario configurado ese día (día sin horario configurado cuenta todo como extra).</p>
  `;
}

// ---- Exportar planilla de pago (XLSX), mismo formato que planilla_pago_PC.xlsx ----
const btnExportarPlanilla = document.querySelector('#btn-exportar-planilla');

function enumerarFechas(desdeStr, hastaStr) {
  const fechas = [];
  const cur = new Date(desdeStr + 'T00:00:00');
  const fin = new Date(hastaStr + 'T00:00:00');
  while (cur <= fin) {
    fechas.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return fechas;
}
function formatFechaDDMMYYYY(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}
function formatHoraAMPM(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

const ENCABEZADO_PLANILLA = [
  'NOMBRE DEL EMPLEADO', '', 'FECHA', 'HORA DE\nCOMIENZO', 'HORA DE\nFINALIZACIÓN',
  'HORARIO REGULAR', 'HORAS EXTRAS', 'ENFERMO', 'DESCANSO', 'DÍA FESTIVO', 'Almuerzo/Refa', 'TOTAL DE HORAS',
];
const TARIFAS_DEFECTO = { F: 20, G: 30, H: 20, I: 20, J: 20, K: 20 };

btnExportarPlanilla.addEventListener('click', () => {
  if (typeof XLSX === 'undefined') return mostrarEstado('No se pudo cargar la librería de Excel (revisa tu conexión).', 'error');
  if (!ultimoCrudo) return mostrarEstado('Genera el reporte primero.', 'error');
  const { registros, horarios, empleados, desde, hasta } = ultimoCrudo;
  if (!desde || !hasta) return mostrarEstado('Selecciona un rango de fechas.', 'error');

  const horarioPorEmpDia = {};
  for (const h of horarios) horarioPorEmpDia[`${h.empleado_id}_${h.dia_semana}`] = h;

  const empleadoIdSel = selReporteEmpleado.value || null;
  const empleadosAExportar = empleadoIdSel ? empleados.filter(e => e.id === empleadoIdSel) : empleados;
  if (empleadosAExportar.length === 0) return mostrarEstado('No hay empleados para exportar.', 'error');

  const fechas = enumerarFechas(desde, hasta);
  const wb = XLSX.utils.book_new();
  const nombresUsados = new Set();

  for (const emp of empleadosAExportar) {
    const marcasPorFecha = {};
    for (const r of registros.filter(r => r.empleado_id === emp.id)) {
      const f = fechaLocalDe(r.marca);
      (marcasPorFecha[f] ??= []).push(r);
    }

    const regularPorDia = [], extraPorDia = [];
    const filasDatos = fechas.map((f, i) => {
      const marcas = (marcasPorFecha[f] || []).sort((a, b) => a.marca.localeCompare(b.marca));
      const entrada = marcas.find(m => m.tipo === 'entrada');
      const salida = [...marcas].reverse().find(m => m.tipo === 'salida');
      let trabajadas = 0;
      if (entrada && salida && salida.marca > entrada.marca) trabajadas = horasEntreISO(entrada.marca, salida.marca);

      const dow = diaSemanaISO(f);
      const h = horarioPorEmpDia[`${emp.id}_${dow}`];
      const programadas = h ? horasEntreHHMM(h.hora_entrada?.slice(0, 5), h.hora_salida?.slice(0, 5)) : 0;
      const extra = Math.max(0, trabajadas - programadas);
      const regular = Number((trabajadas - extra).toFixed(2));
      regularPorDia.push(regular);
      extraPorDia.push(Number(extra.toFixed(2)));

      return [
        i === 0 ? emp.nombre : '',
        '',
        formatFechaDDMMYYYY(f),
        entrada ? formatHoraAMPM(entrada.marca) : '',
        salida ? formatHoraAMPM(salida.marca) : '',
        regular > 0 ? regular : '',
        extra > 0 ? Number(extra.toFixed(2)) : '',
        '', '', '', '',
        null, // TOTAL DE HORAS: se llena como fórmula abajo
      ];
    });

    const filaInicio = 2; // primera fila de datos en Excel (fila 1 = encabezado)
    const filaFin = filaInicio + fechas.length - 1;
    const filaTotal = filaFin + 1;
    const filaTarifa = filaTotal + 1;
    const suma = (arr) => Number(arr.reduce((a, b) => a + b, 0).toFixed(2));

    const ws = XLSX.utils.aoa_to_sheet([ENCABEZADO_PLANILLA, ...filasDatos]);
    for (let i = 0; i < fechas.length; i++) {
      const fila = filaInicio + i;
      ws[`L${fila}`] = { t: 'n', f: `SUM(F${fila}:K${fila})`, v: Number((regularPorDia[i] + extraPorDia[i]).toFixed(2)) };
    }
    const totalPorCol = { F: suma(regularPorDia), G: suma(extraPorDia), H: 0, I: 0, J: 0, K: 0 };
    totalPorCol.L = Number(Object.values(totalPorCol).reduce((a, b) => a + b, 0).toFixed(2));
    XLSX.utils.sheet_add_aoa(ws, [['TOTAL DE HORAS']], { origin: `A${filaTotal}` });
    for (const col of ['F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      ws[`${col}${filaTotal}`] = { t: 'n', f: `SUM(${col}${filaInicio}:${col}${filaFin})`, v: totalPorCol[col] };
    }
    XLSX.utils.sheet_add_aoa(ws, [['TARIFA POR HORA']], { origin: `A${filaTarifa}` });
    for (const [col, valor] of Object.entries(TARIFAS_DEFECTO)) {
      ws[`${col}${filaTarifa}`] = { t: 'n', v: valor };
    }
    const totalPago = Object.entries(TARIFAS_DEFECTO).reduce((acc, [col, tarifa]) => acc + totalPorCol[col] * tarifa, 0);
    ws[`L${filaTarifa}`] = {
      t: 'n',
      f: Object.keys(TARIFAS_DEFECTO).map(c => `${c}${filaTotal}*${c}${filaTarifa}`).join('+'),
      v: Number(totalPago.toFixed(2)),
    };
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filaTarifa - 1, c: 11 } });
    ws['!cols'] = [{ wch: 26 }, { wch: 2 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 11 }];

    let nombreHoja = emp.nombre.slice(0, 31).replace(/[\\/*?:[\]]/g, ' ').trim() || 'Empleado';
    let sufijo = 2;
    while (nombresUsados.has(nombreHoja)) nombreHoja = `${emp.nombre.slice(0, 28).trim()} ${sufijo++}`;
    nombresUsados.add(nombreHoja);

    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  }

  XLSX.writeFile(wb, `planilla_pago_${desde}_a_${hasta}.xlsx`);
  mostrarEstado('Planilla de pago exportada. Las tarifas por hora vienen con valores por defecto — ajústalas en Excel según cada empleado.', 'ok');
});

btnExportarReporte.addEventListener('click', () => {
  if (!ultimoReporte || ultimoReporte.length === 0) return;
  const filasCsv = [['fecha', 'empleado', 'marcas', 'horas_trabajadas', 'horas_extra']];
  for (const f of ultimoReporte) filasCsv.push([f.fecha, f.empleado, f.marcas, f.trabajadas.toFixed(2), f.extra.toFixed(2)]);
  const csv = filasCsv.map(fila => fila.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte_${inputDesde.value}_a_${inputHasta.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
