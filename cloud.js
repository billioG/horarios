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
async function nubeCrearEmpleado(nombre) {
  return llamarFuncion('/empleados', { method: 'POST', body: JSON.stringify({ nombre }) });
}
async function nubeListarEmpleados() {
  return llamarFuncion('/empleados');
}
async function nubeBorrarEmpleado(id) {
  return llamarFuncion(`/empleados/${id}`, { method: 'DELETE' });
}

// ---- Horarios ----
async function nubeGuardarHorarios(empleadoId, dias) {
  return llamarFuncion(`/horarios/${empleadoId}`, { method: 'PUT', body: JSON.stringify({ dias }) });
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
async function nubeListarRegistros({ empleadoId = null, desde = null, hasta = null } = {}) {
  const params = new URLSearchParams();
  if (empleadoId) params.set('empleado_id', empleadoId);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const qs = params.toString();
  return llamarFuncion(`/registros${qs ? '?' + qs : ''}`);
}
