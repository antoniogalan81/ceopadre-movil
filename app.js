// CEOPadre en el navegador. En el PC habla con la API local; en el móvil, con Supabase.
// No ejecuta nada: pinta el estado y deja órdenes. Todo el texto se inserta como texto (nunca HTML).
import { gestText, mood, netStatus, office, pcOnline, priority, PROMPT_LIMIT, PROMPT_WARN, quotaView, zone } from './zones.js';
import { h } from './dom.js';
import { mapBody, mapPanel, pendingDecisions } from './map.js';

const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ transporte

function localApi() {
  const call = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { 'x-ceo': '1', 'content-type': 'application/json' } });
    return r.json();
  };
  return {
    async state() {
      const r = await call('/api/state');
      // En el PC el logo lo sirve el propio CEOPadre (la huella en la URL evita cachés viejas).
      for (const c of r.data.proyectos) c._logo = c.logo ? `/logo/${encodeURIComponent(c.id)}?h=${c.logo}` : null;
      return { proyectos: r.data.proyectos, pc: { online: true }, remoto: r.data.remoto, cuenta: r.data.remoto?.cuenta || '', cuotas: r.data.cuotas };
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
  const online = () => pcOnline(pc?.visto_en); // tiempo real contra el sello del servidor; nunca un valor guardado
  return {
    sb,
    async state() {
      const [c, p] = await Promise.all([sb.from('ceo_card').select('datos,posicion').order('posicion'), sb.from('ceo_pc').select('*').maybeSingle()]);
      if (c.error) throw new Error(c.error.message);
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
      return { proyectos, pc: { online: online(), visto: pc?.visto_en }, cuenta, cuotas: pc?.datos?.cuotas };
    },
    async details(id) { const r = await sb.from('ceo_card').select('detalle').eq('id', id).maybeSingle(); return r.data?.detalle; },
    async cmd(op, params) {
      if (!online()) return { ok: false, error: 'El PC no está conectado ahora mismo: la orden no se envía.' };
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

// ------------------------------------------------------------------ vocabulario

const STATES = {
  LIBRE: ['⚪', 'SIN OBJETIVO', 'idle'], EN_COLA: ['⏳', 'EN COLA', 'wait'], TRABAJANDO: ['🟢', 'TRABAJANDO', 'work'],
  ESPERANDO_DECISION: ['🟡', 'ESPERANDO DECISIÓN', 'ask'], PAUSADO: ['⏸️', 'PAUSADO', 'idle'],
  ESPERANDO_CLAUDE: ['⏳', 'ESPERANDO CLAUDE', 'wait'], ESPERANDO_CEO: ['⏳', 'ESPERANDO CEO', 'wait'],
  SIN_ACTIVIDAD: ['🟠', 'SIN ACTIVIDAD', 'warn'], BLOQUEADO: ['🔴', 'BLOQUEADO', 'bad'], ERROR: ['🔴', 'ERROR', 'bad'],
  LISTO: ['✅', 'LISTO · TU TURNO', 'ok'], TERMINADO: ['✅', 'TERMINADO', 'ok'], CANCELADO: ['⚪', 'CANCELADO', 'idle'],
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
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
}

const show = (id) => { for (const s of ['p-login', 'p-list', 'p-detail']) $('#' + s).hidden = s !== id; };

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
  $('#dlg-title').textContent = title;
  $('#dlg-help').textContent = help;
  $('#dlg-help').hidden = !help;
  const box = $('#dlg-fields');
  box.textContent = '';
  for (const f of fields) {
    const input = f.type === 'textarea'
      ? h('textarea', { name: f.name, rows: 5, placeholder: f.placeholder || '', required: true })
      : h('input', { name: f.name, type: 'text', placeholder: f.placeholder || '', required: true, spellcheck: 'false' });
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
  box.querySelector('textarea,input')?.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const out = {};
      for (const f of fields) out[f.name] = box.querySelector(`[name="${f.name}"]`).value.trim();
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
};
let draft = ''; // lo último escrito y cancelado sin querer (sólo en memoria de esta pestaña)
function compose({ title, text = '', tipo = 'INSTRUCCION', sesion = 'CONTINUAR', modo = null, ok = 'Enviar', sesiones = true }) {
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
    $('#cmp-help').textContent = [v.tipo === 'DIRECTO' ? HELP.DIRECTO : v.modo ? HELP.INSTRUCCION[v.modo] : 'En AUTO la interpreta Codex; en MANUAL va tal cual a Claude.', sesiones ? HELP[v.sesion] : 'Objetivo nuevo: conversación limpia con Claude.'].join(' ');
  };
  $('#cmp-opts').replaceChildren(...[
    seg('cmp-tipo', 'TIPO', [['INSTRUCCION', 'INSTRUCCIÓN', 'Te digo lo que quiero y Codex decide el prompt'], ['DIRECTO', 'PROMPT DIRECTO', HELP.DIRECTO]], v.tipo, (x) => { v.tipo = x; paint(); }),
    sesiones ? seg('cmp-sesion', 'SESIÓN', [['CONTINUAR', 'CONTINUAR', HELP.CONTINUAR], ['NUEVA', 'NUEVA', HELP.NUEVA]], v.sesion, (x) => { v.sesion = x; paint(); }) : null,
    modo ? seg('cmp-modo', 'CEO', [['AUTO', 'AUTO', MODO_HELP.AUTO], ['MANUAL', 'MANUAL', MODO_HELP.MANUAL]], v.modo, (x) => { v.modo = x; paint(); }) : null,
  ].filter(Boolean));
  ta.value = text || draft; // editar un pendiente trae su texto; escribir uno nuevo recupera el borrador
  ta.oninput = paint;
  paint();
  dlg.returnValue = '';
  dlg.showModal();
  ta.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const texto = ta.value;
      const sent = dlg.returnValue === 'ok' && texto.trim() && texto.length <= PROMPT_LIMIT;
      if (!text) draft = sent ? '' : texto;
      resolve(sent ? { texto, ...v } : null);
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
  async cancel(c, b) {
    const ok = await ask({ title: `¿Cancelar ${c.nombre}?`, help: 'Se detiene este objetivo y sus procesos. No se borra ni se revierte nada del proyecto; el historial se conserva.', ok: 'Sí, cancelar', danger: true });
    if (ok) run('trabajo.cancelar', { trabajo: c.trabajo, confirmar: true }, 'Cancelado', b);
  },
  // Escribir (instrucción o prompt directo) sobre el objetivo actual. Con algo en marcha queda como pendiente.
  async instruct(c, b) {
    const r = await compose({ title: `Escribir · ${c.nombre}`, modo: c.modo || 'AUTO' });
    // Si el PC lo rechaza, el texto vuelve al borrador: nunca se pierde lo escrito.
    if (r && !(await run('trabajo.instruccion', { trabajo: c.trabajo, texto: r.texto, tipo: r.tipo, sesion: r.sesion, modo: r.modo }, 'Enviado', b))) draft = r.texto;
  },
  approve: (c, b) => run('trabajo.aprobar', { trabajo: c.trabajo }, 'Aprobado', b),
  reject: (c, b) => run('trabajo.rechazar', { trabajo: c.trabajo }, 'Rechazado', b),
  // Objetivo nuevo = sesión de Claude nueva y CEO AUTO por defecto.
  async goal(c, b) {
    const r = await compose({ title: `Nuevo objetivo · ${c.nombre}`, modo: 'AUTO', sesiones: false, ok: 'Iniciar' });
    if (r && !(await run('objetivo.iniciar', { proyecto: c.id, texto: r.texto, tipo: r.tipo, modo: r.modo }, 'Objetivo iniciado', b))) draft = r.texto;
  },
  details: (c) => { openId = c.id; paintDetail(true); show('p-detail'); window.scrollTo(0, 0); },
  unlink: (c, b) => unlink(c, b),
};

// Acción principal con texto (sólo cuando hay que decidir algo); el resto, iconos.
function buttonsFor(c) {
  const I = (icon, label, act, cls) => iconBtn(icon, label, (e) => actions[act](c, e.currentTarget), cls);
  const T = (label, act) => h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions[act](c, e.currentTarget) }, label);
  const e = c.estado;
  const info = I('info', `Detalles de ${c.nombre}`, 'details');
  const instr = I('message', 'Escribir instrucción o prompt', 'instruct');
  const stop = I('stop', 'Cancelar objetivo', 'cancel', 'danger');
  // LISTO: Claude entregó y espera. CONTINUAR = primer pendiente o (AUTO) que el CEO retome; en MANUAL sin nada, escribir.
  if (e === 'LISTO') return [c.modo !== 'MANUAL' || c.pendientes ? T(c.modo === 'MANUAL' ? 'ENVIAR SIGUIENTE' : 'CONTINUAR', 'resume') : null,
    instr, I('target', 'Nuevo objetivo', 'goal', 'accent'), stop, info];
  if (OPEN.includes(e)) return [I('target', 'Nuevo objetivo', 'goal', 'accent'), e === 'TERMINADO' ? instr : null, info, I('unlink', 'Quitar de CEOPadre', 'unlink', 'danger')];
  if (e === 'ESPERANDO_DECISION') return [instr, stop, info];
  if (WAITING.includes(e)) return [T('CONTINUAR', 'resume'), I('pause', 'Pausar', 'pause'), instr, stop, info];
  if (e === 'TRABAJANDO' || e === 'EN_COLA') return [I('pause', 'Pausar', 'pause'), e !== 'EN_COLA' ? instr : null, stop, info];
  return [T(e === 'PAUSADO' ? 'REANUDAR' : 'REINTENTAR', 'resume'), instr, stop, info];
}

const line = (label, text, cls = '') => h('p', { class: `ln ${cls}` }, h('b', {}, label), ' ', text || '—');

// ------------------------------------------------------------------ la oficina

// Texto del estado en los puestos (lo que Antonio lee de un vistazo).
const MOOD_LABEL = { ESPERANDO_DECISION: 'Te necesita · decidir', ERROR: 'Error · revisar', BLOQUEADO: 'Bloqueado · revisar',
  SIN_ACTIVIDAD: 'Sin actividad', TRABAJANDO: 'Trabajando', ESPERANDO_CLAUDE: 'Esperando a Claude', ESPERANDO_CEO: 'Esperando al CEO',
  EN_COLA: 'En cola', LIBRE: 'Sin objetivo', PAUSADO: 'Pausado', LISTO: 'Listo · tu turno', TERMINADO: 'Terminado', CANCELADO: 'Cancelado' };
const status = (c, text) => h('span', { class: 'status' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), text || MOOD_LABEL[c.estado] || c.estado);

/** Puesto de trabajo (EN MARCHA): qué hace, qué sigue y, si hay que decidir, la decisión a mano. */
function desk(c) {
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  const [ahora, siguiente] = WAITING.includes(c.estado) ? waitLines(c) : [running && c.actividad ? `${c.actividad} · ${c.ahora || ''}` : c.ahora, c.siguiente];
  const decision = c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' },
    line('PROPUESTA', c.propuesta), line('RECOMIENDA', c.recomendacion),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions.approve(c, e.currentTarget) }, 'APROBAR'),
      h('button', { class: 'btn small', type: 'button', onclick: (e) => actions.reject(c, e.currentTarget) }, 'RECHAZAR'))) : null;
  return h('article', { class: `desk m-${mood(c)}`, 'data-id': c.id },
    h('header', { class: 'unit-head' }, logo(c),
      h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c)),
      c.estado === 'TRABAJANDO' ? h('span', { class: 'beacon', title: 'Trabajando ahora', 'aria-hidden': 'true' }) : null),
    h('p', { class: 'ln goal', title: c.objetivo }, c.objetivo),
    line('AHORA', ahora),
    line('SIGUIENTE', siguiente, 'next'),
    c.detalle && ['BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'].includes(c.estado) ? h('p', { class: 'note' }, c.detalle) : null,
    c.pendientes ? h('p', { class: 'ln muted' }, h('b', {}, 'PENDIENTES'), ` ${c.pendientes}`) : null,
    decision,
    h('div', { class: 'actions' }, buttonsFor(c)));
}

/** Azulejo (EN ESPERA): logo, nombre, estado mínimo y las acciones de siempre. */
function tile(c) {
  return h('article', { class: `tile m-${mood(c)}`, 'data-id': c.id },
    logo(c),
    h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c)),
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

function paintList() {
  const pcl = $('#pc-line');
  pcl.hidden = LOCAL || data.pc.online || net === 'offline';
  if (!pcl.hidden) pcl.textContent = data.pc.visto ? `El PC no está conectado (visto ${ago(data.pc.visto)}). Ves el último estado conocido; las órdenes no se envían.` : 'Aún no se ha visto el PC.';
  $('#acct').textContent = data.cuenta || '';
  paintNet();
  const o = office(data.proyectos);
  const gestActive = o.gestiones.some((c) => zone(c) === 'marcha');
  const marcha = o.marcha.map(desk), espera = o.espera.map(tile);
  // GESTIONES entra en su zona según su prioridad (te necesita > trabajando > esperando), como un proyecto más.
  if (gestActive) {
    const p = o.resumen.necesita ? 0 : o.resumen.trabajando ? 1 : 2;
    const at = o.marcha.findIndex((c) => priority(c) > p);
    marcha.splice(at < 0 ? marcha.length : at, 0, gestUnit(o, true));
  } else espera.unshift(gestUnit(o, false));
  repaint($('#marcha'), marcha.filter(Boolean));
  repaint($('#espera'), espera.filter(Boolean));
  $('#n-marcha').textContent = String(o.marcha.length + (gestActive ? 1 : 0));
  $('#n-espera').textContent = String(o.espera.length + (gestActive ? 0 : 1));
  $('#marcha-empty').hidden = marcha.filter(Boolean).length > 0;
  $('#office-sum').textContent = `${o.marcha.length} en marcha · ${o.espera.length} en espera · ${o.resumen.total} ${o.resumen.total === 1 ? 'gestión' : 'gestiones'}`;
  $('#empty').hidden = data.proyectos.length > 0;
  paintQuota();
  paintDecisions();
}

// DECISIONES PENDIENTES (vista global): las preguntas que sólo contesta Antonio, agrupadas por proyecto. Sin IA: salen
// tal cual del canon de cada tarjeta. RESPONDER guarda la respuesta como decisión del canon; POSPONER la aparca 7 días.
function decisionHandlers(p) {
  return {
    async answer(d, b) {
      const r = await ask({ title: `Decidir · ${p.nombre}`, help: d.pregunta, ok: 'Guardar decisión',
        fields: [{ name: 'respuesta', label: 'Tu decisión', type: 'textarea', placeholder: 'Escribe la respuesta tal como quieres que la sigan Codex y Claude' }] });
      if (r?.respuesta) await run('decision.responder', { proyecto: p.id, id: d.id, respuesta: r.respuesta }, 'Decisión guardada', b);
    },
    postpone: (d, b) => run('decision.posponer', { proyecto: p.id, id: d.id, dias: 7 }, 'Pospuesta 7 días', b),
  };
}
function paintDecisions() {
  const box = $('#decisions');
  const withDec = data.proyectos.filter((p) => p.decisiones?.length);
  const n = withDec.reduce((a, p) => a + p.decisiones.length, 0);
  box.hidden = !n;
  if (!n) { box.replaceChildren(); return; }
  box.replaceChildren(h('details', { class: 'fold dec-global', 'data-k': 'decisiones', open: decOpen ? true : null,
    ontoggle: (e) => { decOpen = e.currentTarget.open; } },
  h('summary', {}, `DECISIONES PENDIENTES (${n})`),
  withDec.map((p) => h('section', { class: 'dec-proj' }, h('h3', {}, p.nombre), pendingDecisions(p.decisiones, decisionHandlers(p), false)))));
}
let decOpen = false;

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
      h('small', { class: 'muted' }, `Cuota de toda la cuenta (no sólo CEOPadre)${q.leida ? ` · leída ${q.leida}` : ''}`));
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
function paintMap(m, decide) {
  const box = $('#map-body'), y = box.scrollTop;
  box.replaceChildren(...mapBody(m, decide).filter(Boolean));
  box.scrollTop = y;
}

function view(title, text) {
  $('#viewer-title').textContent = title;
  $('#viewer-text').textContent = text;
  $('#viewer').showModal();
}

let detailCache = null;
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
  const decide = (id, que, b) => run(`canon.${que}`, { proyecto: c.id, id }, que === 'aprobar' ? 'Aprobado' : 'Rechazado', b);
  const openMap = () => { $('#map-title').textContent = `Mapa · ${c.nombre}`; paintMap(d.mapa, decide); $('#map').showModal(); };
  body.replaceChildren(...[summaryPanel(c, d), mapPanel(d.mapa, { open: openMap, decide, ...decisionHandlers(c) }), writePanel(c, d), roundsPanel(d), techPanel(c, d)].filter(Boolean));
  if ($('#map').open) paintMap(d.mapa, decide);
  for (const x of body.querySelectorAll('details')) if (wasOpen.has(x.dataset.k)) x.open = true;
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
    h('div', { class: 'sum-head' }, h('span', { class: `pill tone-${tone}` }, label),
      c.pendientes ? h('span', { class: 'chip' }, `Pendientes ${c.pendientes}`) : null),
    hasJob && c.estado !== 'CANCELADO' ? h('div', { class: 'sum-ceo' },
      seg(`modo-${c.trabajo}`, 'CEO', [['AUTO', 'AUTO', MODO_HELP.AUTO], ['MANUAL', 'MANUAL', MODO_HELP.MANUAL]], modo,
        (v) => run('trabajo.modo', { trabajo: c.trabajo, modo: v }, v)),
      h('small', { class: 'muted' }, MODO_HELP[modo])) : null,
    hasJob ? fold('ceo', `CEO: ${modo === 'MANUAL' ? 'Antonio' : ceo.actual || 'Codex'} · ${modo} · Sesión: ${d.sesion === 'NUEVA' ? 'nueva' : 'actual'} · Claude ejecutor: ${execText}`,
      h('ul', { class: 'kv' },
        ceo.motivo ? h('li', {}, `Motivo: ${ceo.motivo}`) : null,
        ceo.vuelve ? h('li', {}, `Codex vuelve a probarse: ${when(ceo.vuelve)}`) : null,
        (ceo.proveedores || []).map((x) => h('li', {}, `${x.nombre}: ${future(x.hasta) ? `limitado (${x.motivo}) hasta aprox. ${hhmm(x.hasta)}` : 'disponible'}`)))) : null,
    hasJob ? [
      h('p', { class: 'lbl' }, 'OBJETIVO ACTUAL'),
      h('p', { class: 'sum-goal' }, c.objetivo),
      long || (c.objetivo || '').length > 180 ? h('button', { class: 'link', type: 'button', onclick: () => openGoal(c) }, 'Ver objetivo completo') : null,
      line('AHORA', ahora), line('SIGUIENTE', siguiente, 'next'),
      c.detalle && (!running || c.estado === 'SIN_ACTIVIDAD') ? h('p', { class: 'note' }, c.detalle) : null,
    ] : h('p', { class: 'muted' }, 'Sin objetivo todavía.'),
    c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' }, line('PROPUESTA', c.propuesta), line('RECOMIENDA', c.recomendacion),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions.approve(c, e.currentTarget) }, 'APROBAR'),
        h('button', { class: 'btn small', type: 'button', onclick: (e) => actions.reject(c, e.currentTarget) }, 'RECHAZAR'))) : null,
    r ? h('div', { class: 'result' }, h('p', { class: 'lbl' }, `ÚLTIMO RESULTADO · ronda ${r.ronda} · ${r.estado}`),
      h('ul', {}, r.puntos.map((x) => h('li', { class: `r-${x.tipo}` }, h('i', { 'aria-hidden': 'true' }, MARK[x.tipo] || '·'), ' ', x.texto))),
      h('button', { class: 'link', type: 'button', onclick: () => view(`Informe completo · ronda ${r.ronda}`, r.informe) }, 'Ver informe completo')) : null,
    h('div', { class: 'actions' }, buttonsFor(c).filter((b) => b && b.getAttribute('aria-label') !== `Detalles de ${c.nombre}`)));
}

async function openGoal(c) {
  if ((c.objetivo_len || 0) <= (c.objetivo || '').length) return view('Objetivo completo', c.objetivo);
  const r = await api.cmd('trabajo.objetivo', { trabajo: c.trabajo });
  if (r?.ok) view('Objetivo completo', r.data.texto); else toast(r?.error || 'No se pudo leer el objetivo', 'bad');
}

/** Escribir + pendientes (orden de creación; sólo un extracto de cada uno). */
function writePanel(c, d) {
  const hasJob = !['LIBRE', 'CANCELADO'].includes(c.estado);
  const open = (e) => (hasJob ? actions.instruct(c, e.currentTarget) : actions.goal(c, e.currentTarget));
  const pend = d.pendientes || [];
  return h('section', { class: 'panel write' },
    h('button', { class: 'write-btn', type: 'button', onclick: open }, hasJob ? 'Escribir…' : 'Escribir un objetivo nuevo…'),
    pend.length ? [h('p', { class: 'lbl' }, `Instrucciones pendientes (${pend.length})`),
      h('ol', { class: 'pend' }, pend.map((p) => h('li', {},
        h('div', { class: 'pend-tags' }, h('span', { class: `tag ${p.tipo === 'DIRECTO' ? 'direct' : ''}` }, TIPO[p.tipo] || p.tipo),
          h('span', { class: 'tag' }, p.sesion === 'NUEVA' ? 'NUEVA SESIÓN' : 'CONTINUAR'), h('small', { class: 'muted' }, `${fmt(p.chars)} car.`)),
        h('p', { class: 'pend-text' }, p.extracto),
        h('div', { class: 'pend-act' }, iconBtn('edit', 'Editar pendiente', () => editPending(p)), iconBtn('trash', 'Eliminar pendiente', (e) => deletePending(p, e.currentTarget), 'danger')))))]
      : null);
}

async function editPending(p) {
  const r = await api.cmd('pendiente.leer', { id: p.id });
  if (!r?.ok) { toast(r?.error || 'No se pudo leer', 'bad'); return; }
  if (r.data.consumida) { toast('Ya se entregó (CONSUMIDA): no se puede editar', 'bad'); await refresh(); return; }
  const v = await compose({ title: 'Editar pendiente', text: r.data.texto, tipo: r.data.tipo, sesion: r.data.sesion, ok: 'Guardar' });
  if (v) await run('pendiente.editar', { id: p.id, texto: v.texto, tipo: v.tipo, sesion: v.sesion }, 'Pendiente actualizado');
}
async function deletePending(p, b) {
  const ok = await ask({ title: '¿Eliminar este pendiente?', help: `«${p.extracto.slice(0, 120)}${p.chars > 120 ? '…' : ''}» no se enviará.`, ok: 'Eliminar', danger: true });
  if (ok) await run('pendiente.eliminar', { id: p.id }, 'Pendiente eliminado', b);
}

/** Historial de rondas: siempre visible, cada ronda plegada. */
function roundsPanel(d) {
  return h('section', { class: 'panel' }, h('h4', {}, `Rondas (${d.rondas?.length || 0})`),
    ...(d.rondas?.length ? d.rondas.map(roundItem) : [h('p', { class: 'muted' }, 'Sin rondas todavía.')]));
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
      h('ul', { class: 'notes' }, d.trabajos.map((t) => h('li', {}, h('b', {}, (STATES[t.estado] || [])[1] || t.estado), ' · ', t.objetivo)))) : null,
    fold('proyecto', c.tipo === 'GESTION' ? 'Gestión' : 'Proyecto',
      h('p', { class: 'mono' }, d.proyecto?.ruta || c.ruta),
      c.componentes?.length ? h('p', { class: 'ln' }, h('b', {}, 'COMPONENTES'), ' ', c.componentes.join(' · ')) : null,
      h('div', { class: 'row' }, iconBtn('unlink', 'Quitar de CEOPadre', (e) => unlink(c, e.currentTarget), 'danger'))));
}

function roundItem(r) {
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
    h('pre', {}, body));
}

function lessonItem(l) {
  const B = (label, op, extra = {}) => h('button', { class: 'btn small', onclick: (e) => run(op, { id: l.id, ...extra }, label, e.currentTarget) }, label);
  return h('div', { class: 'lesson' }, h('p', {}, l.text), h('small', { class: 'muted' }, `${l.estado} · ${l.scope}`),
    l.estado === 'candidata' ? h('div', { class: 'row' }, B('Promover al proyecto', 'leccion.promover'), B('Promover a global', 'leccion.promover', { ambito: 'global' }), B('Rechazar', 'leccion.rechazar')) : null);
}

// ------------------------------------------------------------------ arranque

$('#d-back').addEventListener('click', () => { openId = null; show('p-list'); });
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
  show('p-list');
  await refresh();
  api.watch(() => void refresh());
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

pwa();
start();
