// MAMA en el móvil, DENTRO de CEOPadre (misión 16-11: «MAMA vive en CEOPadre, en PC y móvil»).
// No hay un cliente nuevo: el canal es el de FocoGravital APP (web/vendor/mama-canal, generado de cripto.ts/canal.ts con
// tools/mama-web-canal.mjs) con las mismas tablas cifradas (mama_par/mama_mensaje/mama_pc) y la misma conversación del PC.
// Aquí sólo se le dan sus dependencias de navegador y se pinta con la burbuja de web/mama.js:
//  · sesión del Supabase de FocoGravital SIN contraseña: código o enlace de un solo uso por correo (como tools/mama-sesion.mjs);
//  · clave del canal en IndexedDB cifrada con una clave AES-GCM NO EXTRAÍBLE del navegador (el equivalente web de SecureStore:
//    no protege de un script inyectado en la página, sí de leer el almacenamiento en bruto); historial cifrado con la clave del canal;
//  · emparejar = el código de 10 caracteres que da el PC (Mama → tarjeta «Móvil»). Un solo móvil: éste sustituye al anterior.
import { h } from './dom.js';
import { sellar, separar } from './mama-contexto.js';

const TEXTO_MAX = 4000, CICLO_MS = 5000;
const AVISO = {
  red: 'Sin conexión: lo enviado sigue en cola y sale solo.', revocado: 'Este móvil se desemparejó desde el PC. Empareja de nuevo.',
  rechazado_codigo: 'El PC rechazó el código (caducado o mal escrito). Pide otro en el PC.', rechazado_sin_codigo: 'El PC no tenía código activo. Pide uno en el PC.',
  respuesta_no_autenticada: 'La respuesta del PC no se pudo autenticar: no se ha emparejado.', par_no_visible: 'No veo el emparejamiento en el servidor.',
  historial_local_ilegible: 'El historial guardado en este móvil no se pudo leer; la conversación sigue completa en el PC.',
};
const ERROR_ADJ = { adj_tamano: 'El archivo está vacío o supera 5 MB.', adj_tipo: 'Tipo no admitido: PDF, imagen, texto, CSV u Office.',
  adj_cola_llena: 'Ya hay 3 archivos esperando a salir: espera a que el PC los reciba.', sin_par: 'Empareja primero este móvil.' };
// Lo que el navegador del móvil enseña en una pestaña; el resto (PDF, Office, CSV, HEIC) se descarga y lo abre su visor.
const VER = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain']);
const ESTADO_ENVIO = { pendiente: 'en cola', enviado: 'enviado', recibido: 'recibido por el PC', rechazado: 'no aceptado' };
// T36 · voz desde la PWA (canal T30). Formatos que el canal y el PC aceptan (MIMES_VOZ de canal.ts / EXT de src/mama-voz.js).
export const VOZ_SEG = 180, VOZ_BPS = 16_000;
const MIMES_GRABAR = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
/** Primer formato de grabación que el navegador soporta y el canal admite (sin «;codecs=», que el canal no conoce), o ''. */
export const elegirMimeVoz = (soporta) => MIMES_GRABAR.find((m) => soporta(m)) || '';
const mimeVoz = () => elegirMimeVoz((m) => !!window.MediaRecorder?.isTypeSupported?.(m));
const puedeGrabar = () => !!(navigator.mediaDevices?.getUserMedia && mimeVoz());
const ERROR_VOZ = { voz_tamano: 'La nota está vacía o es demasiado larga. Graba otra más corta.', voz_formato: 'Este móvil graba en un formato que Mama no admite.',
  voz_cola_llena: 'Ya hay 5 notas esperando a salir: espera a que el PC las reciba.', sin_par: 'Empareja primero este móvil.' };

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
// T31: ficheros del canal (archivo cifrado con la clave del canal y sobres YA sellados): IndexedDB, nunca en claro.
// `borrar` admite una carpeta (borra también lo que cuelga de «nombre/»), como FicherosLike de canal.ts.
export const ficheros = {
  escribir: (n, v) => idb.set(`f:${n}`, v),
  leer: async (n) => (await idb.get(`f:${n}`)) ?? null,
  borrar: (n) => tx('readwrite', (s) => { s.delete(`f:${n}`); return s.delete(IDBKeyRange.bound(`f:${n}/`, `f:${n}/￿`)); }),
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

/** Error del acceso en palabras de Antonio (códigos reales de Supabase Auth; medido 16-11: correo sin cuenta → 422 otp_disabled). */
export function explicar(e) {
  const c = String(e?.code || e?.error_code || ''), m = String(e?.message || e || ''), st = Number(e?.status) || 0;
  if (c === 'otp_disabled' || /signups not allowed/i.test(m)) return 'Ese correo no tiene cuenta en FocoGravital. Usa el de tu cuenta: lo ves en CEOPadre del PC → Mama → tarjeta «Móvil».';
  if (st === 429 || /rate limit|too many|security purposes/i.test(m)) return 'Se han pedido demasiados códigos seguidos. Espera unos minutos y vuelve a intentarlo (el último código enviado sigue valiendo un rato).';
  if (c === 'otp_expired' || /expired|invalid.*(token|otp)|token.*(invalid|not found)/i.test(m)) return 'El código ha caducado, ya se usó o no es correcto. Pulsa «Reenviar código» y usa el último que llegue.';
  if (c === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(m)) return 'Ese correo no es válido. Revísalo.';
  if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(m)) return 'Sin conexión con el servidor de FocoGravital. Comprueba la conexión y vuelve a intentarlo.';
  return `No se pudo continuar: ${m || 'error desconocido'}`;
}

/** Monta MAMA móvil dentro de `cuerpo`. `burbuja(m)` es la de web/mama.js (una sola forma de pintar la conversación). */
export function mamaMovil({ burbuja, toast, ADJ_MAX = 5 * 1024 * 1024, contexto = () => null }) {
  let canal = null, uid = null, foto = null, timer = null, vivo = false, paso = 'cargando', email = '', ocupado = false, cuerpo = null, firma = '', nVistos = 0;
  let grab = null; // T36: nota de voz en curso { rec, trozos, t0, fin, cancelado, mime, reloj }
  let fallo = ''; // 16-11: el error del acceso se ve EN el formulario (el aviso flotante quedaba detrás de la barra inferior)
  // Paso del acceso guardado SIN secretos (correo y momento; nunca el código): recargar no obliga a pedir otro código.
  const LOGIN = 'ceopadre-mama-acceso';
  const recordar = (x) => { try { if (x) localStorage.setItem(LOGIN, JSON.stringify(x)); else localStorage.removeItem(LOGIN); } catch { /* sin almacenamiento */ } };
  const recordado = () => { try { const x = JSON.parse(localStorage.getItem(LOGIN) || 'null'); return x && Date.now() - x.at < 60 * 60_000 ? x : null; } catch { return null; } };

  async function iniciar(c) {
    cuerpo = c; vivo = true;
    try {
      const { sb, MamaCanal } = await cargarBase();
      const s = (await sb.auth.getSession()).data.session;
      if (!s) { const r = recordado(); email ||= r?.email || ''; paso = r?.paso === 'codigo' ? 'codigo' : 'correo'; return pintar(); }
      recordar(null);
      if (uid !== s.user.id) { uid = s.user.id; canal = new MamaCanal({ sb, uid, almacen, seguro, ficheros, rand: (n) => crypto.getRandomValues(new Uint8Array(n)) }); }
      foto = await canal.preparar();
      paso = 'canal';
      pintar(); await ciclo();
    } catch (e) { paso = 'error'; pintar(String(e?.message || e)); }
  }
  function parar() { vivo = false; clearTimeout(timer); pararVoz(true); } // salir de Mama descarta la grabación y suelta el micrófono
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
    ocupado = true; fallo = ''; pintar();
    try { await f(v); } catch (x) {
      const t = x?.codigo ? `No se pudo: ${x.codigo}` : explicar(x);
      if (paso === 'correo' || paso === 'codigo') fallo = t; // en el acceso, junto al campo (sin repetirlo en un aviso)
      else toast(t, 'bad');
    } finally { ocupado = false; pintar(); }
  };

  const pedir = async (correo) => {
    const { error } = await base.sb.auth.signInWithOtp({ email: correo, options: { shouldCreateUser: false } });
    if (error) throw error; // nunca «código enviado» si el servicio no lo confirma
    email = correo; paso = 'codigo'; recordar({ email, paso, at: Date.now() });
  };
  const pedirCodigo = accion(async (v) => { email = v['mm-email'].trim(); await pedir(email); }); // lo escrito no se pierde si falla
  const reenviar = accion(async () => { await pedir(email); toast(`Código nuevo enviado a ${email}`, 'ok'); });
  const entrar = accion(async (v) => {
    const r = v['mm-otp'].trim();
    // Enlace del correo: «token_hash=» (plantilla propia) o «token=» (plantilla por defecto de Supabase); si no, el código.
    const hash = /[?&#](?:token_hash|token)=([^&\s]+)/.exec(r)?.[1];
    const tipo = /[?&#]type=(magiclink|email|signup)/.exec(r)?.[1] || 'magiclink';
    const { error } = hash ? await base.sb.auth.verifyOtp({ token_hash: decodeURIComponent(hash), type: tipo === 'signup' ? 'email' : tipo })
      : await base.sb.auth.verifyOtp({ email, token: r.replace(/\s/g, ''), type: 'email' });
    if (error) throw error;
    recordar(null);
    await iniciar(cuerpo);
  });
  const emparejar = accion(async (v) => { foto = await canal.emparejar(v['mm-par'], 'CEOPadre móvil'); void ciclo(); });
  const cancelar = accion(async () => { foto = await canal.cancelarEmparejamiento(); });
  const enviar = accion(async (v) => {
    const t = v['mm-text'].trim();
    if (!t) return;
    if (t.length > TEXTO_MAX) throw new Error(`Máximo ${TEXTO_MAX} caracteres`);
    // T36: se ve YA («guardando…») mientras se sella y se guarda en la cola; si falla, se quita y el texto vuelve a la caja.
    const prov = burbuja({ rol: 'antonio', texto: t, at: new Date().toISOString(), via: 'movil' });
    prov.classList.add('m-pend'); prov.append(h('p', { class: 'msg-who m-envio' }, 'guardando…'));
    document.getElementById('mm-msgs')?.append(prov); window.scrollTo(0, document.documentElement.scrollHeight);
    const caja = document.getElementById('mm-text'); caja.value = '';
    // T-A: el canal sólo lleva texto; el contexto del panel va como sobre en la primera línea (el PC lo separa al recibirlo).
    const sellado = sellar(t, contexto());
    try { foto = await canal.enviar(sellado.length <= TEXTO_MAX ? sellado : t); } catch (x) { prov.remove(); if (!caja.value) caja.value = t; throw x; }
    firma = '';
    setTimeout(ciclo, 300);
  });

  // T31: adjuntar = leer el archivo aquí y entregarlo al canal (lo trocea, lo sella y lo deja en cola ANTES de la red).
  async function adjuntar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || ocupado) return;
    if (!f.size || f.size > ADJ_MAX) { toast(ERROR_ADJ.adj_tamano, 'bad'); return; }
    ocupado = true; pintar();
    // T36: el archivo se ve YA en la conversación («guardando…») mientras se trocea, se sella y queda en la cola.
    const prov = burbuja({ rol: 'antonio', texto: `📎 ${f.name} · guardando…`, at: new Date().toISOString(), via: 'movil' });
    prov.classList.add('m-pend'); document.getElementById('mm-msgs')?.append(prov); window.scrollTo(0, document.documentElement.scrollHeight);
    try { foto = await canal.enviarAdjunto(new Uint8Array(await f.arrayBuffer()), f.name, f.type); setTimeout(ciclo, 300); }
    catch (x) { prov.remove(); toast(ERROR_ADJ[x?.codigo] || `No se pudo adjuntar: ${x?.codigo || x?.message || x}`, 'bad'); }
    finally { ocupado = false; firma = ''; pintar(); }
  }
  // Abrir: el archivo cifrado del propio móvil, descifrado y con su huella comprobada (abrirAdjunto devuelve null si no cuadra).
  async function abrirAdjunto(a) {
    const w = VER.has(a.mime) ? window.open('about:blank', '_blank') : null; // dentro del gesto: si no, el navegador la bloquea
    try {
      const r = await canal.abrirAdjunto(a.id);
      if (!r) { w?.close(); toast('Ese archivo aún no está en este móvil o no se pudo comprobar.', 'bad'); return; }
      const url = URL.createObjectURL(new Blob([r.datos], { type: r.mime }));
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (w) { w.opener = null; w.location.href = url; return; }
      const x = h('a', { href: url, download: r.nombre, hidden: true });
      document.body.append(x); x.click(); x.remove();
    } catch { w?.close(); toast('No se pudo abrir el archivo.', 'bad'); }
  }
  const pintarMensaje = (m0) => {
    const s = separar(m0.texto); // lo enviado desde el panel guarda el sobre en este móvil: se pinta el mensaje y su «Sobre:»
    const m = s.contexto ? { ...m0, texto: s.texto, contexto: s.contexto } : m0;
    const a = m.adjunto;
    if (!a) return burbuja(m);
    if (a.fallido || !a.listo) return burbuja({ ...m, adjunto: undefined, texto: `📎 ${a.nombre || 'archivo'} · ${a.fallido ? 'no se pudo recibir' : 'llegando…'}` });
    return burbuja({ ...m, adjunto: { ...a, ver: VER.has(a.mime) } }, abrirAdjunto);
  };

  let pantalla = '', ultimaEtapa = '';
  function pintar(error = '') {
    if (!cuerpo || !vivo) return;
    // Fuera del chat, sólo se repinta si cambia lo que se ve (el ciclo no borra el código que se está tecleando).
    const p = JSON.stringify([paso, foto?.fase, foto?.aviso, ocupado, error, fallo]);
    const chat = paso === 'canal' && foto?.fase === 'activo';
    if (!chat && p === pantalla && cuerpo.firstChild) return;
    pantalla = p;
    // 16-11 (Android real): al cambiar de PASO (correo → código → emparejar → chat) la pantalla se repintaba con la página
    // desplazada (teclado abierto) y su encabezado quedaba bajo la cabecera fija. Cada paso nuevo empieza arriba.
    const etapa = `${paso}|${foto?.fase || ''}`;
    if (etapa !== ultimaEtapa) { ultimaEtapa = etapa; if (window.scrollY > 0) window.scrollTo(0, 0); }
    const sec = (...x) => h('section', { class: 'side-card mama-movil' }, h('h2', {}, 'Mama'), ...x);
    if (paso === 'cargando') return cuerpo.replaceChildren(sec(h('p', { class: 'muted' }, 'Abriendo tu conversación…')));
    if (paso === 'error') return cuerpo.replaceChildren(sec(h('p', { class: 'bad' }, `No se pudo abrir Mama: ${error}`), h('button', { class: 'btn', type: 'button', onclick: () => iniciar(cuerpo) }, 'Reintentar')));
    const alerta = fallo ? h('p', { class: 'bad mm-fallo', role: 'alert' }, fallo) : null;
    // r13 (T22): en el móvil el formulario puede quedar a la altura de la barra inferior: el motivo se trae al centro, a la vista.
    const conAlerta = (x) => { cuerpo.replaceChildren(x); alerta?.scrollIntoView?.({ block: 'center' }); };
    if (paso === 'correo') {
      return conAlerta(sec(h('p', {}, 'Una sola vez en este móvil: entra con tu cuenta de FocoGravital (sin contraseña, te llega un código por correo).'),
        h('form', { class: 'mm-acceso', onsubmit: pedirCodigo }, h('label', { for: 'mm-email' }, 'Correo de tu cuenta de FocoGravital'),
          h('input', { id: 'mm-email', type: 'email', required: true, autocomplete: 'email', inputmode: 'email', value: email }), alerta,
          h('button', { class: 'btn primary', type: 'submit', disabled: ocupado, 'aria-busy': String(ocupado) }, ocupado ? 'Enviando código…' : 'Enviarme el código'))));
    }
    if (paso === 'codigo') {
      return conAlerta(sec(h('p', { role: 'status' }, `El servicio confirmó el envío a ${email}. Escribe el código del correo (o pega el enlace: mantén pulsado el botón del correo → Copiar enlace). Si tarda, mira en Spam.`),
        h('form', { class: 'mm-acceso', onsubmit: entrar }, h('label', { for: 'mm-otp' }, 'Código o enlace'),
          h('input', { id: 'mm-otp', required: true, autocomplete: 'one-time-code', inputmode: 'text' }), alerta,
          h('button', { class: 'btn primary', type: 'submit', disabled: ocupado, 'aria-busy': String(ocupado) }, ocupado ? 'Comprobando…' : 'Entrar'),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: ocupado, onclick: reenviar }, 'Reenviar código'),
            h('button', { class: 'btn', type: 'button', disabled: ocupado, onclick: () => { paso = 'correo'; fallo = ''; recordar(null); pintar(); } }, 'Cambiar de correo')))));
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
    // repintan la lista y los avisos si cambiaron. T36: la MISMA estructura que el PC (lista .ceo-msgs.mama-msgs y caja .ceo-form);
    // en el móvil la lista crece con la página y la caja queda pegada abajo, siempre a la vista (web/style.css «T36»).
    let primera = false;
    if (!document.getElementById('mm-msgs')) {
      firma = ''; primera = true;
      cuerpo.replaceChildren(sec(h('div', { id: 'mm-estado' }),
        h('div', { class: 'ceo-msgs mama-msgs', id: 'mm-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación con Mama' }),
        h('form', { class: 'ceo-form mm-form', onsubmit: enviar },
          h('label', { for: 'mm-text', class: 'sr-only' }, 'Mensaje para Mama'),
          h('textarea', { id: 'mm-text', rows: 1, maxlength: TEXTO_MAX, placeholder: 'Escribe a Mama…' }),
          h('input', { type: 'file', id: 'mm-file', hidden: true, onchange: adjuntar, accept: '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.txt,.csv,.docx,.xlsx,.pptx,.doc,.xls' }),
          h('button', { class: 'btn icono', type: 'button', id: 'mm-adjuntar', title: 'Adjuntar un archivo (hasta 5 MB)', 'aria-label': 'Adjuntar un archivo',
            onclick: () => document.getElementById('mm-file')?.click() }, '📎'),
          puedeGrabar() ? h('button', { class: 'btn icono', type: 'button', id: 'mm-voz', title: `Grabar una nota de voz (hasta ${VOZ_SEG / 60} min)`, 'aria-label': 'Grabar una nota de voz', onclick: () => void grabar() }, '🎙') : null,
          h('button', { class: 'btn primary', type: 'submit', id: 'mm-enviar' }, 'Enviar'),
          h('div', { class: 'mm-grabando', id: 'mm-grabando' },
            h('span', { class: 'mm-rec', id: 'mm-rec', role: 'status' }, ''),
            h('button', { class: 'btn', type: 'button', id: 'mm-voz-cancelar', onclick: () => pararVoz(true) }, 'Cancelar'),
            h('button', { class: 'btn primary', type: 'button', id: 'mm-voz-parar', onclick: () => pararVoz(false) }, 'Enviar nota')))));
      pintarVoz();
    }
    for (const id of ['mm-enviar', 'mm-adjuntar', 'mm-voz']) { const x = document.getElementById(id); if (x) x.disabled = ocupado; }
    const s = JSON.stringify([f.pcActivo, f.aviso, (f.mensajes || []).map((m) => [m.id, m.estado, m.texto.length, m.adjunto?.listo, m.adjunto?.fallido])]);
    if (s === firma) return;
    firma = s;
    // Al abrir, y si ya estaba abajo, se queda en lo último (si está leyendo más arriba, no se le mueve).
    const alFinal = primera || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    document.getElementById('mm-estado').replaceChildren(
      f.pcActivo === false ? h('p', { class: 'muted small', role: 'status' }, 'El PC está apagado o sin conexión: Mama responderá cuando vuelva. Lo que escribas queda en cola.') : '', aviso || '');
    const lista = document.getElementById('mm-msgs');
    lista.replaceChildren(...(f.mensajes || []).map((m) => {
      const b = pintarMensaje(m);
      if (m.via === 'movil' && m.estado && m.estado !== 'recibido') b.append(h('p', { class: `msg-who m-envio${m.estado === 'rechazado' ? ' bad' : ''}` }, ESTADO_ENVIO[m.estado] || m.estado));
      return b;
    }));
    lista.scrollTop = lista.scrollHeight;
    const n = (f.mensajes || []).length, nuevos = !primera && n > nVistos;
    nVistos = n;
    if (alFinal) window.scrollTo(0, document.documentElement.scrollHeight);
    else if (nuevos && !document.getElementById('mm-nuevos')) { // §7.2: leyendo arriba no se le mueve; se le avisa
      const b = h('button', { id: 'mm-nuevos', class: 'btn primary small ceo-nuevo mm-nuevos', type: 'button', onclick: () => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); b.remove(); } }, 'Mensajes nuevos ↓');
      lista.after(b);
      const quitar = () => { if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160) { b.remove(); window.removeEventListener('scroll', quitar); } };
      window.addEventListener('scroll', quitar, { passive: true });
    }
  }

  // T36 · VOZ: grabar aquí (MediaRecorder) y entregar al canal (T30: lo trocea, lo sella con la clave del canal y lo deja en cola
  // ANTES de la red; el PC lo transcribe en local con whisper.cpp). El audio sólo vive en memoria hasta sellarse; el micrófono se
  // suelta al terminar. 180 s a 16 kbit/s ≈ 360 KB, por debajo del tope del canal (VOZ_MAX_BYTES = 600 KB).
  function pintarVoz() {
    const f = document.querySelector('.mm-form');
    if (!f) return;
    f.classList.toggle('grabando', !!grab);
    const r = document.getElementById('mm-rec');
    if (r) { const s = grab ? Math.floor((Date.now() - grab.t0) / 1000) : 0; r.textContent = grab ? `● Grabando ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (máx. ${VOZ_SEG / 60}:00)` : ''; }
  }
  async function grabar() {
    if (ocupado || grab || !canal) return;
    const mime = mimeVoz();
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('Sin permiso para el micrófono: actívalo para esta app en los ajustes del navegador (o usa el dictado del teclado).', 'bad'); return; }
    const rec = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: VOZ_BPS });
    const g = { rec, trozos: [], t0: Date.now(), fin: 0, cancelado: false, mime: mime.split(';')[0], reloj: 0 };
    grab = g;
    rec.ondataavailable = (e) => { if (e.data.size) g.trozos.push(e.data); };
    rec.onstop = () => {
      s.getTracks().forEach((t) => t.stop()); clearInterval(g.reloj);
      grab = null; pintarVoz();
      if (g.cancelado) { g.trozos.length = 0; toast('Nota de voz descartada', 'ok'); document.getElementById('mm-voz')?.focus(); } else void entregarVoz(g);
    };
    g.reloj = setInterval(() => { if (Date.now() - g.t0 >= VOZ_SEG * 1000) pararVoz(false); else pintarVoz(); }, 500);
    rec.start();
    pintarVoz();
    document.getElementById('mm-voz-parar')?.focus(); // una vez, al empezar (no en cada tic del reloj)
  }
  function pararVoz(cancelar) {
    if (!grab || grab.rec.state === 'inactive') return;
    grab.cancelado = cancelar; grab.fin = Date.now();
    grab.rec.stop();
  }
  async function entregarVoz(g) {
    ocupado = true; pintar();
    try {
      const audio = new Uint8Array(await new Blob(g.trozos, { type: g.mime }).arrayBuffer());
      foto = await canal.enviarVoz(audio, g.mime, Math.max(1, Math.round(((g.fin || Date.now()) - g.t0) / 1000)));
      setTimeout(ciclo, 300);
    } catch (x) { toast(ERROR_VOZ[x?.codigo] || `No se pudo enviar la nota: ${x?.codigo || x?.message || x}`, 'bad'); }
    finally { g.trozos.length = 0; ocupado = false; firma = ''; pintar(); document.getElementById('mm-voz')?.focus(); }
  }

  return { iniciar, parar };
}
