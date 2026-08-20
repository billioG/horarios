// Capa local (IndexedDB). Dos roles distintos:
//  1) credenciales_locales: mapeo empleado -> credencial WebAuthn. SIEMPRE local,
//     nunca se sube a la nube (la huella está atada al sensor de este dispositivo).
//  2) cache_* + cola_pendiente: copia local de empleados/horarios/registros para
//     poder marcar entrada/salida y consultar aunque no haya internet. La nube
//     (Supabase, ver cloud.js) es la fuente de verdad cuando hay conexión.

const DB_NAME = 'asistencia_db';
const DB_VERSION = 2;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('credenciales_locales')) {
        db.createObjectStore('credenciales_locales', { keyPath: 'empleadoId' });
      }
      if (!db.objectStoreNames.contains('cache_empleados')) {
        db.createObjectStore('cache_empleados', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cache_horarios')) {
        db.createObjectStore('cache_horarios', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cache_registros')) {
        const store = db.createObjectStore('cache_registros', { keyPath: 'id' });
        store.createIndex('empleado_id', 'empleado_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('cola_pendiente')) {
        db.createObjectStore('cola_pendiente', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function txStore(nombreStore, modo) {
  const db = await abrirDB();
  const tx = db.transaction(nombreStore, modo);
  return { tx, store: tx.objectStore(nombreStore) };
}

function pReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- credenciales locales ----
async function guardarCredencialLocal(empleadoId, credentialId, nombre) {
  const { store } = await txStore('credenciales_locales', 'readwrite');
  return pReq(store.put({ empleadoId, credentialId, nombre }));
}
async function obtenerCredencialLocal(empleadoId) {
  const { store } = await txStore('credenciales_locales', 'readonly');
  return pReq(store.get(empleadoId));
}
async function listarCredencialesLocales() {
  const { store } = await txStore('credenciales_locales', 'readonly');
  return pReq(store.getAll());
}
async function borrarCredencialLocal(empleadoId) {
  const { store } = await txStore('credenciales_locales', 'readwrite');
  return pReq(store.delete(empleadoId));
}

// ---- cache empleados ----
async function cachearEmpleados(lista) {
  const { tx, store } = await txStore('cache_empleados', 'readwrite');
  for (const e of lista) store.put(e);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function obtenerEmpleadosCache() {
  const { store } = await txStore('cache_empleados', 'readonly');
  return pReq(store.getAll());
}
async function quitarEmpleadoCache(id) {
  const { store } = await txStore('cache_empleados', 'readwrite');
  return pReq(store.delete(id));
}

// ---- cache horarios ---- (id sintético = `${empleado_id}_${dia_semana}`)
async function cachearHorarios(lista) {
  const { tx, store } = await txStore('cache_horarios', 'readwrite');
  for (const h of lista) store.put({ ...h, id: `${h.empleado_id}_${h.dia_semana}` });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function obtenerHorariosCache(empleadoId) {
  const { store } = await txStore('cache_horarios', 'readonly');
  const todos = await pReq(store.getAll());
  return empleadoId ? todos.filter(h => h.empleado_id === empleadoId) : todos;
}

// ---- cache registros ----
async function cachearRegistro(registro) {
  const { store } = await txStore('cache_registros', 'readwrite');
  return pReq(store.put(registro));
}
async function cachearRegistros(lista) {
  const { tx, store } = await txStore('cache_registros', 'readwrite');
  for (const r of lista) store.put(r);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function obtenerRegistrosCache({ empleadoId = null } = {}) {
  const { store } = await txStore('cache_registros', 'readonly');
  let lista = await pReq(store.getAll());
  if (empleadoId) lista = lista.filter(r => r.empleado_id === empleadoId);
  return lista.sort((a, b) => b.marca.localeCompare(a.marca));
}

// ---- cola pendiente (registros creados offline, esperando subir) ----
async function encolarRegistro(registro) {
  const { store } = await txStore('cola_pendiente', 'readwrite');
  return pReq(store.put(registro));
}
async function listarCola() {
  const { store } = await txStore('cola_pendiente', 'readonly');
  return pReq(store.getAll());
}
async function quitarDeCola(id) {
  const { store } = await txStore('cola_pendiente', 'readwrite');
  return pReq(store.delete(id));
}
