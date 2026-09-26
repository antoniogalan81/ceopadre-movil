// CEOPadre en el navegador. En el PC habla con la API local; en el móvil, con Supabase.
// No ejecuta nada: pinta el estado y deja órdenes. Todo el texto se inserta como texto (nunca HTML).
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const $ = (s) => document.querySelector(s);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

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
      return { proyectos: r.data.proyectos, pc: { online: true }, remoto: r.data.remoto, cuenta: r.data.remoto?.cuenta || '' };
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
  const ONLINE_MS = 60_000;
  let pc = null, cuenta = null;
  const logos = new Map(); // id → { hash, data }
  const online = () => !!pc && Date.now() - Date.parse(pc.visto_en) < ONLINE_MS;
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
      return { proyectos, pc: { online: online(), visto: pc?.visto_en }, cuenta };
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
  LIBRE: ['⚪', 'SIN OBJETIVO', 'idle'], EN_COLA: ['⏳', 'EN COLA', 'idle'], TRABAJANDO: ['🟢', 'TRABAJANDO', 'work'],
  ESPERANDO_DECISION: ['🟡', 'ESPERANDO DECISIÓN', 'ask'], PAUSADO: ['⏸️', 'PAUSADO', 'idle'],
  ESPERANDO_CLAUDE: ['⏳', 'ESPERANDO CLAUDE', 'warn'], ESPERANDO_CEO: ['⏳', 'ESPERANDO CEO', 'warn'],
  SIN_ACTIVIDAD: ['🟠', 'SIN ACTIVIDAD', 'warn'], BLOQUEADO: ['🔴', 'BLOQUEADO', 'bad'], ERROR: ['🔴', 'ERROR', 'bad'],
  TERMINADO: ['✅', 'TERMINADO', 'ok'], CANCELADO: ['⚪', 'CANCELADO', 'idle'],
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

let api, data = { proyectos: [], pc: { online: true } }, openId = null, backTo = 'p-list';

let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
}

const show = (id) => { for (const s of ['p-login', 'p-list', 'p-gest', 'p-detail']) $('#' + s).hidden = s !== id; };

async function refresh() {
  try { data = await api.state(); } catch (e) { toast(`No se pudo leer: ${e.message}`, 'bad'); return; }
  paintList();
  if (openId) paintDetail();
}

async function run(op, params, okMsg, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api.cmd(op, params);
    if (r?.ok) toast(r.data?.mensaje || okMsg, 'ok'); else toast(r?.error || 'No se pudo', 'bad');
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
  async instruct(c, b) {
    const r = await ask({ title: 'Dar instrucción', help: `${c.nombre}: Codex la leerá antes de su siguiente decisión. No cambia el objetivo.`,
      fields: [{ name: 'texto', label: 'Instrucción', type: 'textarea', placeholder: 'Ej.: En la web cambia el texto del botón de contacto.' }], ok: 'Enviar' });
    if (r?.texto) run('trabajo.instruccion', { trabajo: c.trabajo, texto: r.texto }, 'Instrucción entregada', b);
  },
  approve: (c, b) => run('trabajo.aprobar', { trabajo: c.trabajo }, 'Aprobado', b),
  reject: (c, b) => run('trabajo.rechazar', { trabajo: c.trabajo }, 'Rechazado', b),
  async goal(c, b) {
    const r = await ask({ title: `Nuevo objetivo · ${c.nombre}`, help: 'Escríbelo como se lo dirías a alguien. Codex prepara el trabajo y Claude lo ejecuta.',
      fields: [{ name: 'texto', label: 'Objetivo', type: 'textarea', placeholder: 'Ej.: Sigue creando turnos partidos cuando la empleada tiene NO. Corrígelo.' }], ok: 'Iniciar' });
    if (r?.texto) run('objetivo.iniciar', { proyecto: c.id, texto: r.texto }, 'Objetivo iniciado', b);
  },
  details: (c) => { backTo = $('#p-gest').hidden ? 'p-list' : 'p-gest'; openId = c.id; paintDetail(true); show('p-detail'); window.scrollTo(0, 0); },
  unlink: (c, b) => unlink(c, b),
};

// Acción principal con texto (sólo cuando hay que decidir algo); el resto, iconos.
function buttonsFor(c) {
  const I = (icon, label, act, cls) => iconBtn(icon, label, (e) => actions[act](c, e.currentTarget), cls);
  const T = (label, act) => h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions[act](c, e.currentTarget) }, label);
  const e = c.estado;
  const info = I('info', `Detalles de ${c.nombre}`, 'details');
  const instr = I('message', 'Dar instrucción', 'instruct');
  const stop = I('stop', 'Cancelar objetivo', 'cancel', 'danger');
  if (OPEN.includes(e)) return [I('target', 'Nuevo objetivo', 'goal', 'accent'), e === 'TERMINADO' ? instr : null, info, I('unlink', 'Quitar de CEOPadre', 'unlink', 'danger')];
  if (e === 'ESPERANDO_DECISION') return [instr, stop, info];
  if (WAITING.includes(e)) return [T('CONTINUAR', 'resume'), I('pause', 'Pausar', 'pause'), instr, stop, info];
  if (e === 'TRABAJANDO' || e === 'EN_COLA') return [I('pause', 'Pausar', 'pause'), e !== 'EN_COLA' ? instr : null, stop, info];
  return [T(e === 'PAUSADO' ? 'REANUDAR' : 'REINTENTAR', 'resume'), instr, stop, info];
}

function block(label, text, cls = '') {
  return h('div', { class: `blk ${cls}` }, h('span', { class: 'blk-label' }, label), h('p', {}, text || '—'));
}
const line = (label, text, cls = '') => h('p', { class: `ln ${cls}` }, h('b', {}, label), ' ', text || '—');

/** Tarjeta compacta (lista). `full` = la misma tarjeta en DETALLES, sin recortar textos y con los datos completos. */
function card(c, full = false) {
  const [icon, label, tone] = STATES[c.estado] || ['⚪', c.estado, 'idle'];
  const decision = c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' },
    line('PROPUESTA', c.propuesta), line('RECOMIENDA', c.recomendacion),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'button', onclick: (e) => actions.approve(c, e.currentTarget) }, 'APROBAR'),
      h('button', { class: 'btn small', type: 'button', onclick: (e) => actions.reject(c, e.currentTarget) }, 'RECHAZAR'))) : null;
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  const [ahora, siguiente] = WAITING.includes(c.estado) ? waitLines(c) : [c.ahora, c.siguiente];
  const note = c.detalle && (!running || c.estado === 'SIN_ACTIVIDAD') ? h('p', { class: 'note' }, c.detalle) : null;
  return h('article', { class: `card tone-${tone}${full ? ' full' : ''}`, 'data-id': c.id },
    h('header', { class: 'card-head' },
      logo(c),
      h('div', { class: 'title' },
        h('h3', { title: c.nombre }, c.nombre),
        h('span', { class: `pill tone-${tone}` }, h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`))),
    c.estado === 'LIBRE' ? h('p', { class: 'ln muted' }, 'Sin objetivo todavía.') : [
      h('p', { class: 'ln goal', title: c.objetivo }, c.objetivo),
      line('AHORA', ahora),
      line('SIGUIENTE', siguiente, 'next'),
      full ? note : (note && ['BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'].includes(c.estado) ? note : null),
      full ? h('dl', { class: 'meta' },
        h('div', {}, h('dt', {}, 'Última actividad'), h('dd', { 'data-ago': c.ultima_actividad || c.updated_at }, ago(c.ultima_actividad || c.updated_at))),
        h('div', {}, h('dt', {}, 'Ronda'), h('dd', {}, String(c.ronda ?? 0))),
        running && c.actividad ? h('div', {}, h('dt', {}, 'Ahora mismo'), h('dd', {}, c.actividad)) : null,
        c.cola ? h('div', {}, h('dt', {}, 'En cola'), h('dd', {}, String(c.cola))) : null) : null,
    ],
    decision,
    h('div', { class: 'actions' }, buttonsFor(c)));
}

// GESTIONES: contenedor visual (no ejecuta nada). Resume cuántas hay y cómo van; al pulsarla se abren.
function gestCard(list) {
  const busy = list.filter((c) => ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado)).length;
  const attn = list.filter((c) => ['ESPERANDO_DECISION', 'BLOQUEADO', 'ERROR', ...WAITING].includes(c.estado)).length;
  const summary = [`${list.length} ${list.length === 1 ? 'gestión' : 'gestiones'}`, busy ? `${busy} trabajando` : '', attn ? `${attn} te necesita${attn > 1 ? 'n' : ''}` : ''].filter(Boolean).join(' · ');
  const open = () => { show('p-gest'); paintGest(); window.scrollTo(0, 0); };
  return h('article', { class: `card gest tone-${busy ? 'work' : attn ? 'ask' : 'idle'}`, 'data-id': 'gestiones' },
    h('header', { class: 'card-head' },
      h('span', { class: 'logo ph gest-ico', 'aria-hidden': 'true' }, svg('briefcase')),
      h('div', { class: 'title' }, h('h3', {}, 'GESTIONES'))),
    h('p', { class: 'ln' }, summary),
    h('p', { class: 'ln muted' }, 'Asuntos pequeños: Hacienda, facturas, seguros…'),
    h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: open, 'aria-label': 'Abrir GESTIONES' }, 'ABRIR')));
}

const byUse = (a, b) => String(b.usado || '').localeCompare(String(a.usado || ''));
const gestiones = () => data.proyectos.filter((c) => c.tipo === 'GESTION').sort(byUse);

function repaint(box, items) {
  const active = document.activeElement?.closest?.('.card')?.dataset.id;
  box.replaceChildren(...items);
  if (active) box.querySelector(`[data-id="${CSS.escape(active)}"] button`)?.focus({ preventScroll: true });
}

function paintList() {
  const line_ = $('#pc-line');
  line_.hidden = LOCAL || data.pc.online;
  if (!line_.hidden) line_.textContent = data.pc.visto ? `El PC no está conectado (visto ${ago(data.pc.visto)}). Ves el último estado conocido; las órdenes no se envían.` : 'Aún no se ha visto el PC.';
  $('#acct').textContent = data.cuenta ? `Cuenta: ${data.cuenta}` : '';
  // Proyectos y la tarjeta GESTIONES, por último uso (la de GESTIONES, según su gestión más reciente).
  const g = gestiones();
  const items = [...data.proyectos.filter((c) => c.tipo !== 'GESTION').map((c) => ({ usado: c.usado, el: () => card(c) })),
    { usado: g[0]?.usado || '', el: () => gestCard(g) }].sort(byUse);
  repaint($('#cards'), items.map((x) => x.el()));
  $('#empty').hidden = data.proyectos.length > 0;
  if (!$('#p-gest').hidden) paintGest();
}

function paintGest() {
  const g = gestiones();
  repaint($('#g-cards'), g.map((c) => card(c)));
  $('#g-empty').hidden = g.length > 0;
}

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

let detailCache = null;
async function paintDetail(force) {
  const c = data.proyectos.find((p) => p.id === openId);
  if (!c) { openId = null; show(backTo); return; }
  $('#d-name').textContent = c.nombre;
  if (force || !detailCache || detailCache.id !== openId || Date.now() - detailCache.at > 4000) {
    detailCache = { id: openId, at: Date.now(), d: await api.details(openId) };
  }
  const d = detailCache.d || {};
  const m = d.metricas;
  const body = $('#d-body');
  const wasOpen = new Set([...body.querySelectorAll('details[open]')].map((x) => x.dataset.k));
  body.replaceChildren(
    card(c, true),
    h('section', { class: 'panel' }, h('h4', {}, c.tipo === 'GESTION' ? 'Gestión' : 'Proyecto'), h('p', { class: 'mono' }, d.proyecto?.ruta || c.ruta),
      c.componentes?.length ? h('p', { class: 'ln' }, h('b', {}, 'COMPONENTES'), ' ', c.componentes.join(' · ')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', type: 'button', title: 'Pon logo.png (o .svg, .jpg, .webp, .ico) en la raíz de la carpeta y pulsa aquí',
          onclick: (e) => run('proyecto.logo', { proyecto: c.id }, 'Logo actualizado', e.currentTarget) }, svg('image'), ' Actualizar logo'),
        h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => unlink(c, e.currentTarget) }, svg('unlink'), ' Quitar de CEOPadre'))),
    d.ceo ? h('section', { class: 'panel' }, h('h4', {}, `CEO ACTUAL: ${d.ceo.actual}`),
      d.ceo.motivo ? h('ul', { class: 'kv' }, h('li', {}, `Motivo: ${d.ceo.motivo}`),
        d.ceo.vuelve ? h('li', {}, `${d.ceo.modo === 'AUTO' ? 'Codex' : 'Se'} vuelve a probarse: ${when(d.ceo.vuelve)}`) : null) : null,
      // Sólo lo relevante: quién está limitado y hasta cuándo (con el reloj de este dispositivo).
      h('ul', { class: 'kv' }, (d.ceo.proveedores || []).map((x) => h('li', {}, `${x.nombre.toUpperCase()}: ${future(x.hasta)
        ? `limitado (${x.motivo}) hasta aprox. ${hhmm(x.hasta)}` : 'Disponible'}`)))) : null,
    m ? h('section', { class: 'panel' }, h('h4', {}, 'Consumo de este objetivo'),
      h('ul', { class: 'kv' },
        h('li', {}, `Rondas Codex ↔ Claude: ${m.rondas}`),
        h('li', {}, `Decisiones CEO: ${m.codex.n ?? 0}${m.decisiones_por_ceo ? ` (${Object.entries(m.decisiones_por_ceo).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''} · entrada ${fmt(m.codex.ent)} car. / ${fmt(m.codex.tin)} tokens (${fmt(m.codex.tcache)} en caché) · salida ${fmt(m.codex.sal)} car. / ${fmt(m.codex.tout)} tokens`),
        h('li', {}, `Encargos a Claude: ${m.claude.n ?? 0} · prompts ${fmt(m.claude.ent)} car. · tokens salida ${fmt(m.claude.tout)}`),
        h('li', {}, `Mayor entrada al CEO: ${fmt(m.codex.max_ent)} car. · informes antiguos reenviados: ${m.codex.informes_antiguos}`),
        h('li', {}, `Intervenciones de Antonio: ${m.intervenciones_antonio}`),
        h('li', {}, `Fallos/reintentos: ${(m.codex.fallos ?? 0) + (m.claude.fallos ?? 0)}`),
        h('li', {}, `Duración: ${Math.round(m.duracion_s / 60)} min`))) : null,
    h('section', { class: 'panel' }, h('h4', {}, 'Historial de rondas'),
      ...(d.rondas?.length ? d.rondas.map(roundItem) : [h('p', { class: 'muted' }, 'Sin rondas todavía.')])),
    d.notas?.length ? h('section', { class: 'panel' }, h('h4', {}, 'Instrucciones, decisiones y avisos'),
      h('ul', { class: 'notes' }, d.notas.map((n) => h('li', {}, h('b', {}, n.kind), ' ', n.text, n.consumed ? '' : h('em', {}, ' (pendiente de leer por Codex)'))))) : null,
    d.lecciones?.length ? h('section', { class: 'panel' }, h('h4', {}, 'Lecciones'), d.lecciones.map(lessonItem)) : null,
    d.trabajos?.length > 1 ? h('section', { class: 'panel' }, h('h4', {}, 'Objetivos de este proyecto'),
      h('ul', { class: 'notes' }, d.trabajos.map((t) => h('li', {}, h('b', {}, (STATES[t.estado] || [])[1] || t.estado), ' · ', t.objetivo)))) : null,
  );
  for (const x of body.querySelectorAll('details')) if (wasOpen.has(x.dataset.k)) x.open = true;
}

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'));
const when = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function roundItem(r) {
  const list = (label, items) => (items?.length ? `${label}:\n${items.map((x) => `- ${x}`).join('\n')}` : '');
  const body = [list('Claude hizo', r.hecho), list('Claude comprobó', r.comprobado), list('SIN COMPROBAR', r.no_comprobado),
    list('Pendiente', r.pendiente), list('Problemas', r.problemas), r.cambio_de_alcance ? `Cambio de alcance: ${r.cambio_de_alcance}` : '',
    r.sin_formato ? '(Claude no devolvió el informe con formato)' : '', r.codex_decidio ? `${r.ceo || 'Codex'} decidió → ${r.codex_decidio}` : 'El CEO aún no ha decidido']
    .filter(Boolean).join('\n\n');
  const failed = String(r.estado).startsWith('FALLO');
  return h('details', { class: `round ${failed ? 'failed' : ''}`, 'data-k': `r-${r.ronda}-${r.fin}` },
    h('summary', {}, h('b', {}, `RONDA ${r.ronda} · ${r.estado}`),
      r.no_comprobado?.length ? h('em', {}, ` · sin comprobar: ${r.no_comprobado.length}`) : null, h('small', {}, ` ${ago(r.fin)}`)),
    h('pre', { class: 'prompt' }, `El CEO pidió:\n${r.codex_pidio}`),
    h('pre', {}, body));
}

function lessonItem(l) {
  const B = (label, op, extra = {}) => h('button', { class: 'btn small', onclick: (e) => run(op, { id: l.id, ...extra }, label, e.currentTarget) }, label);
  return h('div', { class: 'lesson' }, h('p', {}, l.text), h('small', { class: 'muted' }, `${l.estado} · ${l.scope}`),
    l.estado === 'candidata' ? h('div', { class: 'row' }, B('Promover al proyecto', 'leccion.promover'), B('Promover a global', 'leccion.promover', { ambito: 'global' }), B('Rechazar', 'leccion.rechazar')) : null);
}

// ------------------------------------------------------------------ arranque

$('#d-back').addEventListener('click', () => { openId = null; show(backTo); if (backTo === 'p-gest') paintGest(); });
$('#g-back').addEventListener('click', () => show('p-list'));
$('#b-create-project').addEventListener('click', (e) => createFolder('proyecto.nuevo', 'proyecto', 'E:\\ECOAPP', e.currentTarget));
$('#b-new-gest').addEventListener('click', (e) => createFolder('gestion.crear', 'gestión', 'E:\\ECOAPP\\Gestiones', e.currentTarget));
// QUITAR = desvincular. CEOPadre no tiene ninguna función que borre carpetas.
async function unlink(c, btn) {
  const ok = await ask({ title: `¿Quitar ${c.nombre} de CEOPadre?`, ok: 'Sí, quitar', danger: true,
    help: 'Se quitará de CEOPadre. La carpeta y todos sus archivos permanecerán intactos. El historial se conserva y podrás volver a vincularlo cuando quieras.' });
  if (ok && await run('proyecto.desvincular', { proyecto: c.id, confirmar: true }, 'Quitado de CEOPadre', btn) && openId) { openId = null; show(backTo); }
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
start();
