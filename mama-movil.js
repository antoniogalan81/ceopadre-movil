// MAMA en el móvil, DENTRO de CEOPadre (misión 16-11: «MAMA vive en CEOPadre, en PC y móvil»).
// No hay un cliente nuevo: el canal es el de FocoGravital APP (web/vendor/mama-canal, generado de cripto.ts/canal.ts con
// tools/mama-web-canal.mjs) con las mismas tablas cifradas (mama_par/mama_mensaje/mama_pc) y la misma conversación del PC.
// Aquí sólo se le dan sus dependencias de navegador y se pinta con la burbuja de web/mama.js:
//  · sesión del Supabase de FocoGravital SIN contraseña: código o enlace de un solo uso por correo (como tools/mama-sesion.mjs);
//  · clave del canal en IndexedDB cifrada con una clave AES-GCM NO EXTRAÍBLE del navegador (el equivalente web de SecureStore:
//    no protege de un script inyectado en la página, sí de leer el almacenamiento en bruto); historial cifrado con la clave del canal;
//  · emparejar = el código de 10 caracteres que da el PC (Mama → tarjeta «Móvil»). Un solo móvil: éste sustituye al anterior.
import { h } from './dom.js';

const TEXTO_MAX = 4000, CICLO_MS = 5000;
const AVISO = {
  red: 'Sin conexión: lo enviado sigue en cola y sale solo.', revocado: 'Este móvil se desemparejó desde el PC. Empareja de nuevo.',
  rechazado_codigo: 'El PC rechazó el código (caducado o mal escrito). Pide otro en el PC.', rechazado_sin_codigo: 'El PC no tenía código activo. Pide uno en el PC.',
  respuesta_no_autenticada: 'La respuesta del PC no se pudo autenticar: no se ha emparejado.', par_no_visible: 'No veo el emparejamiento en el servidor.',
  historial_local_ilegible: 'El historial guardado en este móvil no se pudo leer; la conversación sigue completa en el PC.',
};
const ESTADO_ENVIO = { pendiente: 'en cola', enviado: 'enviado', recibido: 'recibido por el PC', rechazado: 'no aceptado' };

// ---------------------------------------------------------------- almacenes del navegador
let dbp = null;
const db = () => (dbp ??= new Promise((ok, ko) => {
  const r = indexedDB.open('ceopadre-mama', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
}));
const tx = async (modo, f) => { const d = await db(); return new Promise((ok, ko) => { const t = d.transaction('kv', modo); const q = f(t.objectStore('kv')); t.oncomplete = () => ok(q.result); t.onerror = () => ko(t.error); }); };
const idb = { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)), del: (k) => tx('readwrite', (s) => s.delete(k)) };
let llavep = null;
const llave = () => (llavep ??= (async () => {
  let k = await idb.get('llave');
  if (!k) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await idb.set('llave', k); }
  return k;
})());
const seguro = {
  async get(k) { const v = await idb.get(`s:${k}`); return v ? new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, await llave(), v.ct)) : null; },
  async set(k, v) { const iv = crypto.getRandomValues(new Uint8Array(12)); await idb.set(`s:${k}`, { iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await llave(), new TextEncoder().encode(v)) }); },
  del: (k) => idb.del(`s:${k}`),
};
const almacen = { getItem: async (k) => (await idb.get(`a:${k}`)) ?? null, setItem: (k, v) => idb.set(`a:${k}`, v), removeItem: (k) => idb.del(`a:${k}`) };

// ---------------------------------------------------------------- cliente
let base = null; // { sb, MamaCanal }
async function cargarBase() {
  if (base) return base;
  const [{ MamaCanal }, { FOCO_URL, FOCO_ANON }] = await Promise.all([import('./vendor/mama-canal/canal.js'), import('./config-foco.js')]);
  const sb = window.supabase.createClient(FOCO_URL, FOCO_ANON, { auth: { storageKey: 'ceopadre-foco', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return (base = { sb, MamaCanal });
}

/** Monta MAMA móvil dentro de `cuerpo`. `burbuja(m)` es la de web/mama.js (una sola forma de pintar la conversación). */
export function mamaMovil({ burbuja, toast }) {
  let canal = null, uid = null, foto = null, timer = null, vivo = false, paso = 'cargando', email = '', ocupado = false, cuerpo = null, firma = '';

  async function iniciar(c) {
    cuerpo = c; vivo = true;
    try {
      const { sb, MamaCanal } = await cargarBase();
      const s = (await sb.auth.getSession()).data.session;
      if (!s) { paso = 'correo'; return pintar(); }
      if (uid !== s.user.id) { uid = s.user.id; canal = new MamaCanal({ sb, uid, almacen, seguro, rand: (n) => crypto.getRandomValues(new Uint8Array(n)) }); }
      foto = await canal.preparar();
      paso = 'canal';
      pintar(); await ciclo();
    } catch (e) { paso = 'error'; pintar(String(e?.message || e)); }
  }
  function parar() { vivo = false; clearTimeout(timer); }
  async function ciclo() {
    clearTimeout(timer);
    if (!vivo || !canal) return;
    try { if (!document.hidden) { foto = await canal.sincronizar(); pintar(); } } catch { /* sin red: la cola sigue en disco */ }
    timer = setTimeout(ciclo, foto?.fase === 'esperando' ? 2000 : CICLO_MS);
  }
  const accion = (f) => async (e) => {
    e?.preventDefault?.();
    if (ocupado) return;
    // Los campos se leen ANTES de repintar (al pasar a «ocupado» el formulario se rehace y quedaría vacío).
    const v = Object.fromEntries([...cuerpo.querySelectorAll('input, textarea')].map((x) => [x.id, x.value]));
    ocupado = true; pintar();
    try { await f(v); } catch (x) { toast(x?.codigo ? `No se pudo: ${x.codigo}` : String(x?.message || x), 'bad'); }
    finally { ocupado = false; pintar(); }
  };

  const pedirCodigo = accion(async (v) => {
    email = v['mm-email'].trim();
    const { error } = await base.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw new Error(`No se pudo enviar el correo: ${error.message}`);
    paso = 'codigo';
  });
  const entrar = accion(async (v) => {
    const r = v['mm-otp'].trim();
    const hash = /token_hash=([^&\s]+)/.exec(r)?.[1];
    const { error } = hash ? await base.sb.auth.verifyOtp({ token_hash: decodeURIComponent(hash), type: 'magiclink' })
      : await base.sb.auth.verifyOtp({ email, token: r.replace(/\s/g, ''), type: 'email' });
    if (error) throw new Error(`Código no válido: ${error.message}`);
    await iniciar(cuerpo);
  });
  const emparejar = accion(async (v) => { foto = await canal.emparejar(v['mm-par'], 'CEOPadre móvil'); void ciclo(); });
  const cancelar = accion(async () => { foto = await canal.cancelarEmparejamiento(); });
  const enviar = accion(async (v) => {
    const t = v['mm-text'].trim();
    if (!t) return;
    if (t.length > TEXTO_MAX) throw new Error(`Máximo ${TEXTO_MAX} caracteres`);
    foto = await canal.enviar(t);
    document.getElementById('mm-text').value = '';
    setTimeout(ciclo, 300);
  });

  let pantalla = '';
  function pintar(error = '') {
    if (!cuerpo || !vivo) return;
    // Fuera del chat, sólo se repinta si cambia lo que se ve (el ciclo no borra el código que se está tecleando).
    const p = JSON.stringify([paso, foto?.fase, foto?.aviso, ocupado, error]);
    const chat = paso === 'canal' && foto?.fase === 'activo';
    if (!chat && p === pantalla && cuerpo.firstChild) return;
    pantalla = p;
    const sec = (...x) => h('section', { class: 'side-card mama-movil' }, h('h2', {}, 'Mama'), ...x);
    if (paso === 'cargando') return cuerpo.replaceChildren(sec(h('p', { class: 'muted' }, 'Abriendo tu conversación…')));
    if (paso === 'error') return cuerpo.replaceChildren(sec(h('p', { class: 'bad' }, `No se pudo abrir Mama: ${error}`), h('button', { class: 'btn', type: 'button', onclick: () => iniciar(cuerpo) }, 'Reintentar')));
    if (paso === 'correo') {
      return cuerpo.replaceChildren(sec(h('p', {}, 'Una sola vez en este móvil: entra con tu cuenta de FocoGravital (sin contraseña, te llega un código por correo).'),
        h('form', { onsubmit: pedirCodigo }, h('label', { for: 'mm-email' }, 'Correo de tu cuenta'),
          h('input', { id: 'mm-email', type: 'email', required: true, autocomplete: 'email', value: email }),
          h('button', { class: 'btn primary', type: 'submit', disabled: ocupado }, ocupado ? 'Enviando…' : 'Enviarme el código'))));
    }
    if (paso === 'codigo') {
      return cuerpo.replaceChildren(sec(h('p', {}, `Escribe el código que te ha llegado a ${email} (o pega el enlace del correo).`),
        h('form', { onsubmit: entrar }, h('label', { for: 'mm-otp' }, 'Código o enlace'),
          h('input', { id: 'mm-otp', required: true, autocomplete: 'one-time-code', inputmode: 'text' }),
          h('button', { class: 'btn primary', type: 'submit', disabled: ocupado }, ocupado ? 'Comprobando…' : 'Entrar'),
          h('button', { class: 'btn', type: 'button', onclick: () => { paso = 'correo'; pintar(); } }, 'Volver'))));
    }
    const f = foto || {};
    const aviso = f.aviso ? h('p', { class: 'muted small', role: 'status' }, AVISO[f.aviso] || f.aviso) : null;
    if (f.fase === 'no_disponible') return cuerpo.replaceChildren(sec(h('p', { class: 'bad' }, 'El canal de Mama no está disponible en el servidor.')));
    if (f.fase === 'sin_par') {
      return cuerpo.replaceChildren(sec(aviso, h('p', {}, 'Último paso: en CEOPadre del PC abre Mama → tarjeta «Móvil» → «Emparejar móvil» y escribe aquí el código (caduca en 10 minutos).'),
        h('p', { class: 'muted small' }, 'Este móvil pasará a ser tu Mama del móvil (sustituye al emparejado antes, p. ej. FocoGravital).'),
        h('form', { onsubmit: emparejar }, h('label', { for: 'mm-par' }, 'Código del PC'),
          h('input', { id: 'mm-par', required: true, autocomplete: 'off', autocapitalize: 'characters', placeholder: 'XXXXX-XXXXX', maxlength: 14 }),
          h('button', { class: 'btn primary', type: 'submit', disabled: ocupado }, 'Emparejar'))));
    }
    if (f.fase === 'esperando') {
      return cuerpo.replaceChildren(sec(aviso, h('p', {}, 'Esperando a que el PC acepte… (tiene que estar encendido)'),
        h('button', { class: 'btn', type: 'button', onclick: cancelar, disabled: ocupado }, 'Cancelar')));
    }
    // Conversación: el formulario se monta UNA vez (no se pierde lo que se está escribiendo ni el foco); en cada ciclo sólo se
    // repintan la lista y los avisos si cambiaron.
    if (!document.getElementById('mm-msgs')) {
      firma = '';
      cuerpo.replaceChildren(sec(h('div', { id: 'mm-estado' }), h('div', { class: 'msgs', id: 'mm-msgs' }),
        h('form', { class: 'm-form', onsubmit: enviar },
          h('label', { for: 'mm-text', class: 'sr-only' }, 'Mensaje para Mama'),
          h('textarea', { id: 'mm-text', rows: 2, maxlength: TEXTO_MAX, placeholder: 'Escribe a Mama… (el dictado del teclado también vale)' }),
          h('button', { class: 'btn primary', type: 'submit', id: 'mm-enviar' }, 'Enviar'))));
    }
    document.getElementById('mm-enviar').disabled = ocupado;
    const s = JSON.stringify([f.pcActivo, f.aviso, (f.mensajes || []).map((m) => [m.id, m.estado, m.texto.length])]);
    if (s === firma) return;
    firma = s;
    document.getElementById('mm-estado').replaceChildren(
      f.pcActivo === false ? h('p', { class: 'muted small', role: 'status' }, 'El PC está apagado o sin conexión: Mama responderá cuando vuelva. Lo que escribas queda en cola.') : '', aviso || '');
    const lista = document.getElementById('mm-msgs');
    lista.replaceChildren(...(f.mensajes || []).map((m) => {
      const b = burbuja(m);
      if (m.via === 'movil' && m.estado && m.estado !== 'recibido') b.append(h('p', { class: `msg-who m-envio${m.estado === 'rechazado' ? ' bad' : ''}` }, ESTADO_ENVIO[m.estado] || m.estado));
      return b;
    }));
    lista.scrollTop = lista.scrollHeight;
  }

  return { iniciar, parar };
}
