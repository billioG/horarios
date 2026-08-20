// WebAuthn (huella) — atado al dispositivo, nunca sale de este navegador.
const RP_NAME = 'Control de Asistencia';

function bufToBase64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function base64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }
function randomChallenge() { return crypto.getRandomValues(new Uint8Array(32)); }
function soporteWebAuthn() { return !!(window.PublicKeyCredential && navigator.credentials); }

async function registrarHuella(nombre, empleadoIdUuid) {
  const userId = new TextEncoder().encode(empleadoIdUuid).slice(0, 64);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: RP_NAME },
      user: { id: userId, name: nombre, displayName: nombre },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('No se pudo crear la credencial.');
  return bufToBase64(cred.rawId);
}

async function verificarHuella(credentialIdB64) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: base64ToBuf(credentialIdB64), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!assertion;
}

// ---- utilidades ----
const $ = (sel) => document.querySelector(sel);
const estadoEl = $('#estado');

function fmtFecha(iso) {
  return new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' });
}
function mostrarEstado(msg, tipo = 'info') {
  estadoEl.textContent = msg;
  estadoEl.className = 'estado ' + tipo;
}
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ---- sincronización con la nube ----
async function sincronizar() {
  if (!nubeDisponible()) return;
  try {
    const [empleados, horarios] = await Promise.all([nubeListarEmpleados(), nubeListarTodosHorarios()]);
    await cachearEmpleados(empleados);
    await cachearHorarios(horarios);

    const cola = await listarCola();
    for (const registro of cola) {
      try {
        await nubeInsertarRegistro(registro);
        await quitarDeCola(registro.id);
      } catch (err) {
        console.error('No se pudo sincronizar registro pendiente', err);
      }
    }
  } catch (err) {
    console.error('Sincronización falló', err);
  }
}

// ---- Tab: Marcar ----
const vistaEmpleados = $('#lista-empleados');
const formNuevo = $('#form-nuevo');
const inputNombre = $('#input-nombre');

async function refrescarEmpleados() {
  const empleados = await obtenerEmpleadosCache();
  const credenciales = await listarCredencialesLocales();
  const credPorEmpleado = Object.fromEntries(credenciales.map(c => [c.empleadoId, c.credentialId]));

  vistaEmpleados.innerHTML = '';
  if (empleados.length === 0) {
    vistaEmpleados.innerHTML = '<p class="vacio">Sin empleados registrados todavía.</p>';
    return;
  }
  for (const emp of empleados.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const registros = await obtenerRegistrosCache({ empleadoId: emp.id });
    const ultimo = registros[0] || null;
    const proximo = !ultimo || ultimo.tipo === 'salida' ? 'entrada' : 'salida';
    const cred = credPorEmpleado[emp.id];

    const card = document.createElement('div');
    card.className = 'card-empleado';
    card.innerHTML = `
      <div class="fila-top">
        <strong>${emp.nombre}</strong>
        <button class="btn-borrar" data-id="${emp.id}" title="Eliminar empleado">✕</button>
      </div>
      <div class="fila-estado">Último: ${ultimo ? `${ultimo.tipo} · ${fmtFecha(ultimo.marca)}` : '—'}</div>
      ${cred
        ? `<button class="btn-marcar ${proximo}" data-id="${emp.id}" data-cred="${cred}" data-tipo="${proximo}">👆 Marcar ${proximo}</button>`
        : `<button class="btn-vincular" data-id="${emp.id}" data-nombre="${emp.nombre}">🔗 Vincular huella en este dispositivo</button>`
      }
    `;
    vistaEmpleados.appendChild(card);
  }
}

formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = inputNombre.value.trim();
  if (!nombre) return;
  if (!soporteWebAuthn()) return mostrarEstado('Este navegador no soporta huella (WebAuthn).', 'error');
  if (!nubeDisponible()) return mostrarEstado('Se necesita conexión a internet para dar de alta un empleado nuevo.', 'error');
  try {
    const emp = await nubeCrearEmpleado(nombre);
    mostrarEstado('Coloca tu huella para registrarte…', 'info');
    const credentialId = await registrarHuella(nombre, emp.id);
    await guardarCredencialLocal(emp.id, credentialId, nombre);
    await cachearEmpleados([emp]);
    inputNombre.value = '';
    mostrarEstado(`Huella registrada para ${nombre}.`, 'ok');
    await refrescarEmpleados();
  } catch (err) {
    console.error(err);
    mostrarEstado('No se pudo registrar: ' + err.message, 'error');
  }
});

vistaEmpleados.addEventListener('click', async (e) => {
  const btnMarcar = e.target.closest('.btn-marcar');
  const btnBorrar = e.target.closest('.btn-borrar');
  const btnVincular = e.target.closest('.btn-vincular');

  if (btnMarcar) {
    const empleado_id = btnMarcar.dataset.id;
    const cred = btnMarcar.dataset.cred;
    const tipo = btnMarcar.dataset.tipo;
    try {
      mostrarEstado('Verifica tu huella…', 'info');
      const ok = await verificarHuella(cred);
      if (!ok) throw new Error('Verificación fallida.');
      const registro = { id: uuid(), empleado_id, tipo, marca: new Date().toISOString() };
      await cachearRegistro(registro);
      if (nubeDisponible()) {
        try { await nubeInsertarRegistro(registro); }
        catch (err) { console.error(err); await encolarRegistro(registro); }
      } else {
        await encolarRegistro(registro);
      }
      mostrarEstado(`Marca de ${tipo} registrada${nubeDisponible() ? '' : ' (guardada, se subirá al recuperar conexión)'}.`, 'ok');
      await refrescarEmpleados();
    } catch (err) {
      console.error(err);
      mostrarEstado('No se pudo verificar la huella: ' + err.message, 'error');
    }
  }

  if (btnVincular) {
    const id = btnVincular.dataset.id;
    const nombre = btnVincular.dataset.nombre;
    try {
      mostrarEstado('Coloca tu huella para vincular este dispositivo…', 'info');
      const credentialId = await registrarHuella(nombre, id);
      await guardarCredencialLocal(id, credentialId, nombre);
      mostrarEstado(`Huella vinculada para ${nombre} en este dispositivo.`, 'ok');
      await refrescarEmpleados();
    } catch (err) {
      console.error(err);
      mostrarEstado('No se pudo vincular: ' + err.message, 'error');
    }
  }

  if (btnBorrar) {
    const id = btnBorrar.dataset.id;
    if (!nubeDisponible()) return mostrarEstado('Se necesita conexión para eliminar un empleado.', 'error');
    if (confirm('¿Eliminar este empleado, su horario y su historial? Esto no se puede deshacer.')) {
      await nubeBorrarEmpleado(id);
      await borrarCredencialLocal(id);
      await quitarEmpleadoCache(id);
      await refrescarEmpleados();
    }
  }
});

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activa'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('activa'));
    btn.classList.add('activa');
    document.querySelector(`#tab-${btn.dataset.tab}`).classList.add('activa');
    if (btn.dataset.tab === 'horarios') cargarSelectorHorarios();
    if (btn.dataset.tab === 'reportes') cargarSelectorReportes();
  });
});

// ---- arranque ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}
window.addEventListener('online', async () => { mostrarEstado('Conexión recuperada, sincronizando…', 'info'); await sincronizar(); await refrescarEmpleados(); mostrarEstado('Sincronizado.', 'ok'); });

if (!soporteWebAuthn()) {
  mostrarEstado('Advertencia: este navegador/contexto no soporta huella (WebAuthn). Abre la app por https:// o http://localhost.', 'error');
} else if (!nubeConfigurada()) {
  mostrarEstado('Advertencia: falta configurar FUNCTION_URL (config.js). Funcionando solo con datos locales de este dispositivo.', 'error');
}

(async () => {
  await sincronizar();
  await refrescarEmpleados();
})();
