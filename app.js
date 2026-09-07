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
function fechaLocalDe(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- modal de PIN ----
const modalPin = $('#modal-pin');
const modalPinTitulo = $('#modal-pin-titulo');
const modalPinInput = $('#modal-pin-input');
function pedirPin(titulo) {
  modalPinTitulo.textContent = titulo;
  modalPinInput.value = '';
  modalPin.classList.remove('oculto');
  modalPinInput.focus();
  return new Promise((resolve) => {
    const limpiar = () => {
      modalPin.classList.add('oculto');
      $('#modal-pin-confirmar').removeEventListener('click', onConfirmar);
      $('#modal-pin-cancelar').removeEventListener('click', onCancelar);
      modalPinInput.removeEventListener('keydown', onKeydown);
    };
    const onConfirmar = () => { const v = modalPinInput.value.trim(); limpiar(); resolve(v || null); };
    const onCancelar = () => { limpiar(); resolve(null); };
    const onKeydown = (e) => { if (e.key === 'Enter') onConfirmar(); if (e.key === 'Escape') onCancelar(); };
    $('#modal-pin-confirmar').addEventListener('click', onConfirmar);
    $('#modal-pin-cancelar').addEventListener('click', onCancelar);
    modalPinInput.addEventListener('keydown', onKeydown);
  });
}

// ---- sesión de identidad (para Horarios/Reportes en el dispositivo compartido) ----
// No es un login real: vive en memoria mientras la página esté abierta y se
// vuelve a pedir si se recarga. El PIN se guarda en esta variable (no en disco)
// porque el servidor necesita re-verificarlo en cada acción restringida.
let sesionActual = null; // { id, nombre, pin, es_encargado }

const modalSesion = $('#modal-sesion');
const modalSesionTitulo = $('#modal-sesion-titulo');
const modalSesionEmpleado = $('#modal-sesion-empleado');
const modalSesionPin = $('#modal-sesion-pin');

async function identificarse(titulo) {
  const empleados = await obtenerEmpleadosCache();
  modalSesionTitulo.textContent = titulo;
  modalSesionEmpleado.innerHTML = empleados.sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  modalSesionPin.value = '';
  modalSesion.classList.remove('oculto');
  modalSesionPin.focus();
  return new Promise((resolve) => {
    const limpiar = () => {
      modalSesion.classList.add('oculto');
      $('#modal-sesion-confirmar').removeEventListener('click', onConfirmar);
      $('#modal-sesion-cancelar').removeEventListener('click', onCancelar);
      modalSesionPin.removeEventListener('keydown', onKeydown);
    };
    const onConfirmar = async () => {
      const id = modalSesionEmpleado.value;
      const pin = modalSesionPin.value.trim();
      const emp = empleados.find(e => e.id === id);
      if (!emp || !emp.pin_hash || (await hashPin(pin, id)) !== emp.pin_hash) {
        mostrarEstado('PIN incorrecto.', 'error');
        limpiar();
        return resolve(null);
      }
      limpiar();
      resolve({ id: emp.id, nombre: emp.nombre, pin, es_encargado: !!emp.es_encargado });
    };
    const onCancelar = () => { limpiar(); resolve(null); };
    const onKeydown = (e) => { if (e.key === 'Enter') onConfirmar(); if (e.key === 'Escape') onCancelar(); };
    $('#modal-sesion-confirmar').addEventListener('click', onConfirmar);
    $('#modal-sesion-cancelar').addEventListener('click', onCancelar);
    modalSesionPin.addEventListener('keydown', onKeydown);
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
const inputPin = $('#input-pin');

async function refrescarEmpleados() {
  const empleados = await obtenerEmpleadosCache();
  const credenciales = await listarCredencialesLocales();
  const credPorEmpleado = Object.fromEntries(credenciales.map(c => [c.empleadoId, c.credentialId]));

  vistaEmpleados.innerHTML = '';
  if (empleados.length === 0) {
    vistaEmpleados.innerHTML = '<p class="vacio">Sin empleados registrados todavía.</p>';
    return;
  }
  const hoy = fechaLocalDe(new Date().toISOString());
  for (const emp of empleados.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const registros = await obtenerRegistrosCache({ empleadoId: emp.id });
    const ultimo = registros[0] || null;
    const registrosHoy = registros.filter(r => fechaLocalDe(r.marca) === hoy);
    const entradaHoy = registrosHoy.find(r => r.tipo === 'entrada');
    const salidaHoy = registrosHoy.find(r => r.tipo === 'salida');
    const jornadaCompleta = !!entradaHoy && !!salidaHoy;
    const proximo = !entradaHoy ? 'entrada' : 'salida';
    const cred = credPorEmpleado[emp.id];

    const card = document.createElement('div');
    card.className = 'card-empleado';
    card.innerHTML = `
      <div class="fila-top">
        <strong>${emp.nombre}</strong>
        <button class="btn-borrar" data-id="${emp.id}" title="Eliminar empleado">✕</button>
      </div>
      <div class="fila-estado">Último: ${ultimo ? `${ultimo.tipo} · ${fmtFecha(ultimo.marca)}` : '—'}
        <button class="btn-pin" data-id="${emp.id}" data-nombre="${emp.nombre}">🔑 ${emp.pin_hash ? 'Cambiar PIN' : 'Fijar PIN'}</button>
      </div>
      ${jornadaCompleta
        ? `<p class="jornada-completa">✅ Entrada y salida ya marcadas hoy.</p>`
        : cred
          ? `<button class="btn-marcar ${proximo}" data-id="${emp.id}" data-cred="${cred}" data-tipo="${proximo}" data-pinhash="${emp.pin_hash || ''}">👆 Marcar ${proximo}</button>`
          : `<button class="btn-vincular" data-id="${emp.id}" data-nombre="${emp.nombre}" data-pinhash="${emp.pin_hash || ''}">🔗 Vincular huella en este dispositivo</button>`
      }
    `;
    vistaEmpleados.appendChild(card);
  }
}

formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = inputNombre.value.trim();
  const pin = inputPin.value.trim();
  if (!nombre) return;
  if (!/^\d{4,6}$/.test(pin)) return mostrarEstado('El PIN debe tener de 4 a 6 dígitos.', 'error');
  if (!soporteWebAuthn()) return mostrarEstado('Este navegador no soporta huella (WebAuthn).', 'error');
  if (!nubeDisponible()) return mostrarEstado('Se necesita conexión a internet para dar de alta un empleado nuevo.', 'error');
  try {
    const emp = await nubeCrearEmpleado(nombre, pin);
    mostrarEstado('Coloca tu huella para registrarte…', 'info');
    const credentialId = await registrarHuella(nombre, emp.id);
    await guardarCredencialLocal(emp.id, credentialId, nombre);
    await cachearEmpleados([emp]);
    inputNombre.value = '';
    inputPin.value = '';
    mostrarEstado(`Huella y PIN registrados para ${nombre}.`, 'ok');
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
  const btnPin = e.target.closest('.btn-pin');

  if (btnPin) {
    const id = btnPin.dataset.id;
    const nombre = btnPin.dataset.nombre;
    if (!nubeDisponible()) return mostrarEstado('Se necesita conexión para fijar/cambiar el PIN.', 'error');
    const pin = await pedirPin(`Nuevo PIN para ${nombre}`);
    if (pin === null) return;
    if (!/^\d{4,6}$/.test(pin)) return mostrarEstado('El PIN debe tener de 4 a 6 dígitos.', 'error');
    try {
      const emp = await nubeActualizarPin(id, pin);
      await cachearEmpleados([emp]);
      mostrarEstado(`PIN actualizado para ${nombre}.`, 'ok');
      await refrescarEmpleados();
    } catch (err) {
      console.error(err);
      mostrarEstado('No se pudo actualizar el PIN: ' + err.message, 'error');
    }
  }

  if (btnMarcar) {
    const empleado_id = btnMarcar.dataset.id;
    const cred = btnMarcar.dataset.cred;
    const tipo = btnMarcar.dataset.tipo;
    const pinHash = btnMarcar.dataset.pinhash;
    btnMarcar.disabled = true;
    try {
      const pin = await pedirPin(`PIN de ${btnMarcar.closest('.card-empleado').querySelector('strong').textContent}`);
      if (pin === null) return;
      if (!pinHash || (await hashPin(pin, empleado_id)) !== pinHash) {
        return mostrarEstado('PIN incorrecto.', 'error');
      }
      // Revalida contra el caché justo antes de escribir, por si otra pestaña
      // o un doble toque ya marcó esta entrada/salida mientras se pedía el PIN/huella.
      const hoy = fechaLocalDe(new Date().toISOString());
      const yaMarcadoHoy = (await obtenerRegistrosCache({ empleadoId: empleado_id }))
        .some(r => r.tipo === tipo && fechaLocalDe(r.marca) === hoy);
      if (yaMarcadoHoy) {
        mostrarEstado(`Ya se había marcado ${tipo} hoy para esta persona.`, 'error');
        return await refrescarEmpleados();
      }
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
    const pinHash = btnVincular.dataset.pinhash;
    try {
      const pin = await pedirPin(`PIN de ${nombre}`);
      if (pin === null) return;
      if (!pinHash || (await hashPin(pin, id)) !== pinHash) {
        return mostrarEstado('PIN incorrecto.', 'error');
      }
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
function irATab(destino) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activa'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('activa'));
  document.querySelector(`.tab-btn[data-tab="${destino}"]`).classList.add('activa');
  document.querySelector(`#tab-${destino}`).classList.add('activa');
  if (destino === 'horarios') cargarSelectorHorarios();
  if (destino === 'reportes') cargarSelectorReportes();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => irATab(btn.dataset.tab));
});

// ---- Acceso de encargado: Horarios y Reportes están ocultos hasta identificarse ----
document.querySelector('#btn-acceso-encargado').addEventListener('click', async () => {
  if (!nubeDisponible()) return mostrarEstado('Se necesita conexión para entrar a esta sección.', 'error');
  const emp = await identificarse('PIN de encargado');
  if (!emp) return;
  if (!emp.es_encargado) return mostrarEstado('Ese PIN no pertenece a un encargado.', 'error');
  sesionActual = emp;
  document.querySelectorAll('.tab-btn[data-tab="horarios"], .tab-btn[data-tab="reportes"]').forEach(b => b.classList.remove('oculto'));
  document.querySelector('#btn-acceso-encargado').classList.add('oculto');
  mostrarEstado(`Acceso de encargado: ${emp.nombre}.`, 'ok');
  irATab('horarios');
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
