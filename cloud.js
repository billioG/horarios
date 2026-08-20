// Capa de nube: llama a la Edge Function "asistencia" por HTTP.
// El frontend no conoce URL real de Supabase ni ninguna key — solo este endpoint
// público. Si FUNCTION_URL no está configurado (config.js), la app sigue
// funcionando en modo degradado, solo con el caché local de este dispositivo.

function nubeConfigurada() {
  return !!FUNCTION_URL;
}
function nubeDisponible() {
  return nubeConfigurada() && navigator.onLine;
}

async function llamarFuncion(ruta, opciones = {}) {
  const resp = await fetch(`${FUNCTION_URL}${ruta}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Error ${resp.status}`);
  return data;
}

// ---- Empleados ----
async function nubeCrearEmpleado(nombre, pin) {
  return llamarFuncion('/empleados', { method: 'POST', body: JSON.stringify({ nombre, pin }) });
}
async function nubeListarEmpleados() {
  return llamarFuncion('/empleados');
}
async function nubeBorrarEmpleado(id) {
  return llamarFuncion(`/empleados/${id}`, { method: 'DELETE' });
}
async function nubeActualizarPin(id, pin) {
  return llamarFuncion(`/empleados/${id}`, { method: 'PATCH', body: JSON.stringify({ pin }) });
}

// ---- Horarios ----
async function nubeGuardarHorarios(empleadoId, dias, autorizador) {
  return llamarFuncion(`/horarios/${empleadoId}`, { method: 'PUT', body: JSON.stringify({ dias, autorizador }) });
}
async function nubeListarHorarios(empleadoId) {
  return llamarFuncion(`/horarios?empleado_id=${encodeURIComponent(empleadoId)}`);
}
async function nubeListarTodosHorarios() {
  return llamarFuncion('/horarios');
}

// ---- Registros ----
async function nubeInsertarRegistro(registro) {
  return llamarFuncion('/registros', { method: 'POST', body: JSON.stringify(registro) });
}
async function nubeListarRegistros({ empleadoId = null, desde = null, hasta = null, autorizador = null } = {}) {
  const params = new URLSearchParams();
  if (empleadoId) params.set('empleado_id', empleadoId);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (!empleadoId && autorizador) {
    params.set('autorizador_id', autorizador.id);
    params.set('autorizador_pin', autorizador.pin);
  }
  const qs = params.toString();
  return llamarFuncion(`/registros${qs ? '?' + qs : ''}`);
}
