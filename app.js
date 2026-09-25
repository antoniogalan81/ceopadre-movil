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
    async state() { const r = await call('/api/state'); return { proyectos: r.data.proyectos, pc: { online: true }, remoto: r.data.remoto }; },
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
  let pc = null;
  const online = () => !!pc && Date.now() - Date.parse(pc.visto_en) < ONLINE_MS;
  return {
    sb,
    async state() {
      const [c, p] = await Promise.all([sb.from('ceo_card').select('datos,posicion').order('posicion'), sb.from('ceo_pc').select('*').maybeSingle()]);
      if (c.error) throw new Error(c.error.message);
      pc = p.data;
      return { proyectos: c.data.map((r) => r.datos), pc: { online: online(), visto: pc?.visto_en } };
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
  SIN_ACTIVIDAD: ['🟠', 'SIN ACTIVIDAD', 'warn'], BLOQUEADO: ['🔴', 'BLOQUEADO', 'bad'], ERROR: ['🔴', 'ERROR', 'bad'],
  TERMINADO: ['✅', 'TERMINADO', 'ok'], CANCELADO: ['⚪', 'CANCELADO', 'idle'],
};
const OPEN = ['LIBRE', 'TERMINADO', 'CANCELADO'];

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

const actions = {
  pause: (c, b) => run('trabajo.pausar', { trabajo: c.trabajo }, 'Pausado', b),
  resume: (c, b) => run('trabajo.reanudar', { trabajo: c.trabajo }, 'Reanudado', b),
  async cancel(c, b) {
    const ok = await ask({ title: `¿Cancelar ${c.nombre}?`, help: 'Se detiene este objetivo y sus procesos. No se borra ni se revierte nada del proyecto; el historial se conserva.', ok: 'Sí, cancelar', danger: true });
    if (ok) run('trabajo.cancelar', { trabajo: c.trabajo, confirmar: true }, 'Cancelado', b);
  },
  async instruct(c, b) {
    const r = await ask({ title: 'Dar instrucción', help: `${c.nombre}: Codex la leerá antes de su siguiente decisión. No cambia el objetivo.`,
      fields: [{ name: 'texto', label: 'Instrucción', type: 'textarea', placeholder: 'Ej.: Recuerda que Macarena puede trabajar 4 horas menos.' }], ok: 'Enviar' });
    if (r?.texto) run('trabajo.instruccion', { trabajo: c.trabajo, texto: r.texto }, 'Instrucción entregada', b);
  },
  approve: (c, b) => run('trabajo.aprobar', { trabajo: c.trabajo }, 'Aprobado', b),
  reject: (c, b) => run('trabajo.rechazar', { trabajo: c.trabajo }, 'Rechazado', b),
  async goal(c, b) {
    const r = await ask({ title: `Nuevo objetivo · ${c.nombre}`, help: 'Escríbelo como se lo dirías a alguien. Codex prepara el trabajo y Claude lo ejecuta.',
      fields: [{ name: 'texto', label: 'Objetivo', type: 'textarea', placeholder: 'Ej.: Sigue creando turnos partidos cuando la empleada tiene NO. Corrígelo.' }], ok: 'Iniciar' });
    if (r?.texto) run('objetivo.iniciar', { proyecto: c.id, texto: r.texto }, 'Objetivo iniciado', b);
  },
  details: (c) => { openId = c.id; paintDetail(true); show('p-detail'); window.scrollTo(0, 0); },
};

function buttonsFor(c) {
  const B = (label, act, cls = '') => h('button', { class: `btn ${cls}`, onclick: (e) => actions[act](c, e.currentTarget) }, label);
  const e = c.estado;
  if (OPEN.includes(e)) return [B('NUEVO OBJETIVO', 'goal', 'primary'), e === 'TERMINADO' ? B('DAR INSTRUCCIÓN', 'instruct') : null, B('DETALLES', 'details', 'ghost')];
  if (e === 'ESPERANDO_DECISION') return [B('CANCELAR', 'cancel', 'ghost-danger'), B('DETALLES', 'details', 'ghost')];
  const main = e === 'TRABAJANDO' || e === 'EN_COLA' ? B('PAUSAR', 'pause')
    : B(e === 'PAUSADO' ? 'REANUDAR' : 'REINTENTAR', 'resume', 'primary');
  return [main, B('CANCELAR', 'cancel', 'ghost-danger'), e !== 'EN_COLA' ? B('DAR INSTRUCCIÓN', 'instruct') : null, B('DETALLES', 'details', 'ghost')];
}

function block(label, text, cls = '') {
  return h('div', { class: `blk ${cls}` }, h('span', { class: 'blk-label' }, label), h('p', {}, text || '—'));
}

function card(c) {
  const [icon, label, tone] = STATES[c.estado] || ['⚪', c.estado, 'idle'];
  const decision = c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' },
    block('PROPUESTA', c.propuesta), block('RECOMENDACIÓN CEO', c.recomendacion),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: (e) => actions.approve(c, e.currentTarget) }, 'APROBAR'),
      h('button', { class: 'btn', onclick: (e) => actions.reject(c, e.currentTarget) }, 'RECHAZAR'),
      h('button', { class: 'btn ghost', onclick: (e) => actions.instruct(c, e.currentTarget) }, 'DAR OTRA INSTRUCCIÓN'))) : null;
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  return h('article', { class: `card tone-${tone}`, 'data-id': c.id },
    h('header', { class: 'card-head' },
      h('h3', {}, c.nombre),
      h('span', { class: `pill tone-${tone}` }, h('span', { 'aria-hidden': 'true' }, icon), ` ${label}`)),
    c.estado === 'LIBRE' ? h('p', { class: 'muted' }, 'Sin objetivos todavía.') : [
      block('OBJETIVO', c.objetivo, 'goal'),
      block('AHORA', c.ahora),
      block('SIGUIENTE', c.siguiente),
      c.detalle && !running ? h('p', { class: 'note' }, c.detalle) : null,
      c.detalle && c.estado === 'SIN_ACTIVIDAD' ? h('p', { class: 'note' }, c.detalle) : null,
      h('dl', { class: 'meta' },
        h('div', {}, h('dt', {}, 'Última actividad'), h('dd', { 'data-ago': c.ultima_actividad || c.updated_at }, ago(c.ultima_actividad || c.updated_at))),
        h('div', {}, h('dt', {}, 'Ronda'), h('dd', {}, String(c.ronda ?? 0))),
        running && c.actividad ? h('div', {}, h('dt', {}, 'Ahora mismo'), h('dd', {}, c.actividad)) : null,
        c.cola ? h('div', {}, h('dt', {}, 'En cola'), h('dd', {}, String(c.cola))) : null),
    ],
    decision,
    h('div', { class: 'actions' }, buttonsFor(c)));
}

function paintList() {
  const line = $('#pc-line');
  line.hidden = LOCAL || data.pc.online;
  if (!line.hidden) line.textContent = data.pc.visto ? `El PC no está conectado (visto ${ago(data.pc.visto)}). Ves el último estado conocido; las órdenes no se envían.` : 'Aún no se ha visto el PC.';
  const box = $('#cards');
  const active = document.activeElement?.closest?.('.card')?.dataset.id;
  box.replaceChildren(...data.proyectos.map(card));
  if (active) box.querySelector(`[data-id="${CSS.escape(active)}"] .btn`)?.focus({ preventScroll: true });
  $('#empty').hidden = data.proyectos.length > 0;
}

// ------------------------------------------------------------------ detalles

let detailCache = null;
async function paintDetail(force) {
  const c = data.proyectos.find((p) => p.id === openId);
  if (!c) { openId = null; show('p-list'); return; }
  $('#d-name').textContent = c.nombre;
  if (force || !detailCache || detailCache.id !== openId || Date.now() - detailCache.at > 4000) {
    detailCache = { id: openId, at: Date.now(), d: await api.details(openId) };
  }
  const d = detailCache.d || {};
  const m = d.metricas;
  const body = $('#d-body');
  const wasOpen = new Set([...body.querySelectorAll('details[open]')].map((x) => x.dataset.k));
  body.replaceChildren(
    card(c),
    h('section', { class: 'panel' }, h('h4', {}, 'Proyecto'), h('p', { class: 'mono' }, d.proyecto?.ruta || c.ruta),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost-danger small', onclick: (e) => unlink(c, e.currentTarget) }, 'Desvincular proyecto'))),
    d.ceo ? h('section', { class: 'panel' }, h('h4', {}, `CEO ACTUAL: ${d.ceo.actual}`),
      d.ceo.motivo ? h('ul', { class: 'kv' }, h('li', {}, `Motivo: ${d.ceo.motivo}`),
        d.ceo.vuelve ? h('li', {}, `${d.ceo.modo === 'AUTO' ? 'Codex' : 'Se'} vuelve a probarse: ${when(d.ceo.vuelve)}`) : null) : null) : null,
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

$('#d-back').addEventListener('click', () => { openId = null; show('p-list'); });
async function unlink(c, btn) {
  const ok = await ask({ title: `¿Desvincular ${c.nombre}?`, ok: 'Sí, desvincular', danger: true,
    help: 'CEOPadre dejará de mostrar este proyecto. NO se borra la carpeta, ni Git, ni ningún archivo, y el historial se conserva. Podrás volver a vincularlo cuando quieras.' });
  if (ok && await run('proyecto.desvincular', { proyecto: c.id, confirmar: true }, 'Proyecto desvinculado', btn)) { openId = null; show('p-list'); }
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
    h('div', { class: 'cand-text' }, h('b', {}, x.nombre), h('small', { class: 'mono' }, x.ruta)),
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
