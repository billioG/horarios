const DIAS = [
  { n: 1, label: 'Lunes' }, { n: 2, label: 'Martes' }, { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' }, { n: 5, label: 'Viernes' }, { n: 6, label: 'Sábado' }, { n: 7, label: 'Domingo' },
];

const selHorarioEmpleado = document.querySelector('#horario-empleado');
const filasHorario = document.querySelector('#filas-horario');
const btnGuardarHorario = document.querySelector('#btn-guardar-horario');

async function cargarSelectorHorarios() {
  const empleados = await obtenerEmpleadosCache();
  const actual = selHorarioEmpleado.value;
  selHorarioEmpleado.innerHTML = empleados
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  if (empleados.length === 0) {
    filasHorario.innerHTML = '<p class="vacio">Da de alta empleados primero, en la pestaña Marcar.</p>';
    return;
  }
  selHorarioEmpleado.value = actual || empleados[0].id;
  await renderFilasHorario();
}

async function renderFilasHorario() {
  const empleadoId = selHorarioEmpleado.value;
  if (!empleadoId) return;
  let horarios = [];
  if (nubeDisponible()) {
    try { horarios = await nubeListarHorarios(empleadoId); await cachearHorarios(horarios); }
    catch (err) { console.error(err); horarios = await obtenerHorariosCache(empleadoId); }
  } else {
    horarios = await obtenerHorariosCache(empleadoId);
  }
  const porDia = Object.fromEntries(horarios.map(h => [h.dia_semana, h]));

  filasHorario.innerHTML = DIAS.map(d => {
    const h = porDia[d.n];
    const libre = !h || (!h.hora_entrada && !h.hora_salida);
    return `
      <div class="fila-horario" data-dia="${d.n}">
        <span class="dia-label">${d.label}</span>
        <input type="time" class="hora-entrada" value="${h?.hora_entrada?.slice(0, 5) || ''}" ${libre ? 'disabled' : ''}>
        <span>–</span>
        <input type="time" class="hora-salida" value="${h?.hora_salida?.slice(0, 5) || ''}" ${libre ? 'disabled' : ''}>
        <label class="chk-libre"><input type="checkbox" class="check-libre" ${libre ? 'checked' : ''}> Libre</label>
      </div>
    `;
  }).join('');
}

filasHorario.addEventListener('change', (e) => {
  if (!e.target.classList.contains('check-libre')) return;
  const fila = e.target.closest('.fila-horario');
  const libre = e.target.checked;
  fila.querySelector('.hora-entrada').disabled = libre;
  fila.querySelector('.hora-salida').disabled = libre;
  if (libre) { fila.querySelector('.hora-entrada').value = ''; fila.querySelector('.hora-salida').value = ''; }
});

selHorarioEmpleado.addEventListener('change', renderFilasHorario);

btnGuardarHorario.addEventListener('click', async () => {
  const empleadoId = selHorarioEmpleado.value;
  if (!empleadoId) return;
  if (!nubeDisponible()) return mostrarEstado('Se necesita conexión para guardar horarios.', 'error');
  const dias = [...filasHorario.querySelectorAll('.fila-horario')].map(fila => {
    const libre = fila.querySelector('.check-libre').checked;
    return {
      dia_semana: Number(fila.dataset.dia),
      hora_entrada: libre ? null : (fila.querySelector('.hora-entrada').value || null),
      hora_salida: libre ? null : (fila.querySelector('.hora-salida').value || null),
    };
  });
  try {
    await nubeGuardarHorarios(empleadoId, dias, sesionActual);
    await cachearHorarios(dias.map(d => ({ ...d, empleado_id: empleadoId })));
    mostrarEstado('Horario guardado.', 'ok');
  } catch (err) {
    console.error(err);
    mostrarEstado('No se pudo guardar el horario: ' + err.message, 'error');
  }
});
