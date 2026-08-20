const selReporteEmpleado = document.querySelector('#reporte-empleado');
const inputDesde = document.querySelector('#reporte-desde');
const inputHasta = document.querySelector('#reporte-hasta');
const btnGenerarReporte = document.querySelector('#btn-generar-reporte');
const btnExportarReporte = document.querySelector('#btn-exportar-reporte');
const contenedorReporte = document.querySelector('#contenedor-reporte');

let ultimoReporte = null; // guarda filas para exportar CSV

async function cargarSelectorReportes() {
  const empleados = await obtenerEmpleadosCache();
  selReporteEmpleado.innerHTML = '<option value="">Todos</option>' +
    empleados.sort((a, b) => a.nombre.localeCompare(b.nombre)).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');

  if (!inputHasta.value) {
    const hoy = new Date();
    const hace7 = new Date(hoy.getTime() - 6 * 86400000);
    inputHasta.value = hoy.toISOString().slice(0, 10);
    inputDesde.value = hace7.toISOString().slice(0, 10);
  }
}

function fechaLocalDe(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      registros = await nubeListarRegistros({ empleadoId, desde, hasta });
      horarios = await nubeListarTodosHorarios();
      await cachearRegistros(registros);
    } catch (err) {
      console.error(err);
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
