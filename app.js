// CEOPadre en el navegador. En el PC habla con la API local; en el móvil, con Supabase.
// No ejecuta nada: pinta el estado y deja órdenes. Todo el texto se inserta como texto (nunca HTML).
import { cleanGoal, conditionsText, decisionCount, decisionsText, direccion, esperaHumana, gestText, HIGH_RISK, mood, needsDecision, netStatus, office, passwordAt, pcOnline, priority, PROMPT_LIMIT, PROMPT_WARN, quotaView, REAUTH_MS, waitingConditions, zone } from './zones.js';
import { h } from './dom.js';
import { advice, decideRow, EFECTO, explica, mapBody, mapPanel, pendingDecisions, proposals } from './map.js';
import { remoteUi } from './remoto.js';
import { autoUi } from './automatizaciones.js';
import { negocioUi } from './negocio.js';
import { aiEditor } from './redactor.js';
import { alquileresUi } from './alquiler.js';
import { borrador, ventanasUniversales } from './modal.js';

ventanasUniversales(); // V3.9: clic fuera = Volver/Cerrar en TODAS las ventanas modales (web/modal.js)

const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
// GESTIÓN · ALQUILERES: tarjeta de cada inquilino («Me ha pagado») dentro de GESTIONES. run/ask se usan al pulsar.
const ALQ = alquileresUi({ run: (...a) => run(...a), ask: (o) => ask(o), cmd: (op, p) => api.cmd(op, p), toast: (m, k) => toast(m, k), LOCAL });
const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ transporte

function localApi() {
  const call = async (path, opts = {}) => {
    const ui = document.querySelector('meta[name="ceo-ui"]')?.content || '';
    const r = await fetch(path, { ...opts, headers: { 'x-ceo': '1', 'content-type': 'application/json', ...(ui ? { 'x-ceo-ui': ui } : {}) } });
    return r.json();
  };
  let remotos = [], remSig = null;
  return {
    async state() {
      const r = await call('/api/state');
      // En el PC el logo lo sirve el propio CEOPadre (la huella en la URL evita cachés viejas).
      for (const c of r.data.proyectos) c._logo = c.logo ? `/logo/${encodeURIComponent(c.id)}?h=${c.logo}` : null;
      // MANDO REMOTO: el mismo panel que en el móvil; la foto sólo se relee cuando cambia su huella.
      const sig = JSON.stringify(Object.entries(r.data.remotos || {}).map(([id, b]) => [id, b.hash, b.at, b.error]));
      if (sig !== remSig) { const x = await call('/api/remoto'); if (x.ok) { remotos = x.data; remSig = sig; } }
      return { proyectos: r.data.proyectos, pc: { online: true }, remoto: r.data.remoto, cuenta: r.data.remoto?.cuenta || '', cuotas: r.data.cuotas, remotos, negocio: r.data.negocio };
    },
    async details(id) { return (await call(`/api/details?proyecto=${encodeURIComponent(id)}`)).data; },
    cmd: (op, params) => call('/api/cmd', { method: 'POST', body: JSON.stringify({ op, params }) }),
    watch(cb) { setInterval(cb, 2500); },
  };
}

async function remoteApi() {
  const { SUPABASE_URL, SUPABASE_ANON } = await import('./config.js');
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }, global: { headers: { 'x-ceo': 'movil' } } });

  let pc = null, cuenta = null;
  const logos = new Map(); // id → { hash, data }
  const remotes = new Map(); // MANDO REMOTO: id → fila de ceo_remoto; la foto (datos) sólo se relee si cambia su huella
  const online = () => pcOnline(pc?.visto_en); // tiempo real contra el sello del servidor; nunca un valor guardado
  return {
    sb,
    async state() {
      const [c, p, rm] = await Promise.all([sb.from('ceo_card').select('datos,posicion').order('posicion'), sb.from('ceo_pc').select('*').maybeSingle(),
        sb.from('ceo_remoto').select('id,nombre,hash,error,at').order('nombre')]);
      if (c.error) throw new Error(c.error.message);
      const changed = (rm.data || []).filter((x) => remotes.get(x.id)?.hash !== x.hash).map((x) => x.id);
      if (changed.length) {
        const d = await sb.from('ceo_remoto').select('id,datos').in('id', changed);
        for (const x of d.data || []) remotes.set(x.id, { datos: x.datos });
      }
      // «Foto hace…» = cuándo la comprobó el PC por última vez (el latido lo dice aunque no haya cambiado nada), no cuándo cambió.
      const beat = p.data?.datos?.remoto || {};
      const remotos = (rm.data || []).filter((x) => remotes.has(x.id)).map((x) => {
        const v = { ...remotes.get(x.id), ...x, ...(beat[x.id]?.hash === x.hash && beat[x.id].at > x.at ? { at: beat[x.id].at } : {}) };
        remotes.set(x.id, v);
        return v;
      });
      pc = p.data;
      const proyectos = c.data.map((r) => r.datos);
      // Logos: sólo los que faltan o cambiaron de huella, una vez (tabla ceo_logo, sin Realtime).
      // Caché del teléfono por huella: un logo sólo se descarga de nuevo si cambia.
      for (const x of proyectos) {
        if (!x.logo || logos.get(x.id)?.hash === x.logo) continue;
        try { const v = JSON.parse(localStorage.getItem(`ceo-logo-${x.id}`) || 'null'); if (v?.hash === x.logo) logos.set(x.id, v); } catch { /* sin almacenamiento */ }
      }
      const need = proyectos.filter((x) => x.logo && logos.get(x.id)?.hash !== x.logo).map((x) => x.id);
      if (need.length) {
        const l = await sb.from('ceo_logo').select('id,hash,data').in('id', need);
        for (const x of l.data || []) {
          logos.set(x.id, x);
          try { localStorage.setItem(`ceo-logo-${x.id}`, JSON.stringify({ hash: x.hash, data: x.data })); } catch { /* lleno o bloqueado: sólo memoria */ }
        }
      }
      for (const x of proyectos) x._logo = x.logo && logos.get(x.id)?.hash === x.logo ? logos.get(x.id).data : null;
      cuenta ??= (await sb.auth.getUser()).data.user?.email || '';
      return { proyectos, pc: { online: online(), visto: pc?.visto_en }, cuenta, cuotas: pc?.datos?.cuotas, remotos, negocio: pc?.datos?.negocio };
    },
    async details(id) { const r = await sb.from('ceo_card').select('detalle').eq('id', id).maybeSingle(); return r.data?.detalle; },
    async cmd(op, params) {
      if (!online()) return { ok: false, error: 'El PC no está conectado ahora mismo: la orden no se envía.' };
      if (HIGH_RISK.has(op)) {
        const extra = await strongConfirm(sb, op, params);
        if (!extra?.ok) return { ok: false, error: extra?.error || 'Cancelado: no se ha enviado nada.' };
        params = { ...params, confirmado: true, _auth: extra.token };
      }
      const id = crypto.randomUUID();
      const usuario = (await sb.auth.getUser()).data.user?.id;
      const ins = await sb.from('ceo_orden').insert({ id, usuario, operacion: op, parametros: params });
      if (ins.error) return { ok: false, error: ins.error.message };
      for (const t0 = Date.now(); Date.now() - t0 < 60_000;) {
        await new Promise((r) => setTimeout(r, 700));
        const { data } = await sb.from('ceo_orden').select('estado,respuesta').eq('id', id).maybeSingle();
        if (data?.estado === 'hecha') return data.respuesta;
        if (data?.estado === 'caducada') return { ok: false, error: 'El PC no recogió la orden a tiempo' };
      }
      return { ok: false, error: 'El PC sigue con ello; mira la tarjeta en un momento' };
    },
    watch(cb) {
      sb.channel('ceo-movil')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ceo_card' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ceo_pc' }, cb)
        .subscribe((st) => { if (st === 'SUBSCRIBED') cb(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cb(); });
      setInterval(cb, 30_000);
    },
  };
}

// MODO SEGURO (sólo móvil): una orden potente (texto libre a Claude) se confirma siempre y, si la contraseña se escribió hace
// más de 30 min, se vuelve a pedir. El PC lo comprueba sobre el token firmado: una sesión robada no basta.
async function strongConfirm(sb, op, params) {
  const s = (await sb.auth.getSession()).data.session;
  if (!s) return { ok: false, error: 'Sesión caducada: vuelve a entrar' };
  const where = data.proyectos.find((c) => c.id === params?.proyecto || (params?.trabajo && c.trabajo === params.trabajo))?.nombre || 'el proyecto';
  const fresh = Date.now() - passwordAt(s.access_token) < REAUTH_MS - 60_000;
  const what = op === 'bandeja.aprobar' ? { title: 'Confirmar envío a terceros', text: `Vas a autorizar el envío de ${params?.items?.length || 0} mensaje(s) desde tu cuenta.` }
    : op === 'automatizacion.guardar' ? { title: 'Guardar procedimiento', text: `Guardas un procedimiento que Claude ejecutará en tu PC cada vez que pulses el botón («${where}»).` }
    : op === 'automatizacion.programar' ? { title: 'Confirmar horario', text: 'La automatización se ejecutará sola en tu PC a esa hora, igual que al pulsar ▶ EJECUTAR.' }
    : op === 'proyecto.revisar' ? { title: 'Confirmar revisión', text: `Claude revisará «${where}» en tu PC (sólo lectura: no cambia código ni datos).` }
    : op.startsWith('negocio.') ? { title: 'Confirmar objetivo de negocio', text: 'El director de CEOPadre lanzará trabajos de Claude en tu PC para este objetivo (gasto 0 €, nada sale a terceros sin ti).' }
    : { title: 'Confirmar orden a Claude', text: `Vas a enviar texto libre a Claude en «${where}». Claude puede ejecutar código en tu PC.` };
  const r = await ask({ title: what.title, ok: 'Enviar al PC',
    help: `${what.text}${fresh ? '' : ' Por seguridad, escribe tu contraseña (como mucho una vez cada 30 min).'}`,
    fields: fresh ? [] : [{ name: 'password', type: 'password', label: 'Contraseña de CEOPadre' }] });
  if (!r) return null;
  if (fresh) return { ok: true, token: s.access_token };
  const { data: d, error } = await sb.auth.signInWithPassword({ email: s.user.email, password: r.password });
  if (error) return { ok: false, error: `Contraseña no válida: no se ha enviado nada (${error.message})` };
  return { ok: true, token: d.session.access_token };
}

// ------------------------------------------------------------------ vocabulario

const STATES = {
  LIBRE: ['⚪', 'SIN OBJETIVO', 'idle'], EN_COLA: ['⏳', 'PRÓXIMO · EN COLA', 'wait'], TRABAJANDO: ['🟢', 'TRABAJANDO', 'work'],
  ESPERANDO_DECISION: ['🟡', 'NECESITA TU RESPUESTA', 'ask'], PAUSADO: ['⏸️', 'EN PAUSA', 'idle'],
  ESPERANDO_CLAUDE: ['⏳', 'SIN CUOTA DE CLAUDE · ESPERANDO', 'wait'], ESPERANDO_CEO: ['⏳', 'SIN CUOTA DEL CEO · ESPERANDO', 'wait'],
  ESPERANDO_CONDICION: ['🔭', 'ESPERANDO ALGO EXTERNO', 'wait'], ESPERANDO_ANTONIO: ['✋', 'NECESITA QUE HAGAS ALGO', 'ask'],
  SIN_ACTIVIDAD: ['🟠', 'TRABAJANDO · SIN SEÑALES', 'warn'], BLOQUEADO: ['🔴', 'BLOQUEADO', 'bad'], ERROR: ['🔴', 'HAY UN PROBLEMA', 'bad'],
  LISTO: ['✅', 'TE TOCA: CONTINUAR', 'ok'], TERMINADO: ['✅', 'TERMINADO Y COMPROBADO', 'ok'], CANCELADO: ['⚪', 'CANCELADO', 'idle'],
};
const OPEN = ['LIBRE', 'TERMINADO', 'CANCELADO'];
const WAITING = ['ESPERANDO_CLAUDE', 'ESPERANDO_CEO'];
// La hora de vuelta se compara con el reloj de ESTE dispositivo: al pasar, cambia el texto sin llamar a nadie.
const future = (iso) => !!iso && Date.parse(iso) > Date.now();
const hhmm = (iso) => {
  const d = new Date(iso), t = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })} ${t}`;
};
function waitLines(c) {
  const who = c.estado === 'ESPERANDO_CLAUDE' ? 'Claude' : 'un CEO';
  // Reanudación automática (ajuste de Antonio): lo dice la tarjeta, y si ésta en concreto no se reanuda, por qué.
  if (c.cuota?.auto) return [future(c.espera_hasta) ? `Esperando a ${who} hasta aproximadamente las ${hhmm(c.espera_hasta)}.` : `Esperando a que ${who} vuelva a estar disponible.`,
    c.cuota.no_reanuda && !/vuelve hacia|sin cuota/.test(c.cuota.no_reanuda) ? `No se reanuda solo: ${c.cuota.no_reanuda}.` : 'Se reanuda solo cuando vuelva la cuota, con el mismo contexto. No tienes que hacer nada.'];
  if (future(c.espera_hasta)) return [`Esperando a ${who} hasta aproximadamente las ${hhmm(c.espera_hasta)}.`, 'Pulsa CONTINUAR cuando quieras reintentarlo.'];
  if (c.espera_hasta) return [`${c.estado === 'ESPERANDO_CLAUDE' ? 'Claude debería' : 'Debería haber un CEO'} estar disponible.`, 'Ya puedes continuar: pulsa CONTINUAR.'];
  return [`${c.estado === 'ESPERANDO_CLAUDE' ? 'Claude no está disponible' : 'Ningún CEO está disponible'} temporalmente (sin hora conocida).`, 'Pulsa CONTINUAR cuando quieras reintentarlo.'];
}

function ago(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('es-ES');
}

// ------------------------------------------------------------------ app

let api, data = { proyectos: [], pc: { online: true } }, openId = null;

let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  // Con un diálogo modal abierto, el aviso vive dentro de él: si no, quedaría tapado por el fondo.
  const host = document.querySelector('dialog[open]') || document.body;
  if (t.parentElement !== host) host.append(t);
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// La barra de pestañas (móvil) y la pestaña de arriba (PC) dicen en qué sección estás.
const TAB_OF = { 'p-list': 'home', 'p-detail': 'home', 'p-remote': 'home', 'p-negocio': 'negocio', 'p-autos': 'autos', 'p-bandeja': 'inbox' };
/** Marca la sección actual en la cabecera y en la barra de abajo (Proyectos comparte pantalla con Dirección). */
function marcarTab(go) {
  for (const t of document.querySelectorAll('#appbar .tabs .tab, #tabbar button')) {
    const de = t.dataset.tab || t.dataset.go || { 'b-negocio': 'negocio', 'b-autos': 'autos', 'b-inbox': 'inbox' }[t.id];
    const on = de === go; t.classList.toggle('on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
}
const show = (id) => {
  for (const s of ['p-login', 'p-list', 'p-detail', 'p-remote', 'p-autos', 'p-bandeja', 'p-negocio']) $('#' + s).hidden = s !== id;
  const bar = $('#tabbar');
  bar.hidden = id === 'p-login';
  const fab = $('#b-ceo'); if (fab && id === 'p-login') fab.hidden = true;
  $('#appbar').hidden = id === 'p-login';
  marcarTab(TAB_OF[id]);
  for (const b of bar.querySelectorAll('button')) { const on = b.dataset.go === TAB_OF[id]; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
};
function goTab(go, push = true) {
  if (push) navPush({ v: go === 'home' ? null : go });
  if (go === 'home') { openId = null; show('p-list'); window.scrollTo(0, 0); return; }
  if (go === 'proyectos') { openId = null; show('p-list'); marcarTab('proyectos'); const z = $('#z-projects'); z.open = true; z.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  $({ negocio: '#b-negocio', autos: '#b-autos', inbox: '#b-inbox' }[go])?.click();
}
// NAVEGACIÓN (V3.6): cada sección, proyecto, objetivo o conversación tiene su dirección (?v= · ?proyecto= · ?objetivo= · ?ceo=):
// el botón Atrás del navegador vuelve a la anterior y un enlace directo abre exactamente eso.
function navPush(q) {
  const u = new URL(location.href);
  const nuevo = 'ceo' in q ? q : { v: null, proyecto: null, objetivo: null, ceo: null, ...q }; // cambiar de pantalla limpia lo demás; la conversación se superpone
  for (const [k, v] of Object.entries(nuevo)) { if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
  u.searchParams.delete('informe');
  if (u.search !== location.search) history.pushState({}, '', u.pathname + u.search);
}
function aplicarRuta() {
  const q = new URLSearchParams(location.search);
  if (q.get('ceo')) void openCeo(q.get('ceo'), { push: false }); else if ($('#ceo').open) cerrarCeo(false);
  if (q.get('proyecto')) { const c = (data.proyectos || []).find((p) => p.id === q.get('proyecto')); if (c) { actions.details(c, false); return; } }
  if (q.get('objetivo')) { nui?.openOne(q.get('objetivo')); return; }
  if (!q.get('ceo') || q.get('v')) goTab(q.get('v') || 'home', false);
}
window.addEventListener('popstate', aplicarRuta);
window.addEventListener('ceo:nav', (e) => navPush(e.detail || {}));
window.addEventListener('ceo:abrir', (e) => { if (e.detail?.ref) void openCeo(e.detail.ref, { pregunta: e.detail.pregunta || null }); });
document.addEventListener('click', (e) => {
  const t = e.target.closest?.('#tabbar [data-go], .tabs [data-tab]');
  if (t) goTab(t.dataset.go || t.dataset.tab);
  // Un clic fuera cierra el menú «Más».
  const m = $('#more');
  if (m?.open && !m.contains(e.target)) m.open = false;
});
let rui = null; // MANDO REMOTO (web/remoto.js)
let aui = null; // AUTOMATIZACIONES y BANDEJA DE APROBACIÓN (web/automatizaciones.js)
let nui = null; // OBJETIVOS DE NEGOCIO (web/negocio.js)

async function refresh() {
  try {
    data = await api.state();
    net = 'ok';
  } catch (e) {
    // Sin red: se dice en el indicador (una vez) y se sigue enseñando lo último conocido; otro fallo sí se avisa.
    const offline = !navigator.onLine || /fetch|network|load failed/i.test(String(e?.message));
    if (offline) { net = 'offline'; paintList(); return; }
    toast(`No se pudo leer: ${e.message}`, 'bad');
    return;
  }
  paintList();
  if (openId) paintDetail();
  rui?.paint();
  aui?.paint();
  nui?.paint();
}

async function run(op, params, okMsg, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api.cmd(op, params);
    if (r?.ok) toast(r.data?.mensaje || okMsg, 'ok'); else toast(r?.error || 'No se pudo', 'bad');
    detailCache = null; // tras una orden, DETALLES (y el mapa) se vuelven a pedir: nada de estado viejo en pantalla
    await refresh();
    return r?.ok;
  } finally { if (btn) btn.disabled = false; }
}

// Hoja modal reutilizable. fields: [{name, label, type:'textarea'|'text', value, placeholder}]
function ask({ title, help = '', fields = [], ok = 'Aceptar', danger = false }) {
  const dlg = $('#dlg');
  // Lo escrito y cerrado sin aceptar (fuera, Escape o Volver) vuelve al reabrir la misma pregunta (web/modal.js).
  const clave = `${title}|${fields.map((f) => f.name).join(',')}`;
  const previo = borrador.leer(clave);
  const inicial = Object.fromEntries(fields.map((f) => [f.name, f.value || '']));
  if (previo) fields = fields.map((f) => (previo[f.name] && !f.value && ['textarea', 'text', undefined].includes(f.type) ? { ...f, value: previo[f.name] } : f));
  $('#dlg-title').textContent = title;
  $('#dlg-help').textContent = help;
  $('#dlg-help').hidden = !help;
  const box = $('#dlg-fields');
  box.textContent = '';
  for (const f of fields) {
    if (f.type === 'checkbox') { box.append(h('label', { class: 'check' }, h('input', { name: f.name, type: 'checkbox', checked: !!f.value }), ' ', f.label)); continue; }
    const required = f.required !== false;
    // choice: una opción de una lista cerrada (p. ej. TikTok / Instagram), ya elegida si sólo hay una.
    if (f.type === 'choice') {
      box.append(h('label', { class: 'field' }, f.label, h('select', { name: f.name, required },
        (f.options || []).length > 1 && !f.value ? h('option', { value: '' }, 'Elige…') : null, (f.options || []).map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)))));
      continue;
    }
    const input = f.type === 'textarea'
      ? h('textarea', { name: f.name, rows: 5, placeholder: f.placeholder || '', required })
      : f.type === 'password' ? h('input', { name: f.name, type: 'password', autocomplete: 'current-password', required })
      : h('input', { name: f.name, type: ['url', 'date'].includes(f.type) ? f.type : 'text', inputmode: f.type === 'url' ? 'url' : f.inputmode || null, max: f.max || null, placeholder: f.placeholder || '', required, spellcheck: 'false' });
    input.value = f.value || '';
    // Intro en un campo de una línea = Aceptar (si no, el formulario enviaría el primer botón: «Volver»).
    if (f.type !== 'textarea') input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dlg-ok').click(); } });
    box.append(h('label', { class: 'field' }, f.label, input));
  }
  const okBtn = $('#dlg-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  box.querySelector('textarea,input,select')?.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') {
        const escrito = {};
        for (const f of fields) if (!f.type || f.type === 'text' || f.type === 'textarea') { const v = box.querySelector(`[name="${f.name}"]`)?.value || ''; if (v.trim() && v !== inicial[f.name]) escrito[f.name] = v; }
        borrador.guardar(clave, escrito);
        return resolve(null);
      }
      borrador.borrar(clave);
      const out = {};
      for (const f of fields) { const el = box.querySelector(`[name="${f.name}"]`); out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'password' ? el.value : el.value.trim(); }
      for (const el of box.querySelectorAll('input[type=password]')) el.value = ''; // la contraseña no se queda en el formulario
      resolve(out);
    }, { once: true });
  });
}

// Editor grande (casi pantalla completa en el móvil). TIPO · SESIÓN · CEO arriba; el texto NUNCA se recorta ni se
// retoca. Sólo avisa cerca del límite práctico de Claude y no deja enviar por encima (lo mismo comprueba el PC).
// `modo` null = sin selector de CEO; `sesiones` false = sin selector de sesión (objetivo nuevo: siempre sesión nueva).
const HELP = {
  INSTRUCCION: { AUTO: 'Codex decide el mejor prompt para Claude.', MANUAL: 'CEO en MANUAL: tu instrucción va tal cual a Claude.' },
  DIRECTO: 'Claude recibe exactamente este texto. Codex no lo lee.',
  CONTINUAR: 'Claude mantiene el contexto de esta conversación.', NUEVA: 'Inicia una conversación limpia con Claude.',
  ANADIR: 'Entra en el objetivo en curso: Claude lo recibe en su sesión ahora (o al empezar su próxima ronda) y lo incorpora sin empezar de cero. No se cerrará sin incorporarlo.',
};
let draft = ''; // lo último escrito y cancelado sin querer (sólo en memoria de esta pestaña)
// `pendientes`: los que esperan a salir; cada uno se edita desde aquí (se cierra SIN enviar y se abre su editor).
// `anadir`: AÑADIR AL OBJETIVO (sin TIPO/SESIÓN/CEO: va al mismo objetivo y a la sesión que ya trabaja).
function compose({ title, text = '', tipo = 'INSTRUCCION', sesion = 'CONTINUAR', modo = null, ok = 'Enviar', sesiones = true, trabajo = null, pendientes = [], anadir = false }) {
  const dlg = $('#composer'), ta = $('#cmp-text'), okBtn = $('#cmp-ok');
  const v = { tipo, sesion, modo };
  $('#cmp-title').textContent = title;
  okBtn.textContent = ok;
  const paint = () => {
    const n = ta.value.length;
    $('#cmp-count').textContent = `${n.toLocaleString('es-ES')} caracteres`;
    const over = n > PROMPT_LIMIT;
    $('#cmp-warn').hidden = n <= PROMPT_WARN;
    $('#cmp-warn').textContent = over ? `Este prompt supera el límite práctico de Claude (${PROMPT_LIMIT.toLocaleString('es-ES')} caracteres). No se recorta: acórtalo o divídelo.`
      : 'Se acerca al límite práctico de Claude.';
    okBtn.disabled = over || !ta.value.trim();
    $('#cmp-help').textContent = anadir ? HELP.ANADIR : [v.tipo === 'DIRECTO' ? HELP.DIRECTO : v.modo ? HELP.INSTRUCCION[v.modo] : 'En AUTO la interpreta Codex; en MANUAL va tal cual a Claude.', sesiones ? HELP[v.sesion] : 'Objetivo nuevo: conversación limpia con Claude.'].join(' ');
  };
  $('#cmp-opts').replaceChildren(...(anadir ? [] : [
    seg('cmp-tipo', 'TIPO', [['INSTRUCCION', 'INSTRUCCIÓN', 'Te digo lo que quiero y Codex decide el prompt'], ['DIRECTO', 'PROMPT DIRECTO', HELP.DIRECTO]], v.tipo, (x) => { v.tipo = x; paint(); }),
    sesiones ? seg('cmp-sesion', 'SESIÓN', [['CONTINUAR', 'CONTINUAR', HELP.CONTINUAR], ['NUEVA', 'NUEVA', HELP.NUEVA]], v.sesion, (x) => { v.sesion = x; paint(); }) : null,
    modo ? seg('cmp-modo', 'CEO', [['AUTO', 'AUTO', MODO_HELP.AUTO], ['MANUAL', 'MANUAL', MODO_HELP.MANUAL]], v.modo, (x) => { v.modo = x; paint(); }) : null,
  ]).filter(Boolean));
  let editar = null;
  const box = $('#cmp-pend');
  box.hidden = !pendientes.length;
  box.replaceChildren(...(pendientes.length ? [h('p', { class: 'lbl' }, `Pendientes de enviar (${pendientes.length})`),
    pendList(pendientes, (p) => [iconBtn('edit', 'Editar pendiente', () => { editar = p; dlg.close(''); })])] : []));
  ta.value = text || draft; // editar un pendiente trae su texto; escribir uno nuevo recupera el borrador
  ta.oninput = paint;
  // Pegar último informe: lo trae CEOPadre (no el portapapeles). Se inserta en el cursor sin borrar nada; no envía
  // ni cambia TIPO/SESIÓN/CEO. Sin objetivo no hay informe que pegar.
  const paste = $('#cmp-paste');
  paste.disabled = !trabajo;
  paste.title = trabajo ? 'Pegar el informe completo del último resultado de Claude' : NO_REPORT;
  paste.setAttribute('aria-label', paste.title);
  paste.onclick = async () => {
    paste.disabled = true;
    const r = await fullReport(trabajo);
    paste.disabled = false;
    if (r.error) { toast(r.error, 'bad'); return; }
    insertText(ta, r.texto);
    paint();
  };
  paint();
  dlg.returnValue = '';
  dlg.showModal();
  ta.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const texto = ta.value;
      const sent = dlg.returnValue === 'ok' && texto.trim() && texto.length <= PROMPT_LIMIT;
      if (!text) draft = sent ? '' : texto;
      resolve(editar ? { editar } : sent ? { texto, ...v } : null);
    }, { once: true });
  });
}

// ------------------------------------------------------------------ iconos (SVG en línea, sin librerías)

const ICONS = {
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 8v7m0-10.5v.5',
  unlink: 'M9 15l6-6M10.5 5.5l1.8-1.8a4.2 4.2 0 0 1 6 6l-1.8 1.8M13.5 18.5l-1.8 1.8a4.2 4.2 0 0 1-6-6l1.8-1.8M3 3l18 18',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 9l6 6M15 9l-6 6',
  message: 'M4 5h16v11H9l-5 4z',
  retry: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8.5v.01',
  folder: 'M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5h5',
  briefcase: 'M3 7h18v12H3zM9 7V5h6v2M3 12h18',
  chevron: 'M6 9l6 6 6-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M8 4h8v3H8zM6 5.5H5V21h14V5.5h-1M9 12h6M9 16h6',
  plus: 'M12 5v14M5 12h14',
};
function svg(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}
// Botón de icono: siempre con aria-label y title (accesible y con ayuda al pasar el ratón).
const iconBtn = (name, label, onclick, cls = '') => h('button', { class: `icon-btn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, svg(name));

// Logo del proyecto o, si no hay, un marcador limpio con la inicial.
function logo(c, cls = '') {
  const ph = () => h('span', { class: `logo ph ${cls}`, 'aria-hidden': 'true' }, (c.nombre || '?').trim().charAt(0).toUpperCase());
  if (!c._logo) return ph();
  const img = h('img', { class: `logo ${cls}`, src: c._logo, alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}

// ------------------------------------------------------------------ acciones

const actions = {
  pause: (c, b) => run('trabajo.pausar', { trabajo: c.trabajo }, 'Pausado', b),
  // CONTINUAR antes de la hora anunciada: el PC no llama a nadie y avisa; probar igualmente es decisión de Antonio.
  async resume(c, b) {
    b.disabled = true;
    let r;
    try { r = await api.cmd('trabajo.reanudar', { trabajo: c.trabajo }); } finally { b.disabled = false; }
    if (r?.ok && r.data?.esperar) {
      const ok = await ask({ title: 'Todavía no', help: `${r.data.mensaje}. Si pruebas ahora se gasta un intento que probablemente falle.`, ok: 'PROBAR AHORA' });
      if (ok) await run('trabajo.reanudar', { trabajo: c.trabajo, probar_ahora: true }, 'Probando ahora', b);
      return;
    }
    if (r?.ok) toast(r.data?.mensaje || 'Reanudado', 'ok'); else toast(r?.error || 'No se pudo', 'bad');
    await refresh();
  },
  // Cancelar = este objetivo termina: se para su ronda en curso. Un monitor persistente sigue vivo salvo que se marque.
  async cancel(c, b, trabajo = c.trabajo, condicion = c.condicion) {
    const ok = await ask({ title: `¿Cancelar ${c.nombre}?`, ok: 'Sí, cancelar', danger: true,
      help: `Se detiene la ronda en curso de este objetivo (y sólo de este). No se borra ni se revierte nada del proyecto; el historial se conserva.${condicion ? ' Su monitor persistente sigue vivo salvo que marques detenerlo.' : ''}`,
      fields: condicion ? [{ name: 'detener', type: 'checkbox', label: 'Detener también su monitor' }] : [] });
    if (ok) run('trabajo.cancelar', { trabajo, confirmar: true, detener_monitores: ok.detener === true }, 'Cancelado', b);
  },
  // AÑADIR AL OBJETIVO: al MISMO objetivo en curso (no es objetivo nuevo, ni instrucción para después, ni prompt directo).
  async add(c, b) {
    const r = await compose({ title: `Añadir al objetivo · ${c.nombre}`, ok: 'Añadir', anadir: true, trabajo: c.trabajo });
    if (r && !(await run('objetivo.anadir', { trabajo: c.trabajo, texto: r.texto }, 'Añadido', b))) draft = r.texto;
  },
  // Escribir (instrucción o prompt directo) sobre el objetivo actual. Con algo en marcha queda como pendiente.
  async instruct(c, b) {
    const pendientes = c.pendientes ? (await api.details(c.id))?.pendientes || [] : [];
    const r = await compose({ title: `Escribir · ${c.nombre}`, modo: c.modo || 'AUTO', trabajo: c.trabajo, pendientes });
    if (r?.editar) { await editPending(r.editar, c.trabajo); return; }
    // Si el PC lo rechaza, el texto vuelve al borrador: nunca se pierde lo escrito.
    if (r && !(await run('trabajo.instruccion', { trabajo: c.trabajo, texto: r.texto, tipo: r.tipo, sesion: r.sesion, modo: r.modo }, 'Enviado', b))) draft = r.texto;
  },
  // ✓ en una autorización de GASTO (regla 0 €) sigue pidiendo un SÍ explícito: es dinero.
  async approve(c, b) {
    if (esGasto(c) && !(await ask({ title: '¿Autorizas este gasto?', help: c.recomendacion || c.propuesta, ok: 'SÍ, AUTORIZO ESTE GASTO', danger: true }))) return;
    await (c.version ? run('decision.resolver', { proyecto: c.id, ref: c.ref, version: c.version, accion: 'APROBAR' }, 'Aprobado', b) : run('trabajo.aprobar', { trabajo: c.trabajo }, 'Aprobado', b));
  },
  reject: (c, b) => (c.version ? run('decision.resolver', { proyecto: c.id, ref: c.ref, version: c.version, accion: 'RECHAZAR' }, 'Rechazado', b) : run('trabajo.rechazar', { trabajo: c.trabajo }, 'Rechazado', b)),
  // ↺ La alternativa del CEO para ESTA versión de la decisión (el PC ejecuta el texto que guardó, no el de la pantalla).
  alternativa: (c, b) => run('decision.alternativa', { proyecto: c.id, ref: c.ref, version: c.version }, 'Alternativa en marcha', b),
  // ? PREGUNTAR A CODEX: sólo una recomendación (llega a la tarjeta en segundos). No aprueba ni rechaza nada.
  consult: (c, ref) => openCeo(`decision:${c.id}:${ref}`, { pregunta: '¿Qué recomiendas y por qué?' }),
  // Objetivo nuevo = sesión de Claude nueva y CEO AUTO por defecto.
  async goal(c, b) {
    const r = await compose({ title: `Nuevo objetivo · ${c.nombre}`, modo: 'AUTO', sesiones: false, ok: 'Iniciar', trabajo: c.trabajo });
    if (r && !(await run('objetivo.iniciar', { proyecto: c.id, texto: r.texto, tipo: r.tipo, modo: r.modo }, 'Objetivo iniciado', b))) draft = r.texto;
  },
  details: (c, push = true) => { openId = c.id; paintDetail(true); show('p-detail'); window.scrollTo(0, 0); if (push) navPush({ proyecto: c.id }); },
  unlink: (c, b) => unlink(c, b),
};

// Acción principal con texto (sólo cuando hay que decidir algo); el resto, iconos.
function buttonsFor(c) {
  const I = (icon, label, act, cls) => iconBtn(icon, label, (e) => actions[act](c, e.currentTarget), cls);
  const T = (label, act) => h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions[act](c, e.currentTarget) }, label);
  const e = c.estado;
  const info = I('info', `Detalles de ${c.nombre}`, 'details');
  const instr = I('message', 'Escribir instrucción o prompt', 'instruct');
  const add = I('plus', 'Añadir al objetivo en curso', 'add', 'accent');
  const stop = I('stop', 'Cancelar objetivo', 'cancel', 'danger');
  // LISTO: Claude entregó y espera. CONTINUAR = primer pendiente o (AUTO) que el CEO retome; en MANUAL sin nada, escribir.
  if (e === 'LISTO') return [c.modo !== 'MANUAL' || c.pendientes || c.anadidos ? T(c.modo === 'MANUAL' ? 'ENVIAR SIGUIENTE' : 'CONTINUAR', 'resume') : null,
    add, instr, I('target', 'Nuevo objetivo', 'goal', 'accent'), stop, info];
  // Esperando una condición: no ocupa el hueco; se puede empezar otro objetivo, reactivarlo ya o añadirle algo.
  if (e === 'ESPERANDO_CONDICION') return [I('target', 'Nuevo objetivo', 'goal', 'accent'), I('play', 'Reactivar ahora', 'resume'), add, stop, info];
  // Espera algo que sólo puede hacer Antonio: se sigue comprobando sola; «Ya lo he hecho» la comprueba y sigue ya.
  if (e === 'ESPERANDO_ANTONIO') return [T('YA LO HE HECHO', 'resume'), I('target', 'Nuevo objetivo', 'goal', 'accent'), add, stop, info];
  if (OPEN.includes(e)) return [I('target', 'Nuevo objetivo', 'goal', 'accent'), e === 'TERMINADO' ? instr : null, info, I('unlink', 'Quitar de CEOPadre', 'unlink', 'danger')];
  if (e === 'ESPERANDO_DECISION') return [add, instr, stop, info];
  if (WAITING.includes(e)) return [T('CONTINUAR', 'resume'), I('pause', 'Pausar', 'pause'), add, instr, stop, info];
  if (e === 'TRABAJANDO' || e === 'EN_COLA') return [add, I('pause', 'Pausar', 'pause'), e !== 'EN_COLA' ? instr : null, stop, info];
  // Sin señales: sigue siendo trabajo en curso (CEOPadre lo corta y reintenta solo); relanzarlo ya es una emergencia.
  if (e === 'SIN_ACTIVIDAD') return [add, I('pause', 'Pausar', 'pause'), I('play', 'Reintentar ahora', 'resume'), instr, stop, info];
  return [T(e === 'PAUSADO' ? 'REANUDAR' : 'REINTENTAR', 'resume'), add, instr, stop, info];
}

const line = (label, text, cls = '') => h('p', { class: `ln ${cls}` }, h('b', {}, label), ' ', text || '—');
// Regla 0 €: una autorización de gasto se enseña con el bloque literal (qué, cuánto, para qué, alternativa gratis) y con
// botones que dicen que se autoriza GASTAR DINERO; el resto de decisiones, como siempre.
const esGasto = (x) => (x.propuesta || '').startsWith('⚠️ AUTORIZACIÓN DE GASTO');
const decisionLines = (x) => {
  if (esGasto(x)) return [h('p', { class: 'ln gasto' }, x.recomendacion || x.propuesta)];
  const [rec, opts] = String(x.recomendacion || '').split(/\n?OPCIONES:\n?/);
  // Las alternativas, a la vista (antes plegadas): cada una en su línea, con su letra.
  const alts = String(opts || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return [line('QUÉ NECESITA', x.propuesta), rec ? line('EL CEO RECOMIENDA', rec) : null,
    alts.length ? h('ul', { class: 'alts' }, alts.map((a) => { const m = /^([A-Z])\s*[—:–-]\s*(.*)$/.exec(a); return h('li', {}, m ? [h('b', {}, m[1]), ' ', m[2]] : a); })) : null];
};
/** TRABAJO POSTERIOR FUERA DE CEOPADRE: lo que se espera de Antonio puede estar superado. Sólo avisa (con datos) y deja
 *  conciliar: nunca da la pregunta por respondida ni el objetivo por terminado (src/commands.js trabajo.conciliar). */
function superadaBox(c) {
  const s = c.superada;
  if (!s) return null;
  const donde = (s.carpetas || []).map((x) => `${x.nombre} (${x.n})`).join(' · ');
  return h('div', { class: 'superada', role: 'note' },
    h('p', { class: 'ln' }, h('b', {}, 'TRABAJO POSTERIOR FUERA DE CEOPADRE'),
      ` ${s.archivos}${s.parcial ? '+' : ''} archivo${s.archivos === 1 ? '' : 's'} cambiado${s.archivos === 1 ? '' : 's'} después de esto (último ${when(s.ultimo)})${donde ? `: ${donde}` : ''}. Puede estar superado; no se ha dado por respondido ni autorizado.`),
    s.muestra?.length ? h('details', { class: 'prop-more', 'data-k': `sup-${c.trabajo}` }, h('summary', {}, 'Qué cambió'), h('ul', { class: 'a-pend' }, s.muestra.map((x) => h('li', { class: 'mono' }, x)))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'button', title: 'El CEO hace que Claude relea el estado real y, si sigue haciendo falta, te vuelve a preguntar con datos nuevos',
        onclick: (e) => run('trabajo.conciliar', { trabajo: c.trabajo }, 'Enviado', e.currentTarget) }, 'REVISAR CON LO NUEVO'),
      h('button', { class: 'btn ghost small', type: 'button', title: 'Lo que se te pide sigue vigente: deja de avisar hasta que haya cambios nuevos',
        onclick: (e) => run('trabajo.vigente', { trabajo: c.trabajo }, 'Anotado', e.currentTarget) }, 'Sigue vigente')));
}
/** La decisión del objetivo (ESPERANDO_DECISION): qué cambia, recomendación de Codex si la hay y ✓ ✕ ?. Igual en todas partes. */
// Qué pasa con cada botón, dicho antes de pulsarlo (lo que hace de verdad el motor: trabajo.aprobar / trabajo.rechazar).
const conseq = (c) => (esGasto(c) ? null : h('p', { class: 'ln conseq' }, h('b', {}, 'SI APRUEBAS'), ' el CEO sigue con lo propuesto. ',
  h('b', {}, 'SI RECHAZAS'), ' busca otra vía sin ese cambio o termina explicando por qué no se puede.'));
const jobDecision = (c) => (c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' }, superadaBox(c),
  ...(explica(c.consejo, 'trabajo') && !esGasto(c) ? [explica(c.consejo, 'trabajo'), h('details', { class: 'prop-more tecnico' }, h('summary', {}, 'Detalle técnico'), ...decisionLines(c))]
    : [...decisionLines(c), advice(c.consejo), conseq(c)]),
  copiarBtn(`decision:${c.id}:${c.ref}`),
  decideRow({ yes: (e) => actions.approve(c, e.currentTarget), no: (e) => actions.reject(c, e.currentTarget),
    ask: c.ref ? (e) => actions.consult(c, c.ref, e.currentTarget) : null,
    alt: c.consejo?.alternativa && c.version ? (e) => actions.alternativa(c, e.currentTarget) : null, altLabel: c.consejo?.alternativa?.etiqueta, rec: c.consejo?.veredicto,
    yesLabel: esGasto(c) ? 'Sí, autorizo este gasto' : c.consejo?.aprobar || 'Aprobar la propuesta', noLabel: esGasto(c) ? 'No autorizo este gasto' : c.consejo?.rechazar || 'Rechazar la propuesta' }),
  h('button', { class: 'link', type: 'button', onclick: (e) => actions.instruct(c, e.currentTarget) }, 'Responder otra cosa o pedir una aclaración')) : null);

// ------------------------------------------------------------------ la oficina

// Texto del estado en los puestos (lo que Antonio lee de un vistazo).
const MOOD_LABEL = { ESPERANDO_DECISION: 'Necesita tu respuesta', ERROR: 'Hay un problema', BLOQUEADO: 'Bloqueado',
  SIN_ACTIVIDAD: 'Trabajando (sin señales; se recupera solo)', TRABAJANDO: 'Trabajando', ESPERANDO_CLAUDE: 'Sin cuota de Claude · esperando', ESPERANDO_CEO: 'Sin cuota del CEO · esperando',
  ESPERANDO_CONDICION: 'Esperando algo externo', ESPERANDO_ANTONIO: 'Necesita que hagas algo', EN_COLA: 'Próximo: en cola', LIBRE: 'Sin objetivo', PAUSADO: 'En pausa', LISTO: 'Te toca: continuar', TERMINADO: 'Terminado y comprobado', CANCELADO: 'Cancelado' };
// Una decisión pendiente de Antonio (del objetivo o del canon) manda sobre cualquier otro estado.
const decisionLabel = (c) => { const n = decisionCount(c); return n > 1 ? `Necesita tu respuesta · ${n}` : 'Necesita tu respuesta'; };
const status = (c, text) => h('span', { class: 'status' }, h('i', { class: 'dot', 'aria-hidden': 'true' }),
  text || (needsDecision(c) ? decisionLabel(c) : MOOD_LABEL[c.estado] || c.estado));

/** Decisiones del canon (preguntas y cambios protegidos) en el puesto: cuántas, estado real del objetivo y a decidirlas. */
function canonDecisionLine(c) {
  const n = (c.decisiones?.length || 0) + (c.propuestas?.length || 0);
  if (!n) return null;
  return h('div', { class: 'decision' },
    h('p', { class: 'ln' }, h('b', {}, 'NECESITA TU RESPUESTA'), ` ${n} ${n === 1 ? 'pregunta pendiente' : 'preguntas pendientes'}`,
      c.estado !== 'ESPERANDO_DECISION' && c.estado !== 'LIBRE' ? ` · el objetivo sigue: ${MOOD_LABEL[c.estado] || c.estado}` : ''),
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => openDecisions(c.id) }, 'RESPONDER')));
}

/** Puesto de trabajo (EN MARCHA): qué hace, qué sigue y, si hay que decidir, la decisión a mano. */
// «última señal hace N»: la hora del último evento real del proceso (no un contador que avanza solo): lento ≠ parado.
const signal = (c) => (c.ultima_actividad ? `última señal ${ago(c.ultima_actividad)}` : '');
// Lo que el puesto pide a Antonio cuando no es una pregunta: dicho en una frase, con el botón que lo resuelve al lado.
function needLine(c) {
  if (WAITING.includes(c.estado)) { const [a, b] = waitLines(c); return line('TE NECESITA', `${a} ${b}`); }
  if (c.estado === 'ESPERANDO_ANTONIO') return line('TE NECESITA', c.te_necesita || 'Una acción tuya: cuando la hagas, CEOPadre lo comprueba solo y sigue.');
  if (c.estado === 'LISTO') return line('TE TOCA', c.modo === 'MANUAL' ? 'Claude terminó su parte: envía la siguiente instrucción.' : 'Claude terminó su parte: pulsa Continuar o da una instrucción.');
  return null;
}
function desk(c) {
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  const decision = jobDecision(c);
  const need = needLine(c);
  return h('article', { class: `desk m-${mood(c)}`, 'data-id': c.id },
    h('header', { class: 'unit-head' }, logo(c),
      h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c)),
      c.estado === 'TRABAJANDO' ? h('span', { class: 'beacon', title: 'Trabajando ahora', 'aria-hidden': 'true' }) : null),
    h('p', { class: 'ln goal', title: c.objetivo }, cleanGoal(c.objetivo)),
    need,
    running ? line('HACIENDO AHORA', c.actividad ? `${c.actividad} · ${signal(c)}` : 'preparando el siguiente paso') : null,
    need || decision ? null : line(running ? 'ÚLTIMO AVANCE' : 'SITUACIÓN', c.ahora),
    running && c.siguiente ? line('DESPUÉS', c.siguiente, 'next') : null,
    c.detalle && ['BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'].includes(c.estado) ? h('p', { class: 'note' }, c.detalle) : null,
    c.pendientes ? h('p', { class: 'ln muted' }, h('b', {}, 'PENDIENTES'), ` ${c.pendientes}`) : null,
    c.anadidos ? h('p', { class: 'ln muted' }, h('b', {}, 'AÑADIDO'), ` ${c.anadidos} sin incorporar todavía`) : null,
    decision || superadaBox(c),
    canonDecisionLine(c),
    h('div', { class: 'actions' }, buttonsFor(c)));
}

/** Otro objetivo del proyecto que espera algo que sólo puedes hacer tú (renovar un permiso…): qué y el botón que lo resuelve. */
function tuyaCard(x) {
  const hum = esperaHumana(x.condicion || '');
  return h('article', { class: 'desk m-need', 'data-id': `${x.c.id}:${x.trabajo}` },
    h('header', { class: 'unit-head' }, logo(x.c), h('div', { class: 'title' }, h('h3', {}, x.c.nombre), status({ estado: 'ESPERANDO_ANTONIO' }))),
    h('p', { class: 'ln goal', title: x.objetivo }, cleanGoal(x.objetivo)),
    line('TE NECESITA', hum.que ? hum.que.charAt(0).toUpperCase() + hum.que.slice(1) : x.condicion),
    h('p', { class: 'ln muted' }, 'Cuando lo hagas, CEOPadre lo comprueba solo y sigue. Si ya lo has hecho, pulsa el botón.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: (e) => run('trabajo.reanudar', { trabajo: x.trabajo }, 'Comprobando', e.currentTarget) }, 'Ya lo he hecho'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => actions.details(x.c) }, 'Ver detalles')));
}
/** ESPERANDO ALGO EXTERNO: en lenguaje normal (qué falta, cuándo se miró, qué pasará). Lo técnico, en la ficha. */
function waitCard(x) {
  const c = x.c, e = x.esperas[0];
  const hum = esperaHumana(e?.descripcion || x.condicion || '');
  const que = hum.que ? hum.que.charAt(0).toUpperCase() + hum.que.slice(1) : 'Algo que no depende del CEO.';
  const hasta = e?.hasta ? new Date(e.hasta).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
  return h('article', { class: 'wait-card', 'data-id': `${c.id}:${x.trabajo}` },
    h('header', { class: 'unit-head' }, logo(c), h('div', { class: 'title' }, h('h3', {}, `${c.nombre} — ${hum.titulo}`),
      h('small', { class: 'muted goal1', title: x.objetivo }, hum.asunto || cleanGoal(x.objetivo)))),
    h('p', { class: 'wait-lead' }, 'Este trabajo sigue en cuanto ocurra. CEOPadre lo comprueba solo y continúa: no tienes que hacer nada.'),
    h('dl', { class: 'wait-dl' },
      h('dt', {}, 'Qué falta'), h('dd', {}, que),
      e ? [h('dt', {}, 'Última comprobación'), h('dd', {}, `${e.comprobada ? ago(e.comprobada) : 'aún no'}${e.error ? ' · no se pudo comprobar' : ' · todavía no ha llegado'} · se mira cada ${Math.round(e.cada_s / 60) || 1} min${hasta ? ` hasta el ${hasta}` : ''}`)] : null,
      h('dt', {}, 'Cuando llegue'), h('dd', {}, hum.luego)),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onclick: () => openCeo(e ? `espera:${e.id}` : `trabajo:${x.trabajo}`, { pregunta: '¿Qué falta exactamente, para qué sirve y dónde debo dejarlo?' }) }, 'Ver qué falta'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => openCeo(e ? `espera:${e.id}` : `trabajo:${x.trabajo}`) }, '💬 Consultar al CEO'),
      e ? h('button', { class: 'btn ghost small', type: 'button', onclick: (ev) => run('espera.comprobar', { id: e.id }, 'Comprobado', ev.currentTarget) }, 'Comprobar ahora') : null,
      h('button', { class: 'link', type: 'button', onclick: () => actions.details(c) }, 'Ver detalles')));
}

/** Azulejo (EN ESPERA): logo, nombre, estado mínimo y las acciones de siempre (y, si espera, qué espera). */
function tile(c) {
  return h('article', { class: `tile m-${mood(c)}`, 'data-id': c.id },
    logo(c),
    h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c),
      c.estado === 'ESPERANDO_CONDICION' && c.condicion ? h('small', { class: 'muted cond', title: c.condicion }, c.condicion) : null,
      c.estado === 'ESPERANDO_ANTONIO' && c.te_necesita ? h('small', { class: 'muted cond', title: c.te_necesita }, c.te_necesita) : null),
    h('div', { class: 'actions' }, buttonsFor(c)));
}

// GESTIONES: una unidad más de la oficina (mismo tamaño que sus vecinas) que se abre como un cajón, en la misma página.
let gestOpen = (() => { try { return localStorage.getItem('ceo-gest-open') === '1'; } catch { return false; } })();
function gestUnit(o, asDesk) {
  const r = o.resumen;
  const m = r.necesita ? 'need' : r.trabajando ? 'work' : r.esperando ? 'wait' : 'idle';
  const toggle = () => {
    gestOpen = !gestOpen;
    try { localStorage.setItem('ceo-gest-open', gestOpen ? '1' : '0'); } catch { /* sin almacenamiento */ }
    paintList();
    $('[data-id="gestiones"] .chevron')?.focus({ preventScroll: true });
  };
  const btn = h('button', { class: `icon-btn chevron${gestOpen ? ' open' : ''}`, type: 'button', 'aria-expanded': String(gestOpen), 'aria-controls': 'gest-list',
    'aria-label': gestOpen ? 'Cerrar GESTIONES' : 'Abrir GESTIONES', title: gestOpen ? 'Cerrar' : 'Abrir', onclick: (e) => { e.stopPropagation(); toggle(); } }, svg('chevron'));
  const head = [h('img', { class: 'logo', src: 'gestiones.svg', alt: '', width: 36, height: 36 }),
    h('div', { class: 'title' }, h('h3', {}, 'GESTIONES'), status({ estado: '' }, gestText(r)))];
  // Abierta: la propia unidad se despliega a lo ancho con sus gestiones dentro (un cajón, no otra página).
  if (gestOpen) {
    return h('section', { class: `drawer gest m-${m} is-open`, 'data-id': 'gestiones', 'aria-label': 'Gestiones' },
      h('header', { class: 'unit-head' }, ...head,
        h('button', { class: 'btn primary small', type: 'button', onclick: (e) => createFolder('gestion.crear', 'gestión', 'E:\\ECOAPP\\Gestiones', e.currentTarget) }, '+ Nueva gestión'),
        btn),
      h('div', { class: 'drawer-grid', id: 'gest-list' },
        o.gestiones.length ? o.gestiones.map((c) => (zone(c) === 'marcha' ? desk(c) : tile(c)))
          : h('p', { class: 'zone-empty' }, 'Todavía no hay gestiones. Crea la primera: Hacienda, Facturas, Seguros…')));
  }
  return h('article', { class: `${asDesk ? 'desk' : 'tile'} gest m-${m}`, 'data-id': 'gestiones', onclick: toggle },
    asDesk ? [h('header', { class: 'unit-head' }, ...head, btn), h('p', { class: 'ln' }, 'Asuntos pequeños con su propia carpeta: Hacienda, facturas, seguros…')]
      : [...head, h('div', { class: 'actions' }, btn)]);
}

function repaint(box, items) {
  const active = document.activeElement?.closest?.('[data-id]')?.dataset.id;
  box.replaceChildren(...items);
  if (active) box.querySelector(`[data-id="${CSS.escape(active)}"] button`)?.focus({ preventScroll: true });
}

// CENTRO DE DIRECCIÓN (V3.3). Arriba, las cuatro preguntas; debajo, cada trabajo en UNA sección (sin repetir tarjetas):
// necesita tu intervención · con problemas · trabajando · esperando algo externo · próximos · conseguido · proyectos y agentes.
// El reparto es web/zones.js direccion() (estados reales del motor; nada estimado). Las secciones vacías no ocupan sitio.
function paintList() {
  const pcl = $('#pc-line');
  pcl.hidden = LOCAL || data.pc.online || net === 'offline';
  if (!pcl.hidden) pcl.textContent = data.pc.visto ? `El PC no está conectado (visto ${ago(data.pc.visto)}). Ves el último estado conocido; las órdenes no se envían.` : 'Aún no se ha visto el PC.';
  $('#acct').textContent = data.cuenta || '';
  paintNet();
  const o = office(data.proyectos);
  const d = direccion(data.proyectos);
  const inboxN = data.proyectos.reduce((a, c) => a + (c.bandeja || []).filter((m) => ['PENDIENTE', 'BLOQUEADO', 'NO_CONFIRMADO', 'FALLIDO'].includes(m.estado)).length, 0);
  const negNeed = (data.negocio?.te_necesitan || 0) + (data.negocio?.necesidades || 0);
  // Cosas que te esperan (no tarjetas): cada pregunta, cada puesto que te pide algo, las respuestas y los objetivos de negocio.
  const need = d.kpis.decisiones + d.necesita.filter((c) => !needsDecision(c)).length + d.tuyas.length + inboxN + negNeed;
  repaint($('#atender'), [...d.necesita.filter((c) => !needsDecision(c)).map(desk), ...d.tuyas.map(tuyaCard)]);
  $('#n-need').textContent = String(need);
  $('#z-need').hidden = !need;
  // Con problemas: sólo si hay.
  repaint($('#problemas'), d.problemas.map(desk));
  $('#n-bad').textContent = String(d.problemas.length);
  $('#z-bad').hidden = !d.problemas.length;
  // Trabajando: la actividad real de Claude; vacío = una línea, no un hueco.
  repaint($('#marcha'), d.trabajando.map(desk));
  $('#n-marcha').textContent = String(d.trabajando.length);
  $('#marcha-empty').hidden = d.trabajando.length > 0;
  // Esperando algo externo: en lenguaje normal.
  repaint($('#esperando'), d.esperando.map(waitCard));
  $('#n-wait').textContent = String(d.esperando.length);
  $('#z-wait').hidden = !d.esperando.length;
  // Todos los proyectos: plegado al final (GESTIONES + los que tienen historia + los que están en reposo).
  repaint($('#espera'), [gestUnit(o, false), ...d.conHistoria.map(tile)].filter(Boolean));
  paintIdle(d.sinActividad);
  $('#n-espera').textContent = String(d.kpis.proyectos);
  $('#office-sum').textContent = need ? `${need} ${need === 1 ? 'cosa te espera' : 'cosas te esperan'}` : 'nada te espera ahora';
  $('#empty').hidden = data.proyectos.length > 0;
  paintBrief(d, need, inboxN);
  paintGoals();
  paintNext(d);
  paintDone(d);
  paintProjects(d);
  paintTabs(inboxN, negNeed);
  paintQuota();
  paintDecisions();
  paintConditions();
  rui?.paintCards($('#remotes'));
}

// LAS CUATRO PREGUNTAS: cada respuesta en una frase con su número real, y un toque lleva al detalle.
let briefSig = null;
function paintBrief(d, need, inboxN) {
  const k = d.kpis, prox = k.proxima;
  const negNext = (goals.list || []).find((o) => o.vista?.despues && ['ACTIVA', 'ESPERANDO_ANTONIO'].includes(o.estado));
  const first = d.necesita[0];
  const items = [
    ['need', '¿Qué necesita de mí?', need ? `${need} ${need === 1 ? 'cosa' : 'cosas'}` : 'Nada ahora',
      need ? [first && `${first.nombre}: ${needsDecision(first) ? 'una respuesta' : (MOOD_LABEL[first.estado] || '').toLowerCase()}`, inboxN && `${inboxN} respuesta${inboxN === 1 ? '' : 's'} por aprobar`].filter(Boolean).join(' · ') : 'CEOPadre sigue solo y te avisará', () => scrollToId('z-need')],
    ['work', '¿Qué está haciendo?', k.trabajando ? `${k.trabajando} en marcha` : 'Nada en marcha',
      [d.trabajando[0] && `${d.trabajando[0].nombre}: ${d.trabajando[0].actividad || 'trabajando'}`, k.esperando && `${k.esperando} esperando algo externo`, k.problemas && `${k.problemas} con problemas`].filter(Boolean).join(' · ') || 'Dale un objetivo a un proyecto', () => scrollToId(k.trabajando ? 'h-marcha' : k.esperando ? 'z-wait' : 'h-marcha')],
    ['done', '¿Qué ha conseguido?', `${k.terminados7} ${k.terminados7 === 1 ? 'terminado' : 'terminados'}`,
      `esta semana, comprobados con evidencia${data.negocio?.abiertos ? ` · ${data.negocio.abiertos} objetivo${data.negocio.abiertos === 1 ? '' : 's'} de negocio en marcha` : ''}`, () => scrollToId('s-done')],
    // Lo que el DIRECTOR decidió hacer después (objetivos de negocio) manda sobre los horarios.
    negNext ? ['next', '¿Qué hará después?', cleanGoal(negNext.titulo).slice(0, 40), negNext.vista.despues.slice(0, 140), () => nui?.openOne(negNext.id)] :
    ['next', '¿Qué hará después?', prox ? hhmm(prox.programa.proxima) : 'Nada programado',
      prox ? `${prox.nombre.charAt(0)}${prox.nombre.slice(1).toLowerCase()} · ${prox.proyectoNombre}` : d.pausadas.length ? `${d.pausadas.length} con horario en pausa` : 'Programa un agente en Agentes', () => scrollToId('s-next')],
  ];
  const sig = JSON.stringify(items.map((x) => x.slice(0, 4)));
  if (sig === briefSig) return;
  briefSig = sig;
  $('#kpis').replaceChildren(...items.map(([cls, q, a, sub, go]) => h('button', { class: `q-tile q-${cls}${cls === 'need' && need ? ' hot' : ''}`, type: 'button', onclick: go },
    h('span', { class: 'q-q' }, q), h('span', { class: 'q-a' }, a), h('small', { class: 'q-s' }, sub))));
}
// replaceChildren() pinta «null» y los arrays como texto: sólo nodos.
const fill = (box, ...kids) => box.replaceChildren(...kids.flat(Infinity).filter(Boolean));
const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// Cabecera de cada panel lateral: título, contador y, si hay, un enlace a la vista completa.
const sideHead = (id, title, n, link) => h('header', { class: 'side-head' }, h('h2', { id }, title), n != null ? h('span', { class: 'count' }, String(n)) : null,
  link ? h('button', { class: 'link', type: 'button', onclick: link[1] }, link[0]) : null);

// OBJETIVOS EMPRESARIALES: el resumen de la vista de Negocio (misma orden negocio.lista; cada 60 s como mucho).
const goals = { at: 0, list: null, busy: false };
function paintGoals() {
  const n = data.negocio?.abiertos || 0;
  if (n && !goals.busy && Date.now() - goals.at > 60_000 && data.pc.online !== false) {
    goals.busy = true;
    void api.cmd('negocio.lista', {}).then((r) => { if (r?.ok) goals.list = r.data.objetivos; })
      // El intento cuenta aunque falle (sin red / PC caído): sin esto, finally → paintGoals → otra llamada al instante, en bucle.
      .finally(() => { goals.at = Date.now(); goals.busy = false; paintGoals(); });
  }
  const list = n ? (goals.list || []).filter((g) => !['ALCANZADA', 'CANCELADA', 'CERRADA'].includes(g.estado)) : [];
  const kpi = (g) => { const x = g.kpis.find((k) => k.disponible && k.valor != null); return x ? `${x.nombre}: ${x.valor}${x.unidad ? ` ${x.unidad}` : ''} de ${x.objetivo}` : g.kpis.length ? 'resultados aún sin medir' : 'sin indicadores aprobados'; };
  const sig = JSON.stringify([n, list.map((g) => [g.id, g.estado, kpi(g), g.trabajos.terminados, g.trabajos.en_curso?.ahora])]);
  const box = $('#s-goals');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  // Los que te necesitan (plan por aprobar, pregunta, bloqueo) también van a «Necesita tu intervención».
  fill($('#need-goals'), list.filter((g) => g.te_necesita).map((g) => h('div', { class: 'decision need-goal' },
    h('p', { class: 'ln' }, h('b', {}, 'OBJETIVO DE NEGOCIO'), ` ${g.titulo} · ${g.estado_texto}${g.pregunta ? ` · ${g.pregunta}` : ''}`),
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => nui?.openOne(g.id) }, g.estado === 'ESPERANDO_APROBACION' ? 'Revisar el plan' : 'Abrir y responder')))));
  fill(box, sideHead('h-goals', 'Objetivos de negocio', n, ['Ver todos', () => nui?.open()]),
    n && !goals.list ? h('p', { class: 'muted small' }, 'Cargando…')
      : list.length ? h('ul', { class: 'side-list goals' }, list.map((g) => h('li', { class: `g-${g.te_necesita ? 'need' : 'ok'}` },
        h('button', { class: 'side-item', type: 'button', onclick: () => nui?.openOne(g.id) },
          h('b', {}, g.titulo), h('span', { class: `a-chip t-${g.te_necesita ? 'ask' : g.estado === 'ACTIVA' ? 'work' : 'idle'}` }, g.estado_texto),
          h('small', { class: 'muted' }, `Resultado: ${kpi(g)} · ${g.trabajos.terminados} trabajo${g.trabajos.terminados === 1 ? '' : 's'} hecho${g.trabajos.terminados === 1 ? '' : 's'}${g.trabajos.en_curso ? ` · ahora en ${g.trabajos.en_curso.proyecto}` : ''}`)))))
        : [h('p', { class: 'muted small' }, 'Escribe el resultado que quieres («Quiero conseguir clientes para GEST7 por redes sociales»): el CEO lo analiza, te pregunta lo necesario, lo organiza y trabaja solo.'),
          h('button', { class: 'btn primary', type: 'button', disabled: data.pc.online === false, onclick: (e) => nui?.crear(e.currentTarget) }, '+ Nuevo objetivo de negocio')]);
}

// PRÓXIMOS TRABAJOS: sólo lo programado (fecha, hora y para qué) o preparado para empezar. Las esperas tienen su sección.
function paintNext(d) {
  const items = d.proximos.slice(0, 6);
  const sig = JSON.stringify([items, d.pausadas.map((a) => a.id)]);
  const box = $('#s-next');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  fill(box, sideHead('h-next', 'Próximos trabajos', items.length, ['Agentes', () => $('#b-autos').click()]),
    items.length ? h('ul', { class: 'side-list' }, items.map((x) => h('li', {}, h('button', { class: 'side-item', type: 'button', onclick: () => (x.tipo === 'auto' ? $('#b-autos').click() : actions.details({ id: x.id })) },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, x.tipo === 'auto' ? '⏰' : '⏳'),
      h('b', {}, x.tipo === 'auto' ? `${hhmm(x.cuando)} · ${x.titulo.toLowerCase()}` : cleanGoal(x.titulo)),
      h('small', { class: 'muted' }, `${x.proyecto}${x.para ? ` · ${x.para}` : ''}`)))))
      : h('p', { class: 'muted small' }, 'Nada programado ni en cola.'),
    d.pausadas.length ? h('p', { class: 'muted small' }, `Con horario en pausa: ${d.pausadas.map((a) => `${a.nombre.toLowerCase()} (${a.proyectoNombre}, ${a.programa.texto.replace(' (hora de Madrid)', '').toLowerCase()})`).join(' · ')}`) : null);
}

// TERMINADO Y COMPROBADO: objetivos cerrados (el motor sólo cierra con evidencia) y ejecuciones de agentes completadas.
function paintDone(d) {
  const sig = JSON.stringify([d.terminados.map((c) => [c.id, c.updated_at, c.ahora]), d.autosHechas.map((a) => [a.id, a.ultima.fin])]);
  const box = $('#s-done');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const day = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  fill(box, sideHead('h-done', 'Terminado y comprobado', null),
    d.terminados.length || d.autosHechas.length ? h('ul', { class: 'side-list done' },
      d.terminados.slice(0, 3).map((c) => h('li', {}, h('button', { class: 'side-item', type: 'button', onclick: () => actions.details(c) },
        h('span', { class: 'ico ok', 'aria-hidden': 'true' }, '✓'), h('b', {}, c.nombre), h('small', { class: 'muted' }, `${day(c.updated_at)} · ${c.ahora || 'terminado'}`)))),
      d.autosHechas.slice(0, 2).map((a) => h('li', {}, h('button', { class: 'side-item', type: 'button', onclick: () => $('#b-autos').click() },
        h('span', { class: 'ico ok', 'aria-hidden': 'true' }, '⚙'), h('b', {}, `${a.nombre.toLowerCase()} · ${a.proyectoNombre}`),
        h('small', { class: 'muted' }, `${day(a.ultima.fin)} · ${a.ultima.resultado?.resumen || 'completada'}`)))))
      : h('p', { class: 'muted small' }, 'Aún no hay trabajos cerrados.'));
}

// PROYECTOS Y AGENTES: accesos, no tarjetas. Los proyectos con actividad como fichas pequeñas; el resto, a un toque.
function paintProjects(d) {
  const box = $('#s-proj');
  const act = d.conHistoria;
  const sig = JSON.stringify([act.map((c) => [c.id, c.estado, c.logo]), d.kpis.proyectos, d.kpis.agentes]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  fill(box, sideHead('h-proj', 'Proyectos y agentes', null),
    h('div', { class: 'chips' }, act.slice(0, 8).map((c) => h('button', { class: 'pchip', type: 'button', title: `${c.nombre} · ${MOOD_LABEL[c.estado] || c.estado}`, onclick: () => actions.details(c) },
      logo(c), h('span', {}, c.nombre)))),
    h('div', { class: 'row side-links' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => goTab('proyectos') }, `Todos los proyectos (${d.kpis.proyectos})`),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => $('#b-autos').click() }, `Agentes (${d.kpis.agentes})`)));
}

// Proyectos en reposo: una fila compacta (logo + nombre), plegada. Un toque abre su ficha.
let idleOpen = false;
function paintIdle(list) {
  const box = $('#idle');
  const sig = JSON.stringify([idleOpen, list.map((c) => [c.id, c.nombre, c.estado, c.logo])]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(...(list.length ? [h('details', { class: 'fold idle-fold', open: idleOpen ? true : null, ontoggle: (e) => { idleOpen = e.currentTarget.open; box.dataset.sig = ''; } },
    h('summary', {}, `En reposo · ${list.length}`, h('small', { class: 'muted' }, ' sin objetivo activo ni actividad reciente')),
    h('div', { class: 'chips' }, list.map((c) => h('button', { class: 'pchip', type: 'button', 'data-id': c.id, title: `${c.nombre} · ${MOOD_LABEL[c.estado] || c.estado}`, onclick: () => actions.details(c) },
      logo(c), h('span', {}, c.nombre), h('small', { class: 'muted' }, (MOOD_LABEL[c.estado] || c.estado).toLowerCase())))))] : []));
}

// Pestañas: la de arriba (PC) y la barra inferior (móvil) dicen dónde estás y cuántas cosas te esperan.
function paintTabs(inboxN, negNeed) {
  const bar = $('#tabbar');
  const badge = (go, n) => { const b = bar.querySelector(`[data-go="${go}"] .badge`); if (!b) return; b.hidden = !n; b.textContent = String(n); };
  badge('inbox', inboxN);
  badge('negocio', negNeed);
}

// CONDICIONES EN ESPERA (vista global, plegada por defecto): cada condición completa con su COPIAR, y COPIAR TODAS.
// Sale de las mismas tarjetas que se acaban de pintar; sólo se repinta si cambia algo (no rompe una selección ni el foco).
let condOpen = false, condSig = null;
async function copyCond(text, b) {
  b.disabled = true;
  try {
    const ok = await copyText(text);
    toast(ok ? 'Copiado' : 'CEOPadre no pudo copiar.', ok ? 'ok' : 'bad');
  } finally { b.disabled = false; }
}
function paintConditions() {
  const list = waitingConditions(data.proyectos);
  const sig = JSON.stringify(list);
  if (sig === condSig) return;
  condSig = sig;
  fill($('#conds'), list.length ? h('button', { class: 'link', type: 'button', title: 'Copiar todas las esperas, completas, para pegarlas donde quieras',
    onclick: (e) => copyCond(conditionsText(list), e.currentTarget) }, 'Copiar todas') : null);
}

// DECISIONES PENDIENTES (vista global): las preguntas que sólo contesta Antonio, agrupadas por proyecto. Sin IA: salen
// tal cual del canon de cada tarjeta. RESPONDER guarda la respuesta como decisión del canon; POSPONER la aparca 7 días.
/** ✓ ✕ ↺ de un cambio protegido del mapa: con la versión vista (si cambió, el PC no ejecuta nada). */
const decideCanon = (pid) => (id, que, b, x = null) => (que === 'alternativa' ? run('decision.alternativa', { proyecto: pid, ref: `propuesta:${id}`, version: x?.version }, 'Alternativa en marcha', b)
  : x?.version ? run('decision.resolver', { proyecto: pid, ref: `propuesta:${id}`, version: x.version, accion: que === 'aprobar' ? 'APROBAR' : 'RECHAZAR' }, que === 'aprobar' ? 'Aprobado' : 'Rechazado', b)
    : run(`canon.${que}`, { proyecto: pid, id }, que === 'aprobar' ? 'Aprobado' : 'Rechazado', b));
function decisionHandlers(p) {
  return {
    alternativa: (d, b) => run('decision.alternativa', { proyecto: p.id, ref: d.ref, version: d.version }, 'Respondida', b),
    copy: (ref, b) => copiarConsulta(`decision:${p.id}:${ref}`, b),
    async answer(d, b) {
      const r = await ask({ title: `Decidir · ${p.nombre}`, help: d.pregunta, ok: 'Guardar decisión',
        fields: [{ name: 'respuesta', label: 'Tu decisión', type: 'textarea', value: d.consejo?.respuesta || '', placeholder: 'Escribe la respuesta tal como quieres que la sigan Codex y Claude' }] });
      if (r?.respuesta) await run('decision.responder', { proyecto: p.id, id: d.id, respuesta: r.respuesta }, 'Decisión guardada', b);
    },
    postpone: (d, b) => run('decision.posponer', { proyecto: p.id, id: d.id, dias: 7 }, 'Pospuesta 7 días', b),
    consult: (ref, b) => actions.consult(p, ref, b),
  };
}
// ⧉ Todas las decisiones que de verdad esperan a Antonio, en texto compacto para pegarlas en ChatGPT.
async function copyDecisions(b) {
  const { n, texto } = decisionsText(data.proyectos.filter(needsDecision));
  b.disabled = true;
  try {
    const ok = n && await copyText(texto);
    toast(ok ? `✓ Copiadas ${n} ${n === 1 ? 'decisión' : 'decisiones'}` : 'CEOPadre no pudo copiar las decisiones.', ok ? 'ok' : 'bad');
  } finally { b.disabled = false; }
}
// Sólo se repinta si cambia algo de lo que enseña (un repintado cada 2,5 s cerraba los «Detalles» abiertos y movía el foco).
let decSig = null;
function paintDecisions() {
  const box = $('#decisions');
  const withDec = data.proyectos.filter(needsDecision);
  const n = withDec.reduce((a, p) => a + decisionCount(p), 0);
  box.hidden = !n;
  // El número también en la pestaña/app: se ve sin abrir CEOPadre.
  document.title = n ? `(${n}) CEOPadre` : 'CEOPadre';
  const sig = JSON.stringify(withDec.map((p) => [p.id, p.nombre, p.estado, p.trabajo, p.propuesta, p.recomendacion, p.consejo, p.propuestas, p.decisiones, p.superada, p.objetivo, p._logo]));
  if (sig === decSig) return;
  decSig = sig;
  if (!n) { box.replaceChildren(); return; }
  const wasOpen = new Set([...box.querySelectorAll('details[open]')].map((x) => x.dataset.k));
  box.replaceChildren(
    h('button', { class: 'icon-btn dec-copy', type: 'button', 'aria-label': `Copiar las ${n} decisiones pendientes`, title: 'Copiar todas las decisiones (para pegarlas en ChatGPT)',
      onclick: (e) => copyDecisions(e.currentTarget) }, h('span', { 'aria-hidden': 'true' }, '⧉')),
    // Siempre a la vista (antes iba plegado y se perdía entre lo demás): cada proyecto con su objetivo y qué se decide.
    h('div', { class: 'dec-global', 'data-k': 'decisiones' },
      h('p', { class: 'dec-title' }, `${n} ${n === 1 ? 'decisión pendiente' : 'decisiones pendientes'} · sólo tú puedes decidir`),
      withDec.map((p) => h('section', { class: `dec-proj m-${mood(p)}`, 'data-dec': p.id },
        h('header', { class: 'unit-head' }, logo(p), h('div', { class: 'title' }, h('h3', {}, p.nombre),
          p.objetivo ? h('small', { class: 'muted goal1', title: p.objetivo }, cleanGoal(p.objetivo)) : null),
          iconBtn('info', `Detalles de ${p.nombre}`, () => actions.details(p))),
        jobDecision(p),
        proposals(p, decideCanon(p.id), (ref, b) => actions.consult(p, ref, b), (ref, b) => copiarConsulta(`decision:${p.id}:${ref}`, b)),
        pendingDecisions(p.decisiones, decisionHandlers(p), false)))));
  for (const x of box.querySelectorAll('details')) if (wasOpen.has(x.dataset.k)) x.open = true;
}

/** DECIDIR en un puesto: lleva a su decisión en «Necesita tu intervención». */
function openDecisions(id) {
  ($(`#decisions [data-dec="${CSS.escape(id)}"]`) || $('#decisions'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Indicador de conexión: Operativo · PC desconectado · Sin internet. Con lo que ya hay (latido del PC y el navegador).
let net = 'ok';
function paintNet() {
  const s = netStatus({ local: LOCAL, browserOnline: navigator.onLine, reachable: net !== 'offline', pcOnline: data.pc.online });
  const el = $('#net');
  el.className = `net m-${s[0]}`;
  el.lastChild.textContent = s[1];
}
// Cuota: sólo un icono con el % más alto; al pulsarlo, el detalle por proveedor (datos ya leídos, ninguna llamada).
function paintQuota() {
  const q = quotaView(data.cuotas);
  for (const box of document.querySelectorAll('.quota')) {
    box.hidden = !q;
    if (!q) continue;
    box.querySelector('.q-max').textContent = `${Math.round(q.max)} %`;
    box.querySelector('.quota-pop').replaceChildren(
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Usado'), h('th', {}, 'Disponible'), h('th', {}, 'Reinicio'))),
        h('tbody', {}, q.filas.map((f) => h('tr', {}, h('th', {}, f.nombre), h('td', {}, f.usado), h('td', {}, f.disponible), h('td', {}, f.reinicio))))),
      h('small', { class: 'muted' }, `Cuota de toda la cuenta (no sólo CEOPadre)${q.leida ? ` · leída ${q.leida}` : ''}${q.avisos.map((a) => ` · ${a}`).join('')}${q.filas.some((f) => f.disponible === 'No disponible') ? ' · MES: el proveedor no informa cuota mensual' : ''}`));
  }
}
// Un clic fuera cierra el desplegable de cuota.
document.addEventListener('click', (e) => { for (const d of document.querySelectorAll('.quota[open]')) if (!d.contains(e.target)) d.open = false; });
window.addEventListener('online', () => { net = 'ok'; void refresh(); });
window.addEventListener('offline', () => { net = 'offline'; paintNet(); paintList(); });

// NUEVO PROYECTO (E:\ECOAPP\<nombre>) y NUEVA GESTIÓN (E:\ECOAPP\Gestiones\<nombre>): sólo crean la carpeta y la vinculan.
async function createFolder(op, what, where, b) {
  const r = await ask({ title: `Nueva ${what === 'proyecto' ? 'carpeta de proyecto' : 'gestión'}`,
    help: `Se crea la carpeta ${where}\\<nombre> y se añade a CEOPadre. No se genera código ni se ejecuta ninguna IA.`,
    fields: [{ name: 'nombre', label: 'Nombre', placeholder: what === 'proyecto' ? 'Ej.: MiProyecto' : 'Ej.: Facturas' }], ok: 'Crear' });
  if (!r?.nombre) return;
  b.disabled = true;
  let res;
  try { res = await api.cmd(op, { nombre: r.nombre }); } finally { b.disabled = false; }
  if (res?.ok && res.data?.existe) {
    const ok = await ask({ title: 'Esa carpeta ya existe', help: `${res.data.mensaje}`, ok: 'Vincular la existente' });
    if (ok) await run(op, { nombre: r.nombre, vincular_existente: true }, 'Vinculada', b);
    return;
  }
  if (res?.ok) toast(res.data?.mensaje || 'Creado', 'ok'); else toast(res?.error || 'No se pudo', 'bad');
  await refresh();
}

// ------------------------------------------------------------------ detalles
// Visible: estado, CEO AUTO/MANUAL, objetivo breve, AHORA, SIGUIENTE, último resultado, escribir, pendientes y rondas.
// Plegado: proveedores, consumo, informe y objetivo completos, lecciones y acciones técnicas. Sin IA: sólo datos que ya hay.

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'));
const when = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TIPO = { INSTRUCCION: 'INSTRUCCIÓN', DIRECTO: 'DIRECTO' };
const MODO_HELP = { AUTO: 'Codex decide y continúa', MANUAL: 'Tú decides; Claude espera' };
const MARK = { hecho: '✓', comprobado: '✓', pendiente: '…', problema: '⚠' };

/** Bloque plegable que recuerda si estaba abierto entre repintados (data-k). */
const fold = (k, summary, ...kids) => h('details', { class: 'fold', 'data-k': k }, h('summary', {}, summary), ...kids);

/** Grupo de opciones (radio nativo: teclado y lector de pantalla gratis). */
function seg(name, legend, options, value, onchange) {
  return h('fieldset', { class: 'seg' }, h('legend', {}, legend),
    options.map(([v, label, help]) => {
      const input = h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onchange(v) });
      return h('label', { title: help || '' }, input, h('span', {}, label));
    }));
}

// Visor de texto largo (objetivo o informe completo): texto plano, nunca HTML.
// Mapa completo: mismo diálogo grande que el editor; conserva el scroll al repintarse.
function paintMap(m, decide, consult) {
  const box = $('#map-body'), y = box.scrollTop;
  box.replaceChildren(...mapBody(m, decide, consult).filter(Boolean));
  box.scrollTop = y;
}

// INFORME DEL DÍA: secciones con datos reales (informe.ejecutivo). Lo vacío no ocupa sitio.
async function openInforme(horas = 24) {
  const box = $('#informe-body');
  $('#informe-title').textContent = horas > 24 ? 'Informe de los últimos 7 días' : 'Informe del día';
  $('#informe-semana').textContent = horas > 24 ? 'Últimas 24 horas' : 'Últimos 7 días';
  $('#informe-semana').onclick = () => openInforme(horas > 24 ? 24 : 168);
  $('#informe-ceo').onclick = () => { $('#informe').close(); void openCeo('general', { pregunta: horas > 24 ? '¿Qué es lo más importante de esta semana y qué recomiendas?' : '¿Qué es lo más importante del día y qué recomiendas?' }); };
  if (!$('#informe').open) $('#informe').showModal();
  fill(box, h('p', { class: 'muted' }, 'Cargando…'));
  const r = await api.cmd('informe.ejecutivo', { horas });
  if (!r?.ok) { fill(box, h('p', { class: 'bad' }, r?.error || 'El PC no responde')); return; }
  const x = r.data;
  const sec = (cls, title, items, row) => items.length ? h('section', { class: `inf-sec ${cls}` }, h('h3', {}, `${title} (${items.length})`), h('ul', {}, items.map((i) => h('li', {}, row(i))))) : null;
  const kpi = (k) => `${k.nombre}: ${k.error ? 'sin medir' : k.valor ?? '—'}${k.unidad ? ` ${k.unidad}` : ''}${k.anterior != null && k.valor != null && k.anterior !== k.valor ? ` (antes ${k.anterior})` : ''} · objetivo ${k.sentido} ${k.objetivo}`;
  const hechos = [x.necesita.length, x.problemas.length, x.trabajando.length, x.terminados.length];
  fill(box,
    h('p', { class: 'inf-lead' }, `${x.terminados.length} terminado${x.terminados.length === 1 ? '' : 's'} · ${x.trabajando.length} en marcha · ${x.necesita.length ? `${x.necesita.length} te necesita${x.necesita.length === 1 ? '' : 'n'}` : 'nada te necesita'} · ${x.problemas.length ? `${x.problemas.length} con problemas` : 'sin problemas'}`),
    sec('need', 'Necesita tu intervención', x.necesita, (i) => [h('b', {}, i.proyecto), ` — ${i.que}`, i.detalle ? h('small', {}, i.detalle) : null]),
    sec('bad', 'Problemas', x.problemas, (i) => [h('b', {}, i.proyecto), ` — ${i.que}`, i.detalle ? h('small', {}, i.detalle) : null]),
    sec('done', 'Terminado y comprobado', x.terminados, (i) => [h('b', {}, i.proyecto), ` — ${i.objetivo}`, ...i.comprobado.map((c) => h('small', { class: 'ok' }, `✓ ${c}`)), ...i.sin_comprobar.map((c) => h('small', { class: 'warn' }, `Sin comprobar: ${c}`))]),
    sec('goal', 'Objetivos de negocio', x.negocio, (m) => [h('b', {}, cleanGoal(m.titulo)), ` — ${(MOOD_NEGOCIO[m.estado] || m.estado).toLowerCase()}`, ...m.kpis.map((k) => h('small', {}, kpi(k))), ...m.avances.slice(0, 2).map((e) => h('small', { class: 'muted' }, e.texto))]),
    sec('work', 'Trabajando ahora', x.trabajando, (i) => [h('b', {}, i.proyecto), ` — ${i.ahora || i.objetivo}`]),
    sec('wait', 'Esperando algo externo', x.esperando, (i) => [h('b', {}, i.proyecto), ` — ${esperaHumana(i.que).titulo || i.que}`, i.comprobada_at ? h('small', { class: 'muted' }, `Última comprobación ${hhmm(i.comprobada_at)}`) : null]),
    sec('next', 'Después', x.despues, (i) => [h('b', {}, i.cuando ? hhmm(i.cuando) : 'En cola'), ` — ${i.que} · ${i.proyecto}`]),
    x.automatizaciones.length ? h('p', { class: 'muted' }, `Agentes ejecutados: ${x.automatizaciones.map((a) => `${a.n} ${a.estado.toLowerCase()}`).join(' · ')}`) : null,
    hechos.every((n) => !n) && !x.negocio.length && !x.esperando.length ? h('p', { class: 'muted' }, 'Sin actividad en este periodo.') : null,
    h('p', { class: 'muted small' }, `Del ${new Date(x.desde).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} a ahora · datos de CEOPadre, sin estimaciones.`));
}
// CONSULTAR AL CEO: una conversación persistente por elemento (decisión, proyecto, objetivo, trabajo, espera, agente o
// general). El CEO responde con el contexto ACTUAL; preguntar no aprueba nada; un cambio pedido se aplica con «Aplicar».
const ceo = { conv: null, ref: null, timer: null, t0: 0 };
const VUELTA = { proyecto: 'Ir al proyecto', objetivo: 'Ir al objetivo', agentes: 'Ir a Agentes', inicio: 'Ir a Dirección' };
const draftKey = (ref) => `ceo-borrador:${ref}`;
const borradorCEO = { get: (ref) => { try { return localStorage.getItem(draftKey(ref)) || ''; } catch { return ''; } }, set: (ref, v) => { try { if (v) localStorage.setItem(draftKey(ref), v); else localStorage.removeItem(draftKey(ref)); } catch { /* sin almacenamiento */ } } };
async function openCeo(ref, { pregunta = null, push = true, id = null } = {}) {
  if (!api) return;
  const dlg = $('#ceo');
  ceo.ref = ref;
  if (!dlg.open) dlg.showModal();
  if (push) navPush({ ceo: ref });
  $('#ceo-title').textContent = 'Consultar al CEO';
  $('#ceo-ctx').textContent = '';
  fill($('#ceo-msgs'), h('p', { class: 'muted' }, 'Cargando la conversación…'));
  fill($('#ceo-res'), null); fill($('#ceo-dec'), null);
  const r = await api.cmd('ceo.conversacion', { ref, ...(id ? { id } : {}) });
  if (ceo.ref !== ref) return;
  if (!r?.ok) { fill($('#ceo-msgs'), h('p', { class: 'bad' }, r?.error || 'El PC no responde')); return; }
  ceo.conv = r.data;
  $('#ceo-input').value = borradorCEO.get(ref);
  paintCeo();
  if (pregunta && !r.data.mensajes.length && !r.data.pensando) await enviarCeo(pregunta);
  else if (r.data.pensando) pollCeo();
  // Con historial no se pregunta solo: la pregunta sugerida queda escrita, lista para enviar o cambiar.
  else if (pregunta && !$('#ceo-input').value) $('#ceo-input').value = pregunta;
}
function cerrarCeo(volverAtras = true) {
  clearTimeout(ceo.timer);
  if ($('#ceo').open) $('#ceo').close();
  if (volverAtras && new URLSearchParams(location.search).has('ceo')) navPush({ ceo: null });
}
const ACC = { APROBAR: 'Aprobar la propuesta', RECHAZAR: 'Rechazar la propuesta' };
/** Decidir desde la conversación (barra de la decisión o un mensaje del CEO): con la versión que se ve. */
async function decidirCeo(accion, b, mensaje = null, version = null) {
  const d = ceo.conv?.decision;
  if (!d) return;
  if (accion === 'APROBAR' && d.gasto && !(await ask({ title: '¿Autorizas este gasto?', help: d.recomendacion || d.propuesta, ok: 'SÍ, AUTORIZO ESTE GASTO', danger: true }))) return;
  const op = accion === 'ALTERNATIVA' ? 'decision.alternativa' : 'decision.resolver';
  const etiqueta = accion === 'APROBAR' ? d.aprobar : accion === 'RECHAZAR' ? d.rechazar : d.alternativa?.etiqueta;
  if (b) b.disabled = true;
  const r = await api.cmd(op, { proyecto: d.proyecto, ref: d.ref, version: version || d.version, accion, etiqueta, ...(mensaje ? { mensaje } : {}) }).catch((e) => ({ ok: false, error: e.message }));
  if (b) b.disabled = false;
  if (!r?.ok) {
    // Sin cerrar: se ve el problema y se puede reintentar o preguntar.
    fill($('#ceo-res'), h('p', { class: 'ceo-res bad', role: 'alert' }, `No se pudo: ${r?.error || 'el PC no responde'}`));
    toast(r?.error || 'No se pudo', 'bad');
    void refreshCeo();
    return;
  }
  await resueltoCeo(r.data);
}
/** Decisión resuelta: el resultado REAL un momento, la pantalla al día y el panel se cierra (el historial queda). */
async function resueltoCeo(x) {
  const FASE = { REGISTRADA: 'Registrada', EJECUTADA: 'Hecho', VERIFICADA: 'Hecho y comprobado' };
  fill($('#ceo-res'), h('p', { class: 'ceo-res ok', role: 'status' }, h('b', {}, `${FASE[x?.fase] || 'Registrada'}. `), x?.mensaje || ''));
  toast(x?.mensaje || 'Decisión registrada');
  await refreshCeo();
  await refresh?.();
  const ref = ceo.ref;
  setTimeout(() => { if (ceo.ref === ref && $('#ceo').open) cerrarCeo(); }, 2600);
}
/** «Copiar consulta»: el asunto entero en texto llano para preguntarlo fuera (ChatGPT, otra persona). */
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso: método clásico */ }
  const t = h('textarea', { style: 'position:fixed;left:-9999px;top:0', readonly: '' }, texto);
  document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}
async function copiarConsulta(ref, b, { id = null, conversacion = false } = {}) {
  const r = await api.cmd('ceo.copiar', { ref, id, conversacion });
  if (!r?.ok) { toast(r?.error || 'No se pudo preparar el texto', 'bad'); return; }
  if (await copiar(r.data.texto)) { toast('Copiado: pégalo en ChatGPT o donde quieras'); if (b) { const t = b.textContent; b.textContent = '✓ Copiado'; setTimeout(() => { b.textContent = t; }, 1800); } }
  else { await ask({ title: 'Copia este texto', help: 'Tu navegador no deja copiar solo: selecciónalo y cópialo.', fields: [{ name: 't', label: 'Consulta', type: 'textarea', value: r.data.texto }], ok: 'Cerrar' }); }
}
const copiarBtn = (ref) => h('button', { class: 'link copiar', type: 'button', title: 'Copia el asunto entero (sin datos sensibles) para consultarlo fuera', onclick: (e) => copiarConsulta(ref, e.currentTarget) }, '📋 Copiar consulta');
/** QUÉ SE DECIDE, qué hace cada botón y qué recomienda el CEO, sin salir de la conversación. */
function ceoDecision(c) {
  const d = c.decision;
  if (!d) return null; // resuelta o cambiada: lo dice ya la cabecera de la conversación
  const altB = d.alternativa ? { alt: (e) => decidirCeo('ALTERNATIVA', e.currentTarget), altLabel: d.tipo === 'pregunta' ? `Responder: ${d.alternativa.etiqueta}` : d.alternativa.etiqueta } : {};
  const recTxt = d.recomienda === 'APROBAR' ? d.aprobar || ACC.APROBAR : d.recomienda === 'RECHAZAR' ? d.rechazar || ACC.RECHAZAR : d.recomienda === 'ALTERNATIVA' ? d.alternativa?.etiqueta : null;
  const k = { estado: d.preparando ? 'PENDIENTE' : d.explicacion ? 'OK' : null, explicacion: d.explicacion, veredicto: d.recomienda, motivo: d.motivo, riesgo: d.riesgo,
    aprobar: d.aprobar, rechazar: d.rechazar, alternativa: d.alternativa, respuesta: null };
  const ex = explica(k, d.tipo);
  return h('section', { class: 'ceo-dec', 'aria-label': 'La decisión' },
    ex && d.explicacion ? ex : [
      h('p', { class: 'ln' }, h('b', {}, d.tipo === 'pregunta' ? 'PREGUNTA ' : 'PROPUESTA ORIGINAL '), d.propuesta),
      d.si_apruebo ? h('p', { class: 'ln small' }, h('b', {}, 'SI APRUEBAS '), d.si_apruebo, ' ', h('b', {}, 'SI RECHAZAS '), d.si_rechazo) : null,
      recTxt ? h('p', { class: 'ln reco' }, h('b', {}, 'EL CEO RECOMIENDA '), recTxt, d.motivo ? ` — ${d.motivo}` : '') : null,
      d.riesgo ? h('p', { class: 'ln bad small' }, h('b', {}, 'RIESGO '), d.riesgo) : null,
      ex, h('p', { class: 'ln small efecto' }, h('b', {}, 'QUÉ HACE CEOPADRE '), EFECTO[d.tipo] || '')],
    d.explicacion ? h('details', { class: 'prop-more tecnico' }, h('summary', {}, 'Detalle técnico'), h('p', { class: 'small' }, d.propuesta)) : null,
    decideRow({ yes: d.tipo === 'pregunta' ? null : (e) => decidirCeo('APROBAR', e.currentTarget), no: d.tipo === 'pregunta' ? null : (e) => decidirCeo('RECHAZAR', e.currentTarget),
      yesLabel: d.gasto ? 'Sí, autorizo este gasto' : d.aprobar || ACC.APROBAR, noLabel: d.gasto ? 'No autorizo este gasto' : d.rechazar || ACC.RECHAZAR, rec: d.recomienda, ...altB }));
}
function ceoMsg(m, aplicados) {
  if (m.rol === 'antonio') return h('div', { class: 'msg yo' }, h('p', {}, m.texto));
  if (m.rol === 'sistema') return h('div', { class: 'msg sis' }, h('p', {}, m.texto));
  const d = m.datos || {};
  const fila = (t, v, cls = '') => (v ? [h('dt', { class: cls }, t), h('dd', { class: cls }, v)] : null);
  return h('div', { class: 'msg ceo' },
    h('p', { class: 'msg-who' }, d.auto ? 'CEO · explicación inicial' : d.proveedor === 'CLAUDE' ? 'CEO · Claude (sustituto)' : 'CEO',
      h('button', { class: 'link msg-copy', type: 'button', title: 'Copiar esta respuesta', onclick: async (e) => { if (await copiar(m.texto)) { e.currentTarget.textContent = '✓'; toast('Respuesta copiada'); } } }, '📋')),
    h('p', { class: 'msg-r' }, m.texto),
    d.quiere_hacer || d.recomienda || d.por_que || d.riesgo || d.si_no ? h('dl', { class: 'msg-dl' },
      fila('RECOMIENDO', d.recomienda, 'reco'), fila('POR QUÉ', d.por_que), fila('RIESGO', d.riesgo, 'bad'),
      fila('PROPUESTA ORIGINAL', d.quiere_hacer), fila('SI NO LO HACEMOS', d.si_no)) : null,
    d.hechos?.length ? h('details', { class: 'msg-more' }, h('summary', {}, `Comprobado (${d.hechos.length})${d.inciertos?.length ? ` · sin confirmar (${d.inciertos.length})` : ''}`),
      h('ul', {}, d.hechos.map((x) => h('li', {}, x)), (d.inciertos || []).map((x) => h('li', { class: 'warn' }, `Sin confirmar: ${x}`)))) : d.inciertos?.length ? h('p', { class: 'small warn' }, `Sin confirmar: ${d.inciertos.join(' · ')}`) : null,
    d.cambio ? cambioBox(m, d, aplicados) : null);
}
const CAMBIO_T = { ALTERNATIVA: 'ALTERNATIVA DEL CEO', APROBAR: 'APROBAR LA PROPUESTA (lo pediste)', RECHAZAR: 'RECHAZAR LA PROPUESTA (lo pediste)', PAUSAR: 'PAUSAR', REANUDAR: 'REANUDAR', INSTRUCCION: 'INSTRUCCIÓN', OBJETIVO_NUEVO: 'OBJETIVO NUEVO' };
/** El cambio que el CEO identificó: qué se ejecutará exactamente y el botón que lo autoriza (o por qué ya no vale). */
function cambioBox(m, d, aplicados) {
  const k = d.cambio.tipo;
  const decide = ['APROBAR', 'RECHAZAR', 'ALTERNATIVA'].includes(k);
  const cur = ceo.conv?.decision;
  const vieja = decide && (!cur || cur.version !== d.version);
  return h('div', { class: `msg-cambio${k === 'ALTERNATIVA' ? ' alt' : ''}` },
    h('p', {}, h('b', {}, `${CAMBIO_T[k] || 'CAMBIO PROPUESTO'}: `), d.cambio.resumen || d.cambio.texto),
    k === 'ALTERNATIVA' && d.cambio.texto ? h('details', { class: 'msg-more' }, h('summary', {}, 'Qué se ejecutará exactamente'), h('p', {}, d.cambio.texto)) : null,
    aplicados.has(m.id) ? h('p', { class: 'small ok' }, '✓ Aplicado')
      : vieja ? h('p', { class: 'small muted' }, cur ? 'Propuesto para una versión anterior de la decisión: vuelve a preguntar.' : 'La decisión ya no está pendiente.')
        : h('button', { class: 'btn primary small', type: 'button', onclick: async (e) => {
          if (decide) { await decidirCeo(k, e.currentTarget, m.id, d.version); return; }
          if (await run('ceo.aplicar', { mensaje: m.id }, 'Aplicado', e.currentTarget)) void refreshCeo();
        } }, k === 'ALTERNATIVA' ? `Elegir: ${d.cambio.resumen || 'la alternativa'}` : k === 'APROBAR' ? (cur?.aprobar || ACC.APROBAR) : k === 'RECHAZAR' ? (cur?.rechazar || ACC.RECHAZAR) : 'Aplicar este cambio'));
}
function paintCeo() {
  const c = ceo.conv;
  if (!c) return;
  $('#ceo-title').textContent = c.titulo || 'Hablar con el CEO';
  $('#ceo-ctx').textContent = c.resumen || '';
  const k = c.vuelta && Object.keys(c.vuelta).find((x) => c.vuelta[x]);
  const vb = $('#ceo-volver');
  vb.hidden = !k;
  if (k) {
    vb.textContent = c.ref.startsWith('decision:') ? 'Ir a la decisión' : VUELTA[k] || 'Volver';
    vb.onclick = () => { cerrarCeo(false); if (k === 'proyecto') { const p = (data.proyectos || []).find((x) => x.id === c.vuelta.proyecto); if (p) actions.details(p); } else if (k === 'objetivo') nui?.openOne(c.vuelta.objetivo); else if (k === 'agentes') goTab('autos'); else goTab('home'); };
  }
  const aplicados = new Set(c.mensajes.filter((m) => m.rol === 'sistema').map((m) => Number((/^Aplicado \(#(\d+)\)/.exec(m.texto) || [])[1])).filter(Boolean));
  fill($('#ceo-dec'), ceoDecision(c));
  if (!c.decision) fill($('#ceo-res'), c.ref.startsWith('decision:') && c.aplicados?.length ? h('p', { class: 'ceo-res ok small' }, h('b', {}, 'Resuelta. '), c.aplicados.at(-1).texto.replace(/^(Aplicado \(#\d+\)|Decidido):\s*/, '')) : null);
  const sel = $('#ceo-otras');
  sel.hidden = !c.anteriores?.length;
  if (c.anteriores?.length) fill(sel, h('option', { value: '' }, `Anteriores (${c.anteriores.length})`),
    c.anteriores.map((x) => h('option', { value: x.id }, `${new Date(x.updated_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${x.n} mensajes`)));
  const box = $('#ceo-msgs');
  fill(box, c.mensajes.length ? c.mensajes.map((m) => ceoMsg(m, aplicados)) : h('p', { class: 'muted ceo-vacio' }, c.ref === 'general' ? 'Pregúntale lo que quieras sobre tus proyectos: «¿Qué es lo más importante que nos queda pendiente?»' : 'Pregúntale lo que quieras sobre esto. Responde con los datos actuales de CEOPadre.'),
    c.pensando ? h('div', { class: 'msg ceo pensando', role: 'status' }, h('p', {}, h('span', { class: 'dots', 'aria-hidden': 'true' }, '• • •'), ' El CEO está respondiendo…')) : null);
  $('#ceo-send').disabled = !!c.pensando;
  box.scrollTop = box.scrollHeight;
}
async function refreshCeo() {
  if (!ceo.conv) return;
  const r = await api.cmd('ceo.conversacion', { ref: ceo.ref, id: ceo.conv.id });
  if (r?.ok && ceo.ref === r.data.ref) { ceo.conv = r.data; paintCeo(); }
  return r?.data;
}
function pollCeo() {
  clearTimeout(ceo.timer);
  ceo.t0 ||= Date.now();
  ceo.timer = setTimeout(async () => {
    const d = $('#ceo').open ? await refreshCeo() : null;
    if (d?.pensando && Date.now() - ceo.t0 < 5 * 60_000) pollCeo(); else ceo.t0 = 0;
  }, 1500);
}
async function enviarCeo(texto) {
  const t = String(texto || '').trim();
  if (!t || !ceo.conv) return;
  const r = await api.cmd('ceo.preguntar', { conversacion: ceo.conv.id, texto: t });
  if (!r?.ok) { toast(r?.error || 'No se pudo enviar', 'bad'); return; }
  borradorCEO.set(ceo.ref, '');
  $('#ceo-input').value = '';
  ceo.conv = { ...ceo.conv, pensando: true, mensajes: [...ceo.conv.mensajes, { id: -1, rol: 'antonio', texto: t }] };
  paintCeo();
  ceo.t0 = Date.now();
  pollCeo();
}
function ceoUi() {
  $('#ceo-form').addEventListener('submit', (e) => { e.preventDefault(); void enviarCeo($('#ceo-input').value); });
  $('#ceo-input').addEventListener('input', (e) => borradorCEO.set(ceo.ref, e.target.value));
  $('#ceo-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); void enviarCeo(e.target.value); } });
  $('#ceo-cerrar').addEventListener('click', () => cerrarCeo());
  // Panel ancho en escritorio (respuestas largas y alternativas): se recuerda en este navegador.
  const ancho = (on) => { $('#ceo').classList.toggle('ancho', on); $('#ceo-ancho').setAttribute('aria-pressed', String(on)); $('#ceo-ancho').textContent = on ? '⤡ Estrechar' : '⤢ Ampliar'; try { localStorage.setItem('ceo-ancho', on ? '1' : ''); } catch { /* sin almacenamiento */ } };
  let a0 = false; try { a0 = localStorage.getItem('ceo-ancho') === '1'; } catch { /* sin almacenamiento */ }
  ancho(a0);
  $('#ceo-ancho').addEventListener('click', () => ancho(!$('#ceo').classList.contains('ancho')));
  $('#ceo-copiar').addEventListener('click', (e) => copiarConsulta(ceo.ref, e.currentTarget, { id: ceo.conv?.id, conversacion: true }));
  // El asunto cambió: conversación nueva sobre lo mismo; las anteriores siguen guardadas y se pueden reabrir.
  $('#ceo-nueva').addEventListener('click', async () => {
    const r = await api.cmd('ceo.conversacion', { ref: ceo.ref, nueva: true });
    if (r?.ok) { ceo.conv = r.data; paintCeo(); toast('Conversación nueva (las anteriores quedan guardadas)'); } else toast(r?.error || 'No se pudo', 'bad');
  });
  $('#ceo-otras').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const r = await api.cmd('ceo.conversacion', { ref: ceo.ref, id: e.target.value });
    if (r?.ok) { ceo.conv = r.data; paintCeo(); if (r.data.pensando) pollCeo(); }
  });
  $('#ceo').addEventListener('cancel', (e) => { e.preventDefault(); cerrarCeo(); });
  // «Hablar con el CEO»: con el contexto de donde estás (la ficha de un proyecto) o general.
  $('#b-ceo').addEventListener('click', () => void openCeo(openId && !$('#p-detail').hidden ? `proyecto:${openId}` : 'general'));
}

// CONEXIONES Y PERMISOS: el secreto se escribe SÓLO en el PC (en el móvil viajaría por internet); allí se enseñan los pasos.
async function openConexiones(foco = null) {
  const box = $('#conex-body');
  if (!$('#conexiones').open) $('#conexiones').showModal();
  const r = await api.cmd('conexion.lista', {});
  if (!r?.ok) { fill(box, h('p', { class: 'bad' }, r?.error || 'El PC no responde')); return; }
  const x = r.data;
  const nombreP = (id) => (data.proyectos || []).find((p) => p.id === id)?.nombre || 'todos los proyectos';
  const reabrir = () => openConexiones(foco);
  const conectar = async (sv, b) => {
    const proys = (data.proyectos || []).filter((p) => p.tipo !== 'GESTION');
    const manual = sv.comprobacion === 'manual';
    const v = await ask({ title: `Conectar ${sv.nombre}`, ok: manual ? 'Ya existe: marcar como conectada' : 'Comprobar y guardar cifrado',
      help: `${sv.pasos.map((p, i) => `${i + 1}. ${p}`).join(' ')} ${manual ? '' : 'El token se comprueba con el servicio oficial y se guarda CIFRADO en este PC (DPAPI): nunca va a los encargos, informes ni registros.'}`,
      fields: [{ name: 'proyecto', label: 'Proyecto', type: 'choice', required: false, options: [{ value: '', label: 'Todos' }, ...proys.map((p) => ({ value: p.id, label: p.nombre }))], value: '' },
        ...(manual ? [{ name: 'confirmo', label: 'Confirmo que la cuenta ya existe', type: 'checkbox' }, { name: 'cuenta', label: 'Nombre de la cuenta (opcional)', required: false }]
          : [{ name: 'secreto', label: 'Token de acceso', type: 'password' }])] });
    if (!v) return;
    if (await run('conexion.guardar', { servicio: sv.id, proyecto: v.proyecto || null, secreto: v.secreto, confirmo: !!v.confirmo, cuenta: v.cuenta }, 'Conectada', b)) reabrir();
  };
  const autorizar = async (b) => {
    const proys = (data.proyectos || []).filter((p) => p.tipo !== 'GESTION');
    const v = await ask({ title: 'Nueva autorización para el CEO', ok: 'Autorizar',
      help: 'Lo que el CEO puede hacer SOLO, con límite y caducidad. Nunca gastos, banca ni permisos. Puedes revocarla cuando quieras.',
      fields: [{ name: 'accion', label: 'Qué puede hacer', type: 'choice', options: Object.entries(x.acciones).map(([value, label]) => ({ value, label })) },
        { name: 'proyecto', label: 'Proyecto', type: 'choice', options: proys.map((p) => ({ value: p.id, label: p.nombre })) },
        { name: 'servicio', label: 'Servicio (si aplica)', type: 'choice', required: false, options: [{ value: '', label: '—' }, ...x.servicios.filter((sv) => sv.id !== 'demo').map((sv) => ({ value: sv.id, label: sv.nombre }))], value: '' },
        { name: 'limite_semana', label: 'Máximo por semana', value: '3' }, { name: 'dias', label: 'Durante (días)', value: '30' }] });
    if (v && await run('autorizacion.crear', { ...v, limite_semana: Number(v.limite_semana), dias: Number(v.dias) }, 'Autorizado', b)) reabrir();
  };
  fill(box,
    h('section', { class: 'inf-sec' }, h('h3', {}, 'Cuentas'), h('ul', {}, x.servicios.filter((sv) => sv.id !== 'demo' || x.conexiones.some((c) => c.servicio === 'demo')).map((sv) => {
      const cs = x.conexiones.filter((c) => c.servicio === sv.id && c.estado !== 'REVOCADA');
      return h('li', { class: foco === sv.id ? 'foco' : '' }, h('b', {}, sv.nombre),
        cs.length ? cs.map((c) => h('small', { class: c.estado === 'CONECTADA' ? 'ok' : 'warn' }, `${c.estado === 'CONECTADA' ? '✓ Conectada' : c.estado === 'EXISTENTE' ? 'La cuenta existe (sin conectar a CEOPadre)' : 'Pendiente'} · ${nombreP(c.proyecto)}${c.cuenta ? ` · ${c.cuenta}` : ''}${c.verificacion ? ` · ${c.verificacion}` : ''}`)) : h('small', { class: 'muted' }, 'Sin conectar'),
        h('div', { class: 'a-acts' },
          LOCAL ? h('button', { class: 'btn small', type: 'button', onclick: (e) => conectar(sv, e.currentTarget) }, cs.some((c) => c.estado === 'CONECTADA') ? 'Volver a conectar' : 'Conectar')
            : h('button', { class: 'btn ghost small', type: 'button', onclick: () => view(`Conectar ${sv.nombre}`, `${sv.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nEl último paso se hace en el PC: la clave nunca viaja por internet. En cuanto esté, el CEO lo comprueba y sigue solo.`) }, 'Ver pasos'),
          ...cs.filter((c) => c.estado === 'CONECTADA').map((c) => h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => run('conexion.revocar', { id: c.id }, 'Revocada', e.currentTarget).then(reabrir) }, 'Revocar'))));
    }))),
    h('section', { class: 'inf-sec' }, h('h3', {}, 'Lo que el CEO puede hacer solo'),
      x.autorizaciones.filter((a) => a.estado === 'ACTIVA').length ? h('ul', {}, x.autorizaciones.filter((a) => a.estado === 'ACTIVA').map((a) => h('li', {}, a.texto,
        h('small', { class: 'muted' }, `${a.usos_semana}/${a.limite_semana} esta semana · hasta ${a.hasta ? when(a.hasta) : 'sin fecha'}`),
        h('div', { class: 'a-acts' }, h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => run('autorizacion.revocar', { id: a.id }, 'Revocada', e.currentTarget).then(reabrir) }, 'Revocar')))))
        : h('p', { class: 'muted small' }, 'Nada: publicar, enviar o activar automatizaciones lo apruebas tú cada vez.'),
      h('button', { class: 'btn small', type: 'button', onclick: (e) => autorizar(e.currentTarget) }, '+ Nueva autorización')));
}
window.addEventListener('ceo:conexiones', (e) => openConexiones(e.detail?.servicio || null));

const MOOD_NEGOCIO = { DEFINIENDO: 'Preparando el plan', ESPERANDO_APROBACION: 'Plan por aprobar', ACTIVA: 'En marcha', ESPERANDO_ANTONIO: 'Te necesita', PAUSADA: 'En pausa', ALCANZADA: 'Alcanzado', BLOQUEADA: 'Bloqueado',
  EN_SEGUIMIENTO: 'Hecho; resultado pendiente de acreditar', CERRADA: 'Cerrado sin acreditar' };

function view(title, text, src = null) {
  $('#viewer-title').textContent = title;
  $('#viewer-text').textContent = text;
  viewerSrc = src;
  $('#viewer-copy').hidden = !src;
  if (!$('#viewer').open) $('#viewer').showModal();
}

// ---- Informe completo de Claude: UNA fuente (orden «ronda.informe», la respuesta final tal cual) para el visor,
// los dos botones COPIAR y «Pegar último informe». Sólo lectura: 0 IA, no crea rondas ni toca el objetivo.
const NO_REPORT = 'No hay informe de Claude todavía.';
const reports = new Map(); // «trabajo:ronda» → texto (las rondas son inmutables)
let viewerSrc = null;      // { trabajo, ronda } del informe abierto en el visor

/** Sin `ronda`: el del último resultado. Devuelve { ronda, texto } o { error } (mensaje para Antonio). */
async function fullReport(trabajo, ronda = null) {
  if (!trabajo) return { error: NO_REPORT };
  const k = `${trabajo}:${ronda}`;
  if (ronda != null && reports.has(k)) return { ronda, texto: reports.get(k) };
  try {
    const r = await api.cmd('ronda.informe', { trabajo, ronda });
    if (!r?.ok) return { error: r?.error || 'No se pudo leer el informe' };
    reports.set(`${trabajo}:${r.data.ronda}`, r.data.texto);
    return r.data;
  } catch { return { error: 'No se pudo leer el informe' }; }
}

/** Portapapeles: API moderna y, si no hay permiso o contexto seguro, la copia clásica con una selección oculta. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* se prueba la vía clásica */ }
  const ta = h('textarea', { class: 'clip-buf', readonly: true, 'aria-hidden': 'true' });
  ta.value = text;
  (document.querySelector('dialog[open]') || document.body).append(ta); // fuera del modal no se puede seleccionar
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* sin soporte */ }
  ta.remove();
  return ok;
}

/** COPIAR (resumen y visor): el informe completo de esa ronda (sin ronda: el último), nunca el resumen. */
async function copiarInformeCompleto(trabajo, ronda, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fullReport(trabajo, ronda);
    if (r.error) { toast(r.error, 'bad'); return false; }
    const ok = await copyText(r.texto);
    toast(ok ? 'Informe copiado' : 'CEOPadre no pudo copiar el informe.', ok ? 'ok' : 'bad');
    return ok;
  } finally { if (btn) btn.disabled = false; }
}

async function viewReport(trabajo, ronda) {
  const r = await fullReport(trabajo, ronda);
  if (r.error) { toast(r.error, 'bad'); return; }
  view(`Informe completo · ronda ${r.ronda}`, r.texto, { trabajo, ronda: r.ronda });
}

/** Inserta en el cursor (o al final) separando con una línea en blanco; nunca sustituye lo escrito. */
function insertText(ta, text) {
  const v = ta.value, at = Math.min(ta.selectionEnd ?? v.length, v.length);
  const before = v.slice(0, at), after = v.slice(at);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  ta.setRangeText(pre + text + post, at, at, 'end');
  ta.focus();
}

let detailCache = null;
/** HISTORIAL de conversaciones con el CEO de este proyecto (decisiones resueltas incluidas), en modo consulta. Se carga al abrir. */
function historialCeo(c) {
  const box = h('div', { class: 'hist-ceo' }, h('p', { class: 'muted small' }, 'Cargando…'));
  const el = h('details', { class: 'panel fold-ceo', 'data-k': `hist-${c.id}` }, h('summary', {}, '💬 Conversaciones con el CEO'), box);
  el.addEventListener('toggle', async () => {
    if (!el.open) return;
    const r = await api.cmd('ceo.conversaciones', { proyecto: c.id });
    const xs = r?.ok ? r.data.conversaciones : [];
    fill(box, xs.length ? h('ul', { class: 'notes' }, xs.map((x) => h('li', {},
      h('button', { class: 'link', type: 'button', onclick: () => openCeo(x.ref, { id: x.id }) }, x.titulo || 'Conversación'),
      h('small', { class: 'muted' }, ` · ${new Date(x.updated_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${x.n} mensajes`),
      x.decidido ? h('small', { class: 'ok' }, ` · ${x.decidido.replace(/^(Aplicado \(#\d+\)|Decidido):\s*/, '').slice(0, 140)}`) : null)))
      : h('p', { class: 'muted small' }, r?.ok ? 'Aún no has hablado con el CEO sobre este proyecto.' : r?.error || 'El PC no responde'));
  });
  return el;
}
async function paintDetail(force) {
  const c = data.proyectos.find((p) => p.id === openId);
  if (!c) { openId = null; show('p-list'); return; }
  $('#d-name').textContent = c.nombre;
  if (force || !detailCache || detailCache.id !== openId || Date.now() - detailCache.at > 4000) {
    detailCache = { id: openId, at: Date.now(), d: await api.details(openId) };
  }
  const d = detailCache.d || {};
  const body = $('#d-body');
  const wasOpen = new Set([...body.querySelectorAll('details[open]')].map((x) => x.dataset.k));
  // replaceChildren() pintaría «null» como texto: sólo nodos.
  // Canon: decidir un cambio propuesto (sólo Antonio). El mapa completo se repinta si está abierto.
  const decide = decideCanon(c.id);
  const consult = (ref, b) => actions.consult(c, ref, b);
  const openMap = () => { $('#map-title').textContent = `Mapa · ${c.nombre}`; paintMap(d.mapa, decide, consult); $('#map').showModal(); };
  body.replaceChildren(...[summaryPanel(c, d), direccionPanel(c, d), revisionPanel(c), aui?.projectPanel(c), esperasPanel(c, d), mapPanel(d.mapa, { open: openMap, decide, ...decisionHandlers(c) }), writePanel(c, d), roundsPanel(d), historialCeo(c), techPanel(c, d)].filter(Boolean));
  if ($('#map').open) paintMap(d.mapa, decide, consult);
  for (const x of body.querySelectorAll('details')) if (wasOpen.has(x.dataset.k)) x.open = true;
}

// REVISAR PROYECTO (CEO auditor): evidencia real (git, pruebas, despliegue, tareas) + una ronda que la contrasta. El
// resultado se pide una vez por revisión (no en cada repintado) y sus prioridades se lanzan como objetivos normales.
const revCache = new Map(); // proyecto → { key, data }
function revisionPanel(c) {
  const r = c.revision;
  const key = r ? `${r.id}:${r.estado}` : 'none';
  const cached = revCache.get(c.id);
  if (r && r.estado !== 'EN_CURSO' && cached?.key !== key) {
    revCache.set(c.id, { key, data: null });
    void api.cmd('proyecto.revision', { proyecto: c.id }).then((x) => { if (x?.ok) { revCache.set(c.id, { key, data: x.data.revision }); paintDetail(true); } });
  }
  const res = cached?.key === key ? cached.data?.resultado : null;
  const L = (label, xs) => (xs?.length ? [h('p', { class: 'lbl' }, label), h('ul', { class: 'a-pend' }, xs.map((x) => h('li', {}, typeof x === 'object' ? `${x.que} → ${x.como} → ${x.resultado}` : x)))] : null);
  const launch = async (p, btn) => {
    const ok = await ask({ title: 'Lanzar como objetivo', ok: 'Lanzar', help: p.objetivo + (p.requiere_antonio ? '\n\nOjo: la revisión dice que necesita algo tuyo.' : '') });
    if (ok) await run('objetivo.iniciar', { proyecto: c.id, texto: p.objetivo }, 'Objetivo lanzado', btn);
  };
  return h('section', { class: 'panel' }, h('h4', {}, 'Revisar proyecto'),
    c.fuera?.commits ? h('p', { class: 'ln' }, h('b', {}, 'FUERA DE CEOPADRE'), ` ${c.fuera.commits} commit${c.fuera.commits === 1 ? '' : 's'} desde la última actualización del mapa (${when(c.fuera.desde)}): el mapa puede estar desfasado.`) : null,
    r ? h('p', { class: 'ln muted' }, `Última revisión: ${when(r.created_at)} · ${r.estado === 'EN_CURSO' ? 'en marcha' : r.estado.toLowerCase()}`) : h('p', { class: 'muted' }, 'Nunca revisado. La revisión mira el repositorio real (no sólo el mapa) y separa lo comprobado de lo declarado.'),
    res ? h('div', { class: 'result' }, h('p', { class: 'ln' }, h('b', {}, 'ESTADO'), ` ${res.estado}`), L('COMPROBADO', res.comprobado), L('DECLARADO SIN VERIFICAR', res.declarado_sin_verificar),
      L('CONTRADICHO', res.contradicho), L('BLOQUEOS', res.bloqueos), L('RIESGOS', res.riesgos), L('DESVIACIONES', res.desviaciones),
      res.prioridades?.length ? [h('p', { class: 'lbl' }, 'PRÓXIMAS PRIORIDADES'), h('ol', { class: 'a-steps' }, res.prioridades.map((p) => h('li', {}, p.objetivo.slice(0, 300), h('small', { class: 'muted' }, ` · ${p.motivo}${p.requiere_antonio ? ' · necesita algo tuyo' : ''}`),
        ' ', h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => launch(p, e.currentTarget) }, 'Lanzar'))))] : null) : cached?.key === key && cached.data?.error ? h('p', { class: 'note' }, cached.data.error) : null,
    h('div', { class: 'a-acts' }, h('button', { class: 'btn primary small', type: 'button', disabled: r?.estado === 'EN_CURSO', onclick: async (e) => {
      const x = await ask({ title: `Revisar ${c.nombre}`, ok: 'Revisar', help: 'Primero CEOPadre recoge la evidencia sin IA (git, pruebas y despliegue declarados, tareas de Windows, historial); después una ronda del motor la contrasta en el repositorio, sin cambiar código ni datos, y actualiza el mapa con lo comprobado.',
        fields: [{ name: 'indicaciones', label: 'Algo en lo que fijarse (opcional)', type: 'textarea', required: false }] });
      if (x) await run('proyecto.revisar', { proyecto: c.id, indicaciones: x.indicaciones }, 'Revisión lanzada', e.currentTarget);
    } }, r?.estado === 'EN_CURSO' ? 'REVISIÓN EN MARCHA' : 'REVISAR PROYECTO')));
}

/** Parte superior: esquemática. */
function summaryPanel(c, d) {
  const [, label, tone] = STATES[c.estado] || ['⚪', c.estado, 'idle'];
  const hasJob = c.estado !== 'LIBRE';
  const modo = d.modo || c.modo || 'AUTO';
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  const [ahora, siguiente] = WAITING.includes(c.estado) ? waitLines(c) : [running && c.actividad ? `${c.actividad} · ${c.ahora || ''}` : c.ahora, c.siguiente];
  const ceo = d.ceo || {};
  const exec = (ceo.proveedores || []).find((x) => x.nombre === 'Claude ejecutor');
  const execText = exec && future(exec.hasta) ? `limitado hasta ${hhmm(exec.hasta)}` : 'disponible';
  const r = d.resultado;
  const long = (c.objetivo_len || 0) > (c.objetivo || '').length;
  return h('section', { class: `panel sum m-${mood(c)}` },
    h('div', { class: 'sum-head' }, h('span', { class: `pill tone-${needsDecision(c) ? 'ask' : tone}` }, needsDecision(c) ? decisionLabel(c) : label),
      c.pendientes ? h('span', { class: 'chip' }, `Pendientes ${c.pendientes}`) : null,
      c.anadidos ? h('span', { class: 'chip' }, `Añadidos sin incorporar ${c.anadidos}`) : null,
      hasJob && c.trabajo ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => openCeo(`trabajo:${c.trabajo}`, ['ERROR', 'BLOQUEADO'].includes(c.estado) ? { pregunta: '¿Qué ha fallado y qué recomiendas?' } : {}) }, '💬 Consultar al CEO') : null),
    hasJob && c.estado !== 'CANCELADO' ? h('div', { class: 'sum-ceo' },
      seg(`modo-${c.trabajo}`, 'CEO', [['AUTO', 'AUTO', MODO_HELP.AUTO], ['MANUAL', 'MANUAL', MODO_HELP.MANUAL]], modo,
        (v) => run('trabajo.modo', { trabajo: c.trabajo, modo: v }, v)),
      h('small', { class: 'muted' }, MODO_HELP[modo])) : null,
    hasJob ? fold('ceo', `CEO: ${modo === 'MANUAL' ? 'Antonio' : ceo.actual || 'Codex'} · ${modo} · Sesión: ${d.sesion === 'NUEVA' ? 'nueva' : 'actual'} · Claude ejecutor: ${execText}`,
      h('ul', { class: 'kv' },
        ceo.motivo ? h('li', {}, `Motivo: ${ceo.motivo}`) : null,
        ceo.vuelve ? h('li', {}, `Codex vuelve a probarse: ${when(ceo.vuelve)}`) : null,
        (ceo.proveedores || []).map((x) => h('li', {}, `${x.nombre}: ${future(x.hasta) ? `limitado (${x.motivo}) hasta aprox. ${hhmm(x.hasta)}` : 'disponible'}`)))) : null,
    // V3.7: sesiones de Claude que el CEO gestiona solo (sólo informativo: no hay nada que hacer aquí).
    hasJob && d.sesiones ? fold('sesiones', `Sesiones de Claude: ${d.sesiones.total} · la actual lleva ${d.sesiones.rondas_actual} ronda(s)`,
      h('ul', { class: 'kv' },
        h('li', {}, `Contexto medido en su última llamada: ${d.sesiones.contexto ? `${fmt(d.sesiones.contexto)} tokens (con ${fmt(d.sesiones.limite)} se abre una sesión limpia)` : 'sin medir todavía'}`),
        d.sesiones.ceo ? h('li', {}, `Última decisión del CEO: ${d.sesiones.ceo}`) : null,
        d.sesiones.proxima ? h('li', {}, `Próxima ronda: ${d.sesiones.proxima}`) : null,
        d.sesiones.cambios.map((x) => h('li', {}, `${new Date(x.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · sesión ${x.sesion} desde la ronda ${x.desde_ronda}: ${x.motivo}`)))) : null,
    hasJob ? [
      h('p', { class: 'lbl' }, 'OBJETIVO ACTUAL'),
      h('p', { class: 'sum-goal' }, c.objetivo),
      long || (c.objetivo || '').length > 180 ? h('button', { class: 'link', type: 'button', onclick: () => openGoal(c) }, 'Ver objetivo completo') : null,
      line('AHORA', ahora), line('SIGUIENTE', siguiente, 'next'),
      c.detalle && (!running || c.estado === 'SIN_ACTIVIDAD') ? h('p', { class: 'note' }, c.detalle) : null,
    ] : h('p', { class: 'muted' }, 'Sin objetivo todavía.'),
    jobDecision(c),
    r ? h('div', { class: 'result' }, h('p', { class: 'lbl' }, `ÚLTIMO RESULTADO · ronda ${r.ronda} · ${r.estado}`),
      h('ul', {}, r.puntos.map((x) => h('li', { class: `r-${x.tipo}` }, h('i', { 'aria-hidden': 'true' }, MARK[x.tipo] || '·'), ' ', x.texto))),
      h('div', { class: 'result-act' },
        h('button', { class: 'link', type: 'button', onclick: () => viewReport(c.trabajo, r.ronda) }, 'Ver informe completo'),
        h('button', { class: 'link icon-text', type: 'button', 'aria-label': 'Copiar informe completo', title: 'Copiar informe completo',
          onclick: (e) => copiarInformeCompleto(c.trabajo, null, e.currentTarget) }, svg('copy'), 'Copiar'))) : null,
    h('div', { class: 'actions' }, buttonsFor(c).filter((b) => b && b.getAttribute('aria-label') !== `Detalles de ${c.nombre}`)),
    // Lo técnico del motor (proveedores, autonomía, diagnóstico), plegado: a mano cuando hace falta, sin ocupar la cabecera.
    hasJob ? h('details', { class: 'fold motor', 'data-k': 'motor' }, h('summary', {}, 'Motor y diagnóstico'), autonomiaFold(d.autonomia), diagnosticoFold(d.diagnostico)) : null);
}

/** DIRECCIÓN DEL PROYECTO: objetivo, situación, conseguido, pendiente, comprobado, problemas y recomendaciones del CEO.
 *  Sólo junta lo que ya existe: el mapa (canon), el objetivo en curso y la última revisión. Lo que falta se dice. */
// Etapas de la conciliación con lo hecho fuera de CEOPadre (V3.5): se ven siempre, con su motivo.
const CONC = { DETECTADO: ['Cambios detectados fuera de CEOPadre', 'warn'], ANALIZANDO: ['Analizando los cambios', 'work'], ANALIZADO: ['Analizado, sin comprobar', 'warn'],
  VERIFICADO: ['Verificado; falta incorporarlo al mapa', 'warn'], INCORPORADO: ['Mapa al día con lo comprobado', 'ok'], AL_DIA: ['Mapa al día', 'ok'] };
function concChip(c) {
  const k = c.conciliacion;
  if (!k) return null;
  const [t, tone] = CONC[k.etapa] || [k.etapa, 'idle'];
  return h('p', { class: `conc conc-${tone}` }, h('b', {}, t), k.detalle && !k.detalle.startsWith(t) ? ` · ${k.detalle}` : k.detalle ? k.detalle.slice(t.length) : '', k.updated_at ? h('small', { class: 'muted' }, ` (${when(k.updated_at)})`) : null);
}
function direccionPanel(c, d) {
  const m = d.mapa && !d.mapa.error ? d.mapa : null;
  const e = m?.estado || { hecho: [], en_curso: [], falta: [], bloqueado: [] };
  const rev = revCache.get(c.id)?.data?.resultado || null;
  const txt = (x) => (typeof x === 'object' ? x.text || `${x.que} → ${x.resultado}` : x);
  const verif = e.hecho.filter((x) => /VERIFIC|COMPROB/i.test(x.evidence || ''));
  const comprobado = [...(rev?.comprobado || []).map((x) => `${x.que}: ${x.resultado}`), ...verif.map(txt)];
  const problemas = [...e.bloqueado.map(txt), ...(rev?.bloqueos || []), ...(rev?.contradicho || []),
    ['BLOQUEADO', 'ERROR'].includes(c.estado) && c.detalle ? c.detalle : null].filter(Boolean);
  const recos = [...(rev?.prioridades || []).slice(0, 3).map((p) => `${p.objetivo}${p.requiere_antonio ? ' (necesita algo tuyo)' : ''}`),
    c.siguiente && !['LIBRE', 'TERMINADO', 'CANCELADO'].includes(c.estado) ? `Siguiente paso: ${c.siguiente}` : null].filter(Boolean);
  const box = (t, items, empty, cls = '') => h('div', { class: `dir-box ${cls}` }, h('p', { class: 'lbl' }, `${t}${items.length ? ` · ${items.length}` : ''}`),
    items.length ? h('ul', { class: 'mlist' }, items.slice(0, 4).map((x) => h('li', {}, String(x).slice(0, 220))), items.length > 4 ? h('li', { class: 'more' }, `+${items.length - 4} más (mapa completo)`) : null)
      : h('p', { class: 'muted small' }, empty));
  const hasJob = !['LIBRE', 'CANCELADO'].includes(c.estado);
  const vivo = hasJob && c.estado !== 'TERMINADO';
  const prio = rev?.prioridades?.[0];
  // «Continúa con la siguiente prioridad»: la primera de la última revisión, o que el CEO la deduzca del mapa y la revisión.
  const seguir = async (b) => {
    const texto = prio ? prio.objetivo : 'Continúa con la siguiente prioridad de este proyecto según su mapa, lo pendiente y su última revisión. Antes de empezar, comprueba el estado real; verifica cada paso y no repitas lo ya hecho.';
    const ok = await ask({ title: 'Continuar con la siguiente prioridad', ok: 'Continuar', help: `${prio ? `Según la última revisión: «${prio.objetivo.slice(0, 300)}».` : 'El CEO elegirá la siguiente prioridad a partir del mapa y la última revisión.'}${vivo ? ' Ya hay un objetivo en marcha: éste esperará en cola.' : ''}` });
    if (ok) await run('objetivo.iniciar', { proyecto: c.id, texto }, 'Objetivo lanzado', b);
  };
  // «Quiero cambiar este objetivo»: con uno en marcha se corrige ESE objetivo (añadido, sin empezar de cero); si no, uno nuevo.
  const cambiar = (b) => (vivo ? actions.add(c, b) : actions.goal(c, b));
  return h('section', { class: 'panel dir', 'aria-labelledby': 'h-dir' },
    h('header', { class: 'dir-head' }, h('h4', { id: 'h-dir' }, 'Dirección del proyecto'),
      c.fuera?.commits || c.fuera?.archivos ? h('small', { class: 'muted' }, `fuera de CEOPadre: ${[c.fuera.commits && `${c.fuera.commits} commit${c.fuera.commits === 1 ? '' : 's'}`, c.fuera.archivos && `${c.fuera.archivos} archivo${c.fuera.archivos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}`) : null),
    h('div', { class: 'dir-top' },
      h('div', {}, h('p', { class: 'lbl' }, 'OBJETIVO'), h('p', { class: 'dir-mission' }, m?.mision || m?.definicion?.resumen || 'Sin definir todavía: «Revisar proyecto» lo propone a partir del repositorio real.'),
        vivo ? h('small', { class: 'muted' }, `Ahora: ${cleanGoal(c.objetivo)}`) : null),
      h('div', {}, h('p', { class: 'lbl' }, 'SITUACIÓN'), h('p', {}, rev?.estado || c.ahora || (hasJob ? MOOD_LABEL[c.estado] : 'Sin objetivo en curso')),
        rev ? h('small', { class: 'muted' }, 'según la última revisión') : null)),
    // V3.5 · la ficha completa: realizado ≠ verificado ≠ publicado; decisiones vigentes; fecha y fuentes de la última revisión.
    concChip(c),
    h('div', { class: 'dir-grid' },
      box('REALIZADO', e.hecho.map(txt), 'Nada registrado todavía.'),
      box('VERIFICADO', comprobado, 'Nada comprobado todavía.', 'ok'),
      box('PUBLICADO', rev?.publicado || [], 'Nada confirmado en producción todavía.', 'ok'),
      box('TRABAJANDO', vivo ? [`${cleanGoal(c.objetivo)}${c.actividad ? ` · ${c.actividad}` : ''}`] : [], c.pausado ? 'Proyecto en pausa.' : 'Nada en marcha ahora.', 'reco'),
      box('PENDIENTE', [...e.en_curso.map(txt), ...e.falta.map(txt), ...(rev?.pendiente || [])], 'Nada pendiente registrado.'),
      box('PENDIENTE DE VERIFICAR', [...(c.conciliacion?.pendiente || []), ...(rev?.declarado_sin_verificar || [])], 'Nada.', 'warn'),
      box('PROBLEMAS', problemas, 'Ninguno registrado.', 'bad'),
      box('DECISIONES VIGENTES', (m?.decisiones || []).map((x) => `${x.texto}${x.fecha ? ` (${x.fecha})` : ''}${x.protegida ? ' 🔒' : ''}`), 'Ninguna registrada.'),
      box('SIGUIENTES PRIORIDADES', recos, 'Sin propuesta todavía: la conciliación o «Revisar proyecto» las propone.', 'reco')),
    h('p', { class: 'muted small dir-src' }, `Última revisión: ${revCache.get(c.id)?.data?.fin ? when(revCache.get(c.id).data.fin) : 'nunca'} · mapa actualizado: ${m?.actualizado ? when(m.actualizado) : '—'}${m?.fuentes?.length ? ` · fuentes: ${m.fuentes.slice(0, 4).join(', ')}` : ''}${revCache.get(c.id)?.data?.evidencia?.git?.ultimo_commit ? ` · git ${revCache.get(c.id).data.evidencia.git.ultimo_commit.hash}` : ''}`),
    h('div', { class: 'a-acts' },
      h('button', { class: 'btn primary', type: 'button', onclick: (e2) => seguir(e2.currentTarget) }, 'Continúa con la siguiente prioridad'),
      h('button', { class: 'btn ghost', type: 'button', onclick: (e2) => cambiar(e2.currentTarget) }, 'Quiero cambiar este objetivo'),
      c.pausado ? h('button', { class: 'btn primary small', type: 'button', onclick: (e2) => run('proyecto.reanudar', { proyecto: c.id }, 'Proyecto reanudado', e2.currentTarget) }, '▶ Continuar el proyecto')
        : h('button', { class: 'btn ghost small', type: 'button', title: 'Pausa TODO el proyecto: no empieza nada en él (ni horarios) y lo que trabaja se detiene sin perder lo hecho', onclick: async (e2) => {
          const b = e2.currentTarget;
          if (await ask({ title: `¿Pausar todo ${c.nombre}?`, help: 'Nada nuevo empezará en este proyecto (ni objetivos, ni horarios, ni objetivos de negocio) y lo que esté trabajando se detiene en un punto seguro. «Continuar el proyecto» lo retoma donde se quedó.', ok: 'Pausar el proyecto' })) await run('proyecto.pausar', { proyecto: c.id }, 'Proyecto en pausa', b);
        } }, '⏸ Pausar el proyecto'),
      c.conciliacion?.etapa === 'DETECTADO' ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e2) => run('proyecto.conciliar', { proyecto: c.id }, 'Conciliando', e2.currentTarget) }, 'Conciliar ahora') : null,
      vivo ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e2) => actions.instruct(c, e2.currentTarget) }, 'Dar una instrucción') : null,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => openCeo(`proyecto:${c.id}`) }, '💬 Consultar al CEO'),
      m ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { $('#map-title').textContent = `Mapa · ${c.nombre}`; paintMap(d.mapa, (id, que, b) => run(`canon.${que}`, { proyecto: c.id, id }, 'Hecho', b), (ref, b) => actions.consult(c, ref, b)); $('#map').showModal(); } }, 'Ver mapa completo') : null));
}

// Diagnóstico del objetivo (plegado): por qué está como está, sin abrir logs.
function diagnosticoFold(g) {
  if (!g) return null;
  const p = g.proceso, u = g.ultima_transicion;
  return fold('diagnostico', `Diagnóstico: ${g.estado} · bloquea: ${g.bloquea} · ${g.autorecuperable ? 'se recupera solo' : 'necesita a Antonio'}`,
    h('ul', { class: 'kv' },
      h('li', {}, `Proceso: ${p ? `${p.tipo} pid ${p.pid} (${p.vivo ? 'vivo' : 'muerto'}) desde ${when(p.desde)}${p.tareas_fondo ? ` · ${p.tareas_fondo} tarea(s) en segundo plano` : ''}` : 'ninguno'} · bucle ${g.bucle ? 'activo' : 'parado'} · paso ${g.paso}`),
      h('li', {}, `Última actividad: ${g.ultima_actividad ? when(g.ultima_actividad) : '—'}${g.actividad ? ` (${g.actividad})` : ''}`),
      u ? h('li', {}, `Última transición: ${u.estado}/${u.step} ${when(u.at)}${u.detalle ? ` — ${u.detalle}` : ''}`) : null,
      h('li', {}, `Reintentos: ${g.reintentos}`),
      (g.esperas || []).map((e) => h('li', {}, `Espera #${e.id}: ${e.descripcion} · próxima comprobación ${e.proxima ? when(e.proxima) : 'ya'}${e.error ? ` · error: ${e.error}` : ''}`))));
}

// Métricas de autonomía de CEOPadre (todas las carpetas; las recalcula el servidor solo). Antes/después de V2.7.
function autonomiaFold(a) {
  if (!a?.despues) return null;
  const x = a.despues, b = a.antes || {};
  const pct = (v) => (v == null ? '—' : `${v} %`);
  const fila = (k, t) => h('li', {}, `${t}: ${k === 'pct_terminados_sin_antonio' ? pct(x[k]) : x[k] ?? '—'} (antes ${k === 'pct_terminados_sin_antonio' ? pct(b[k]) : b[k] ?? '—'})`);
  return fold('autonomia', `Autonomía desde V2.7: ${x.dudas_resueltas_ceo ?? '—'} dudas resueltas por el CEO · ${x.dudas_escaladas_antonio ?? '—'} te las pasó a ti · ${x.intervenciones_por_objetivo ?? '—'} intervenciones/objetivo`,
    h('ul', { class: 'kv' },
      fila('objetivos', 'Objetivos'), fila('terminados', 'Terminados'), fila('dudas_resueltas_ceo', 'Dudas resueltas por el CEO'),
      fila('dudas_escaladas_antonio', 'Dudas que te pasó a ti'), fila('pct_terminados_sin_antonio', 'Terminados sin intervenir tú'),
      fila('intervenciones_por_objetivo', 'Intervenciones tuyas por objetivo'),
      h('li', { class: 'muted' }, a.muestra_suficiente ? `Actualizado ${when(a.generado)}` : `Muestra insuficiente (${x.terminados}/${a.muestra_minima} terminados): aún no se compara · actualizado ${when(a.generado)}`)));
}

async function openGoal(c) {
  if ((c.objetivo_len || 0) <= (c.objetivo || '').length) return view('Objetivo completo', c.objetivo);
  const r = await api.cmd('trabajo.objetivo', { trabajo: c.trabajo });
  if (r?.ok) view('Objetivo completo', r.data.texto); else toast(r?.error || 'No se pudo leer el objetivo', 'bad');
}

/** Escribir + pendientes (orden de creación; sólo un extracto de cada uno). */
const ADD_STATE = { PENDIENTE: 'Enviado · pendiente de incorporar', ENTREGADO: 'Entregado a Claude', RECIBIDO: 'Claude lo tiene · incorporándolo',
  INCORPORADO: 'Incorporado' };
function writePanel(c, d) {
  const hasJob = !['LIBRE', 'CANCELADO'].includes(c.estado);
  const canAdd = hasJob && c.estado !== 'TERMINADO';
  const open = (e) => (hasJob ? actions.instruct(c, e.currentTarget) : actions.goal(c, e.currentTarget));
  const pend = d.pendientes || [];
  const adds = d.anadidos || [];
  return h('section', { class: 'panel write' },
    canAdd ? h('button', { class: 'write-btn add', type: 'button', onclick: (e) => actions.add(c, e.currentTarget) },
      h('b', {}, 'Añadir al objetivo…'), h('small', { class: 'muted' }, 'Algo que olvidaste: entra en el trabajo que ya está en marcha')) : null,
    h('button', { class: 'write-btn', type: 'button', onclick: open }, hasJob ? 'Escribir instrucción o prompt…' : 'Escribir un objetivo nuevo…'),
    adds.length ? [h('p', { class: 'lbl' }, `Añadidos al objetivo (${adds.length})`),
      h('ol', { class: 'pend' }, adds.map((a) => h('li', {},
        h('div', { class: 'pend-tags' }, h('span', { class: 'tag' }, `#${a.n}`),
          h('span', { class: `tag ${a.estado === 'INCORPORADO' ? 'done' : 'direct'}` }, `${ADD_STATE[a.estado] || a.estado}${a.estado === 'INCORPORADO' && a.ronda ? ` · ronda ${a.ronda}` : ''}`),
          h('small', { class: 'muted' }, ago(a.creado))),
        h('p', { class: 'pend-text' }, a.extracto, a.chars > a.extracto.length ? '…' : ''))))] : null,
    pend.length ? [h('p', { class: 'lbl' }, `Instrucciones pendientes (${pend.length})`),
      pendList(pend, (p) => [iconBtn('edit', 'Editar pendiente', () => editPending(p)), iconBtn('trash', 'Eliminar pendiente', (e) => deletePending(p, e.currentTarget), 'danger')])]
      : null);
}
/** Pendientes en su orden (sólo extracto); `acts(p)` = sus botones. */
const pendList = (pend, acts) => h('ol', { class: 'pend' }, pend.map((p) => h('li', {},
  h('div', { class: 'pend-tags' }, h('span', { class: `tag ${p.tipo === 'DIRECTO' ? 'direct' : ''}` }, TIPO[p.tipo] || p.tipo),
    h('span', { class: 'tag' }, p.sesion === 'NUEVA' ? 'NUEVA SESIÓN' : 'CONTINUAR'), h('small', { class: 'muted' }, `${fmt(p.chars)} car.`)),
  h('p', { class: 'pend-text' }, p.extracto),
  h('div', { class: 'pend-act' }, ...acts(p)))));

async function editPending(p, trabajo = detailCache?.d?.trabajo?.trabajo) {
  const r = await api.cmd('pendiente.leer', { id: p.id });
  if (!r?.ok) { toast(r?.error || 'No se pudo leer', 'bad'); return; }
  if (r.data.consumida) { toast('Ya se entregó (CONSUMIDA): no se puede editar', 'bad'); await refresh(); return; }
  const v = await compose({ title: 'Editar pendiente', text: r.data.texto, tipo: r.data.tipo, sesion: r.data.sesion, ok: 'Guardar', trabajo });
  if (v) await run('pendiente.editar', { id: p.id, texto: v.texto, tipo: v.tipo, sesion: v.sesion }, 'Pendiente actualizado');
}
async function deletePending(p, b) {
  const ok = await ask({ title: '¿Eliminar este pendiente?', help: `«${p.extracto.slice(0, 120)}${p.chars > 120 ? '…' : ''}» no se enviará.`, ok: 'Eliminar', danger: true });
  if (ok) await run('pendiente.eliminar', { id: p.id }, 'Pendiente eliminado', b);
}

/**
 * ESPERANDO UNA CONDICIÓN (monitorizado): qué se espera, cómo se comprueba, si su monitor vive y cuándo se miró por última
 * vez. Antonio puede comprobar ya, darla por cumplida, reactivar el objetivo o cancelarlo (el monitor sigue si no lo marca).
 */
function esperasPanel(c, d) {
  const list = (d.esperas || []).filter((x) => x.estado === 'ESPERANDO_CONDICION' || x.esperas.some((e) => e.estado === 'ACTIVA'));
  if (!list.length) return null;
  const B = (label, op, params, cls = '') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: (e) => run(op, params, label, e.currentTarget) }, label);
  return h('section', { class: 'panel waits m-wait' }, h('h4', {}, `Esperando algo externo (${list.length})`),
    list.map((x) => h('div', { class: 'wait-item' },
      h('p', { class: 'ln goal', title: x.objetivo }, x.objetivo),
      x.esperas.filter((e) => e.estado === 'ACTIVA').map((e) => h('div', { class: 'wait-cond' },
        line(e.interna ? 'SIGUE SOLO' : 'QUÉ SE ESPERA', e.descripcion),
        h('p', { class: 'ln muted' }, `Comprobada ${e.comprobada ? ago(e.comprobada) : 'aún no'} · cada ${Math.round(e.cada_s / 60) || 1} min · hasta ${when(e.hasta)}`),
        e.monitor ? h('p', { class: `ln ${e.monitor.vivo ? 'muted' : 'note'}` }, `Monitor pid ${e.monitor.pid}: ${e.monitor.vivo ? 'vivo' : `caído${e.monitor.relanzable ? ' (se relanza solo)' : ''}`}`) : null,
        e.error ? h('p', { class: 'ln muted' }, e.error) : null,
        h('div', { class: 'row' }, B('Comprobar ahora', 'espera.comprobar', { id: e.id }), B('Dar por cumplida', 'espera.resolver', { id: e.id, resultado: 'CUMPLIDA' })))),
      h('div', { class: 'row' },
        x.estado === 'ESPERANDO_CONDICION' ? B('Reactivar ahora', 'trabajo.reanudar', { trabajo: x.trabajo }) : null,
        x.estado === 'ESPERANDO_CONDICION' ? h('button', { class: 'btn small danger', type: 'button',
          onclick: (e) => actions.cancel(c, e.currentTarget, x.trabajo, x.esperas.some((w) => w.monitor)) }, 'Cancelar objetivo') : null))));
}

/** Historial de rondas: siempre visible, cada ronda plegada. */
function roundsPanel(d) {
  return h('section', { class: 'panel' }, h('h4', {}, `Historial de trabajo (${d.rondas?.length || 0} pasos)`),
    ...(d.rondas?.length ? d.rondas.map((r) => roundItem(r, d.trabajo?.trabajo)) : [h('p', { class: 'muted' }, 'Todavía no ha trabajado en este objetivo.')]));
}

/** Todo lo técnico, plegado: consumo, lecciones, mensajes, objetivos anteriores y la carpeta. */
function techPanel(c, d) {
  const m = d.metricas;
  const lessons = d.lecciones || [];
  return h('section', { class: 'panel folds' },
    m ? fold('consumo', '📊 Consumo', h('ul', { class: 'kv' },
      h('li', {}, `Rondas: ${m.rondas}`),
      h('li', {}, `Decisiones CEO: ${m.codex.n ?? 0}${Object.keys(m.decisiones_por_ceo || {}).length ? ` (${Object.entries(m.decisiones_por_ceo).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''} · entrada ${fmt(m.codex.ent)} car. / ${fmt(m.codex.tin)} tokens (${fmt(m.codex.tcache)} en caché) · salida ${fmt(m.codex.sal)} car. / ${fmt(m.codex.tout)} tokens`),
      h('li', {}, `Encargos a Claude: ${m.claude.n ?? 0} · prompts ${fmt(m.claude.ent)} car. · tokens salida ${fmt(m.claude.tout)}`),
      h('li', {}, `Mayor entrada al CEO: ${fmt(m.codex.max_ent)} car. · informes antiguos reenviados: ${m.codex.informes_antiguos}`),
      h('li', {}, `Intervenciones de Antonio: ${m.intervenciones_antonio}`),
      h('li', {}, `Fallos/reintentos: ${(m.codex.fallos ?? 0) + (m.claude.fallos ?? 0)}`),
      h('li', {}, `Duración: ${Math.round(m.duracion_s / 60)} min`))) : null,
    lessons.length ? fold('lecciones', `Lecciones (${lessons.length})`, lessons.map(lessonItem)) : null,
    d.notas?.length ? fold('notas', `Mensajes y avisos (${d.notas.length})`,
      h('ul', { class: 'notes' }, d.notas.map((n) => h('li', {}, h('b', {}, n.kind === 'instruccion' ? `${TIPO[n.tipo] || n.tipo} · CONSUMIDA` : n.kind), ' ',
        n.text, n.chars > n.text.length ? '…' : '')))) : null,
    d.trabajos?.length > 1 ? fold('objetivos', `Objetivos de este proyecto (${d.trabajos.length})`,
      h('ul', { class: 'notes' }, d.trabajos.map((t) => h('li', {}, h('b', {}, (STATES[t.estado] || [])[1] || t.estado), ' · ', t.objetivo, ' ', h('button', { class: 'link', type: 'button', onclick: () => openCeo(`trabajo:${t.id}`) }, 'Consultar al CEO'))))) : null,
    fold('proyecto', c.tipo === 'GESTION' ? 'Gestión' : 'Proyecto',
      h('p', { class: 'mono' }, d.proyecto?.ruta || c.ruta),
      c.componentes?.length ? h('p', { class: 'ln' }, h('b', {}, 'COMPONENTES'), ' ', c.componentes.join(' · ')) : null,
      h('div', { class: 'row' }, iconBtn('unlink', 'Quitar de CEOPadre', (e) => unlink(c, e.currentTarget), 'danger'))));
}

function roundItem(r, trabajo) {
  const list = (label, items) => (items?.length ? `${label}:\n${items.map((x) => `- ${x}`).join('\n')}` : '');
  const body = [list('Claude hizo', r.hecho), list('Claude comprobó', r.comprobado), list('SIN COMPROBAR', r.no_comprobado),
    list('Pendiente', r.pendiente), list('Problemas', r.problemas), r.cambio_de_alcance ? `Cambio de alcance: ${r.cambio_de_alcance}` : '',
    r.sin_formato ? '(Claude no devolvió el informe con formato)' : '', r.origen === 'ANTONIO' ? 'Mensaje literal de Antonio: sin revisión del CEO' : r.codex_decidio ? `${r.ceo || 'Codex'} decidió → ${r.codex_decidio}` : 'El CEO aún no ha decidido']
    .filter(Boolean).join('\n\n');
  const failed = String(r.estado).startsWith('FALLO');
  return h('details', { class: `round ${failed ? 'failed' : ''}`, 'data-k': `r-${r.ronda}-${r.fin}` },
    h('summary', {}, h('b', {}, `RONDA ${r.ronda} · ${r.estado}`),
      r.no_comprobado?.length ? h('em', {}, ` · sin comprobar: ${r.no_comprobado.length}`) : null, h('small', {}, ` ${ago(r.fin)}`)),
    h('pre', { class: 'prompt' }, `${r.origen === 'ANTONIO' ? 'Antonio envió (literal)' : 'El CEO pidió'}:\n${r.codex_pidio}`),
    h('pre', {}, body),
    failed || String(r.estado).startsWith('INTERRUMPIDA') || !trabajo ? null : h('button', { class: 'link', type: 'button', onclick: () => viewReport(trabajo, r.ronda) }, 'Ver informe completo'));
}

function lessonItem(l) {
  const B = (label, op, extra = {}) => h('button', { class: 'btn small', onclick: (e) => run(op, { id: l.id, ...extra }, label, e.currentTarget) }, label);
  return h('div', { class: 'lesson' }, h('p', {}, l.text), h('small', { class: 'muted' }, `${l.estado} · ${l.scope}`),
    l.estado === 'candidata' ? h('div', { class: 'row' }, B('Promover al proyecto', 'leccion.promover'), B('Promover a global', 'leccion.promover', { ambito: 'global' }), B('Rechazar', 'leccion.rechazar')) : null);
}

// ------------------------------------------------------------------ arranque

$('#d-back').addEventListener('click', () => { openId = null; show('p-list'); });
$('#viewer-copy').prepend(svg('copy'));
$('#viewer-copy').addEventListener('click', (e) => viewerSrc && copiarInformeCompleto(viewerSrc.trabajo, viewerSrc.ronda, e.currentTarget));
$('#cmp-paste').prepend(svg('paste'));
$('#b-create-project').addEventListener('click', (e) => createFolder('proyecto.nuevo', 'proyecto', 'E:\\ECOAPP', e.currentTarget));
// QUITAR = desvincular. CEOPadre no tiene ninguna función que borre carpetas.
async function unlink(c, btn) {
  const ok = await ask({ title: `¿Quitar ${c.nombre} de CEOPadre?`, ok: 'Sí, quitar', danger: true,
    help: 'Se quitará de CEOPadre. La carpeta y todos sus archivos permanecerán intactos. El historial se conserva y podrás volver a vincularlo cuando quieras.' });
  if (ok && await run('proyecto.desvincular', { proyecto: c.id, confirmar: true }, 'Quitado de CEOPadre', btn) && openId) { openId = null; show('p-list'); }
}

// ------------------------------------------------------------------ vincular proyecto
// Vincular = decirle a CEOPadre qué carpeta EXISTENTE es un proyecto. En el PC: selector de carpetas de
// Windows o lista detectada. En el móvil: sólo la lista que detecta el PC (nunca rutas escritas).

let linkTarget = null; // { ruta, nombre, candidato? }
const linkStatus = (t) => { $('#link-status').textContent = t; };

function linkConfirm(target) {
  linkTarget = target;
  $('#link-name').value = target.nombre;
  $('#link-path').textContent = target.ruta;
  $('#link-main').hidden = true;
  $('#link-confirm').hidden = false;
  $('#link-name').focus();
}

function linkBack() { linkTarget = null; $('#link-confirm').hidden = true; $('#link-main').hidden = false; }

async function linkLoad(refresh, tries = 0) {
  if (!tries) { linkStatus(refresh ? 'Buscando proyectos…' : 'Cargando…'); $('#link-list').textContent = ''; }
  const r = await api.cmd('proyecto.candidatos', { actualizar: refresh });
  if (!r?.ok) { linkStatus(r?.error || 'No se pudo consultar el PC'); return; }
  const c = r.data;
  if (c.buscando && tries < 20) { linkStatus('Buscando proyectos…'); setTimeout(() => linkLoad(false, tries + 1), 1500); return; }
  const ul = $('#link-list');
  ul.replaceChildren(...c.lista.map((x) => h('li', {},
    h('div', { class: 'cand-text' }, h('b', {}, x.nombre), h('small', { class: 'mono' }, x.ruta),
      x.componentes?.length ? h('small', {}, `Componentes: ${x.componentes.join(', ')}`) : null),
    h('button', { class: 'btn small', onclick: () => linkConfirm({ ruta: x.ruta, nombre: x.nombre, candidato: x.id }) }, 'Vincular'))));
  linkStatus(c.lista.length
    ? `${c.lista.length} sin vincular en ${c.raices.join(', ')}${c.actualizado ? ` · buscado ${ago(c.actualizado)}` : ''}`
    : `No hay proyectos sin vincular en ${c.raices.join(', ')}.`);
}

async function openLink() {
  const dlg = $('#link');
  linkBack();
  $('#link-pick').hidden = !LOCAL; // el selector de carpetas sólo tiene sentido delante del PC
  const offline = !LOCAL && !data.pc.online;
  $('#link-offline').hidden = !offline;
  $('#link-refresh').disabled = offline;
  $('#link-list').textContent = '';
  linkStatus('');
  dlg.showModal();
  if (!offline) await linkLoad(false);
}

$('#b-new-project').addEventListener('click', openLink);
$('#link-close').addEventListener('click', () => $('#link').close());
$('#link-back').addEventListener('click', linkBack);
$('#link-refresh').addEventListener('click', () => linkLoad(true));
$('#link-pick').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  linkStatus('Se ha abierto el selector de carpetas de Windows en el PC…');
  try {
    const r = await api.cmd('proyecto.elegir_carpeta', {});
    if (!r?.ok) { linkStatus(r?.error || 'No se pudo abrir el selector'); return; }
    if (r.data.cancelado) { linkStatus('No se eligió ninguna carpeta.'); return; }
    if (r.data.ya_vinculado) { linkStatus(`${r.data.ruta} ya está vinculada.`); return; }
    linkStatus('');
    linkConfirm({ ruta: r.data.ruta, nombre: r.data.nombre });
  } finally { b.disabled = false; }
});
$('#link-ok').addEventListener('click', async (e) => {
  const nombre = $('#link-name').value.trim();
  if (!nombre) { $('#link-name').focus(); return; }
  const t = linkTarget;
  const ok = await run(t.candidato ? 'proyecto.vincular' : 'proyecto.crear',
    t.candidato ? { candidato: t.candidato, nombre } : { nombre, ruta: t.ruta }, 'Proyecto vinculado', e.currentTarget);
  if (ok) $('#link').close();
});
setInterval(() => { for (const el of document.querySelectorAll('[data-ago]')) el.textContent = ago(el.dataset.ago); }, 5000);
// Al pasar la hora de vuelta, repintar con el reloj local (ninguna llamada ni al PC ni a ninguna IA).
let waitSig = '';
setInterval(() => {
  const sig = data.proyectos.filter((c) => WAITING.includes(c.estado)).map((c) => `${c.id}:${future(c.espera_hasta)}`).join();
  if (sig !== waitSig && !$('#dlg').open) { waitSig = sig; paintList(); }
}, 15_000);

async function start() {
  api ??= LOCAL ? localApi() : await remoteApi();
  if (!LOCAL) {
    const { data: s } = await api.sb.auth.getSession();
    if (!s.session) {
      show('p-login');
      $('#l-go').onclick = async () => {
        const { error } = await api.sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
        if (error) { $('#l-err').textContent = error.message; $('#l-err').hidden = false; return; }
        $('#l-pass').value = '';
        start();
      };
      return;
    }
  }
  const ai = aiEditor({ api, toast, onApplied: () => void refresh() }); // EDITAR CON IA (uno solo para todas las bandejas)
  rui ??= remoteUi({ api, ask, toast, show, data: () => data, ago, local: LOCAL, ai });
  aui ??= autoUi({ api, ask, toast, show, data: () => data, run, viewText: (t, x) => view(t, x), ai, alquileres: () => ALQ.cards(data.proyectos) });
  nui ??= negocioUi({ api, ask, toast, show, data: () => data, run, viewText: (t, x) => view(t, x) });
  show('p-list');
  await refresh();
  $('#b-ceo').hidden = false;
  aplicarRuta(); // enlace directo (?v= · ?proyecto= · ?objetivo= · ?ceo=)
  api.watch(() => void refresh());
  $('#b-sync').onclick = () => void syncAll(true);
  if (!LOCAL) { $('#b-logout').hidden = false; $('#b-logout').onclick = logout; }
  void syncAll(false); // al abrir CEOPadre: estado real de todos los proyectos (local, sin modelos)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastSync > AUTO_SYNC_MS) void syncAll(false); });
}

// SALIR: cierra la sesión de este móvil y, si se marca, TODAS las demás (móvil perdido o sospecha). El PC vuelve a entrar
// solo con su credencial local en menos de un minuto; quien tuviera una sesión robada se queda fuera.
async function logout() {
  const r = await ask({ title: 'Salir de CEOPadre', ok: 'Salir', help: 'Este móvil tendrá que volver a entrar con tu contraseña.',
    fields: [{ name: 'todas', type: 'checkbox', label: 'Cerrar también TODAS las demás sesiones (si perdiste un móvil o sospechas de un acceso)' }] });
  if (!r) return;
  await api.sb.auth.signOut({ scope: r.todas ? 'global' : 'local' }).catch(() => {});
  location.reload();
}

// ↻ ACTUALIZAR TODO: reconcilia todos los proyectos en el PC (sin IA) y refresca. Manual: siempre dice cómo fue. Automática
// (al abrir y al volver a primer plano, como mucho una cada AUTO_SYNC_MS): sólo avisa si algún proyecto no se pudo actualizar.
const AUTO_SYNC_MS = 60_000;
let syncing = null, lastSync = 0;
function syncAll(manual) {
  if (syncing) return syncing;
  const b = $('#b-sync');
  b.classList.add('busy'); b.disabled = true; b.setAttribute('aria-busy', 'true'); b.title = 'Actualizando…';
  if (manual) toast('Actualizando todos los proyectos…');
  syncing = (async () => {
    try {
      const r = await api.cmd('estado.sincronizar', {});
      lastSync = Date.now();
      const fallos = r?.ok ? r.data.errores.length : 1;
      const cuotaMal = Object.values(r?.data?.cuotas || {}).some((c) => !c.ok); // cuota sin releer: se avisa, no se disimula
      if (manual || (r?.ok && fallos)) toast(r?.ok ? r.data.mensaje : `No se pudo actualizar: ${r?.error || 'sin respuesta'}`, fallos || cuotaMal ? 'bad' : 'ok');
      detailCache = null;
      await refresh();
    } catch (e) { if (manual) toast(`No se pudo actualizar: ${e.message}`, 'bad'); } finally {
      b.classList.remove('busy'); b.disabled = false; b.removeAttribute('aria-busy'); b.title = 'Actualizar todos los proyectos ahora';
      syncing = null;
    }
  })();
  return syncing;
}

// ------------------------------------------------------------------ PWA (sólo en el móvil publicado)

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// ¿Hay algo escrito sin enviar? Entonces no se recarga (no se pierde texto de Antonio).
const typing = () => [...document.querySelectorAll('dialog[open] textarea, dialog[open] input:not([type=password])')].some((x) => x.value.trim());

function pwa() {
  if (LOCAL || !('serviceWorker' in navigator)) return;
  let asked = false; // sólo se recarga si Antonio pulsó ACTUALIZAR (nunca en la primera instalación ni en bucle)
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (asked) { asked = false; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const offer = (w) => {
      if (!w || !navigator.serviceWorker.controller) return; // primera visita: no hay nada que «actualizar»
      $('#update').hidden = false;
      $('#b-update').onclick = () => {
        if (typing()) { toast('Termina (o cierra) lo que estás escribiendo y vuelve a pulsar ACTUALIZAR', 'bad'); return; }
        asked = true;
        $('#b-update').disabled = true;
        w.postMessage('SKIP_WAITING');
      };
    };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Al volver a la app se mira si hay versión nueva (una petición del propio sw.js; nada de sondeos).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => { /* sin service worker la app sigue funcionando en línea */ });

  // AVISOS: suscripción Web Push de este dispositivo. La clave pública la da el PC; la suscripción viaja como una orden más.
  if ('PushManager' in window && 'Notification' in window) {
    const b = $('#b-avisos');
    const pintar = (on) => { b.hidden = false; b.textContent = on ? '🔔 Avisos ✓' : '🔔 Avisos'; b.title = on ? 'Avisos activados en este móvil (pulsa para probar o desactivar)' : 'Activar avisos en este móvil'; };
    navigator.serviceWorker.ready.then(async (reg) => pintar(!!(await reg.pushManager.getSubscription()))).catch(() => {});
    b.addEventListener('click', async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const cur = await reg.pushManager.getSubscription();
        if (cur) {
          const r = await ask({ title: 'Avisos en este móvil', help: 'Están activados: te llega un aviso cuando algo te necesita o termina.', ok: 'Enviar un aviso de prueba',
            fields: [{ name: 'baja', label: 'Desactivarlos en este móvil', type: 'checkbox' }] });
          if (!r) return;
          if (r.baja) { await api.cmd('aviso.baja', { endpoint: cur.endpoint }); await cur.unsubscribe(); pintar(false); toast('Avisos desactivados en este móvil', 'ok'); return; }
          const x = await api.cmd('aviso.probar', {});
          toast(x?.ok ? x.data.mensaje : x?.error || 'No se pudo', x?.ok ? 'ok' : 'bad');
          return;
        }
        if (await Notification.requestPermission() !== 'granted') { toast('El navegador no ha dado permiso para avisos', 'bad'); return; }
        const k = await api.cmd('aviso.clave', {});
        if (!k?.ok) { toast(k?.error || 'El PC no responde', 'bad'); return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(k.data.clave.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) });
        const r = await api.cmd('aviso.suscribir', { suscripcion: sub.toJSON(), dispositivo: navigator.userAgentData?.platform || navigator.platform || 'móvil' });
        if (!r?.ok) { await sub.unsubscribe(); toast(r?.error || 'No se pudo activar', 'bad'); return; }
        pintar(true);
        toast('Avisos activados: te llegará uno cuando algo te necesite o termine', 'ok');
      } catch (e) { toast(`Avisos: ${e.message}`, 'bad'); }
    });
  }

  // Android/Chrome: «Instalar CEOPadre» discreto, sólo cuando el navegador lo ofrece y si no está ya instalada.
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#b-install').hidden = standalone(); });
  window.addEventListener('appinstalled', () => { deferred = null; $('#b-install').hidden = true; });
  $('#b-install').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    $('#b-install').hidden = true;
  });
}

// Informe del día y ajuste de cuota: en el PC y en el móvil (pwa() sólo corre en el móvil).
function ajustesUi() {
  ceoUi();
  // Altura REAL de la cabecera fija (cambia con el ancho, el zoom o el texto): lo que se queda fijo debajo y los saltos a
  // una sección se apartan exactamente eso, para que la barra nunca tape títulos ni botones.
  const ab = $('#appbar');
  const medir = () => document.documentElement.style.setProperty('--appbar-h', `${Math.ceil(ab.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(medir).observe(ab); else addEventListener('resize', medir);
  medir();
  // `api` existe cuando start() termina de conectar (PC o Supabase): se espera a él.
  const listo = () => (api ? Promise.resolve() : new Promise((ok) => setTimeout(() => ok(listo()), 300)));
  $('#b-informe').addEventListener('click', () => openInforme(24));
  $('#b-conex').addEventListener('click', () => listo().then(() => openConexiones()));
  if (new URLSearchParams(location.search).has('informe')) listo().then(() => openInforme(24)); // desde el aviso diario
  // AJUSTE «reanudar tras la cuota» (PC y móvil: es una orden más).
  {
    const b = $('#b-cuota');
    const pintar = (on) => { b.textContent = on ? '🔁 Reanudar tras cuota: SÍ' : '🔁 Reanudar tras cuota: NO'; };
    listo().then(() => api.cmd('ajustes.ver', {})).then((x) => { if (x?.ok) pintar(x.data.reanudar_cuota); }).catch(() => {});
    b.addEventListener('click', async () => {
      const x = await api.cmd('ajustes.ver', {});
      if (!x?.ok) { toast(x?.error || 'El PC no responde', 'bad'); return; }
      const on = x.data.reanudar_cuota;
      const parados = x.data.en_espera.map((e) => `${e.proyecto}${e.no_reanuda ? ` (${e.no_reanuda})` : ''}`).join(' · ');
      const r = await ask({ title: 'Cuando se agota la cuota de Claude o Codex',
        help: `${on ? 'Ahora: lo que estaba trabajando se reanuda solo cuando vuelve la cuota (un intento cada vez que el proveedor dice que hay cuota; nunca reintentos seguidos). Lo pausado, lo terminado y lo que espera tu decisión no se toca.' : 'Ahora: lo que se para por cuota espera a que pulses CONTINUAR.'}${parados ? ` En espera de cuota: ${parados}.` : ''}`,
        ok: on ? 'Esperar a que yo pulse CONTINUAR' : 'Reanudar solo cuando vuelva' });
      if (!r) return;
      const g = await api.cmd('ajustes.guardar', { reanudar_cuota: !on });
      if (g?.ok) pintar(g.data.reanudar_cuota);
      toast(g?.ok ? g.data.mensaje : g?.error || 'No se pudo', g?.ok ? 'ok' : 'bad');
    });
  }

}
ajustesUi();
pwa();
start();
