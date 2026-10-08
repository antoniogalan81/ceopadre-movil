// CEOPadre en el navegador. En el PC habla con la API local; en el móvil, con Supabase.
// No ejecuta nada: pinta el estado y deja órdenes. Todo el texto se inserta como texto (nunca HTML).
import { conditionsText, decisionCount, decisionsText, gestText, HIGH_RISK, mood, needsDecision, netStatus, office, passwordAt, pcOnline, priority, PROMPT_LIMIT, PROMPT_WARN, quotaView, REAUTH_MS, waitingConditions, zone } from './zones.js';
import { h } from './dom.js';
import { advice, decideRow, mapBody, mapPanel, pendingDecisions, proposals } from './map.js';
import { remoteUi } from './remoto.js';

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
      // MANDO REMOTO: sólo en el móvil. En el PC está el propio panel de cada proyecto (no se duplica aquí).
      return { proyectos: r.data.proyectos, pc: { online: true }, remoto: r.data.remoto, cuenta: r.data.remoto?.cuenta || '', cuotas: r.data.cuotas, remotos: [] };
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
      return { proyectos, pc: { online: online(), visto: pc?.visto_en }, cuenta, cuotas: pc?.datos?.cuotas, remotos };
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
  const r = await ask({ title: 'Confirmar orden a Claude', ok: 'Enviar al PC',
    help: `Vas a enviar texto libre a Claude en «${where}». Claude puede ejecutar código en tu PC.${fresh ? '' : ' Por seguridad, escribe tu contraseña (como mucho una vez cada 30 min).'}`,
    fields: fresh ? [] : [{ name: 'password', type: 'password', label: 'Contraseña de CEOPadre' }] });
  if (!r) return null;
  if (fresh) return { ok: true, token: s.access_token };
  const { data: d, error } = await sb.auth.signInWithPassword({ email: s.user.email, password: r.password });
  if (error) return { ok: false, error: `Contraseña no válida: no se ha enviado nada (${error.message})` };
  return { ok: true, token: d.session.access_token };
}

// ------------------------------------------------------------------ vocabulario

const STATES = {
  LIBRE: ['⚪', 'SIN OBJETIVO', 'idle'], EN_COLA: ['⏳', 'EN COLA', 'wait'], TRABAJANDO: ['🟢', 'TRABAJANDO', 'work'],
  ESPERANDO_DECISION: ['🟡', 'ESPERANDO DECISIÓN', 'ask'], PAUSADO: ['⏸️', 'PAUSADO', 'idle'],
  ESPERANDO_CLAUDE: ['⏳', 'ESPERANDO CLAUDE', 'wait'], ESPERANDO_CEO: ['⏳', 'ESPERANDO CEO', 'wait'],
  ESPERANDO_CONDICION: ['🔭', 'ESPERANDO CONDICIÓN · MONITORIZADO', 'wait'],
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
  // Con un diálogo modal abierto, el aviso vive dentro de él: si no, quedaría tapado por el fondo.
  const host = document.querySelector('dialog[open]') || document.body;
  if (t.parentElement !== host) host.append(t);
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
}

const show = (id) => { for (const s of ['p-login', 'p-list', 'p-detail', 'p-remote']) $('#' + s).hidden = s !== id; };
let rui = null; // MANDO REMOTO (web/remoto.js)

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
    if (f.type === 'checkbox') { box.append(h('label', { class: 'check' }, h('input', { name: f.name, type: 'checkbox' }), ' ', f.label)); continue; }
    const required = f.required !== false;
    // choice: una opción de una lista cerrada (p. ej. TikTok / Instagram), ya elegida si sólo hay una.
    if (f.type === 'choice') {
      box.append(h('label', { class: 'field' }, f.label, h('select', { name: f.name, required },
        (f.options || []).length > 1 ? h('option', { value: '' }, 'Elige…') : null, (f.options || []).map((o) => h('option', { value: o.value }, o.label)))));
      continue;
    }
    const input = f.type === 'textarea'
      ? h('textarea', { name: f.name, rows: 5, placeholder: f.placeholder || '', required })
      : f.type === 'password' ? h('input', { name: f.name, type: 'password', autocomplete: 'current-password', required })
      : h('input', { name: f.name, type: f.type === 'url' ? 'url' : 'text', inputmode: f.type === 'url' ? 'url' : null, placeholder: f.placeholder || '', required, spellcheck: 'false' });
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
      if (dlg.returnValue !== 'ok') return resolve(null);
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
    await run('trabajo.aprobar', { trabajo: c.trabajo }, 'Aprobado', b);
  },
  reject: (c, b) => run('trabajo.rechazar', { trabajo: c.trabajo }, 'Rechazado', b),
  // ? PREGUNTAR A CODEX: sólo una recomendación (llega a la tarjeta en segundos). No aprueba ni rechaza nada.
  consult: (c, ref, b) => run('decision.consultar', { proyecto: c.id, ref }, 'Codex lo está analizando…', b),
  // Objetivo nuevo = sesión de Claude nueva y CEO AUTO por defecto.
  async goal(c, b) {
    const r = await compose({ title: `Nuevo objetivo · ${c.nombre}`, modo: 'AUTO', sesiones: false, ok: 'Iniciar', trabajo: c.trabajo });
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
  const add = I('plus', 'Añadir al objetivo en curso', 'add', 'accent');
  const stop = I('stop', 'Cancelar objetivo', 'cancel', 'danger');
  // LISTO: Claude entregó y espera. CONTINUAR = primer pendiente o (AUTO) que el CEO retome; en MANUAL sin nada, escribir.
  if (e === 'LISTO') return [c.modo !== 'MANUAL' || c.pendientes || c.anadidos ? T(c.modo === 'MANUAL' ? 'ENVIAR SIGUIENTE' : 'CONTINUAR', 'resume') : null,
    add, instr, I('target', 'Nuevo objetivo', 'goal', 'accent'), stop, info];
  // Esperando una condición: no ocupa el hueco; se puede empezar otro objetivo, reactivarlo ya o añadirle algo.
  if (e === 'ESPERANDO_CONDICION') return [I('target', 'Nuevo objetivo', 'goal', 'accent'), I('play', 'Reactivar ahora', 'resume'), add, stop, info];
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
  return [line('QUÉ CAMBIA', x.propuesta), rec ? line('RECOMIENDO', rec) : null,
    opts ? h('details', { class: 'prop-more', 'data-k': `opts-${x.trabajo}` }, h('summary', {}, 'Opciones'), h('p', { class: 'ln' }, opts)) : null];
};
/** La decisión del objetivo (ESPERANDO_DECISION): qué cambia, recomendación de Codex si la hay y ✓ ✕ ?. Igual en todas partes. */
const jobDecision = (c) => (c.estado === 'ESPERANDO_DECISION' ? h('div', { class: 'decision' }, ...decisionLines(c), advice(c.consejo),
  decideRow({ yes: (e) => actions.approve(c, e.currentTarget), no: (e) => actions.reject(c, e.currentTarget),
    ask: c.ref ? (e) => actions.consult(c, c.ref, e.currentTarget) : null,
    yesLabel: esGasto(c) ? 'Sí, autorizo este gasto' : 'Aprobar', noLabel: esGasto(c) ? 'No autorizo este gasto' : 'Rechazar' })) : null);

// ------------------------------------------------------------------ la oficina

// Texto del estado en los puestos (lo que Antonio lee de un vistazo).
const MOOD_LABEL = { ESPERANDO_DECISION: 'Te necesita · decidir', ERROR: 'Error · revisar', BLOQUEADO: 'Bloqueado · revisar',
  SIN_ACTIVIDAD: 'Sin actividad', TRABAJANDO: 'Trabajando', ESPERANDO_CLAUDE: 'Esperando a Claude', ESPERANDO_CEO: 'Esperando al CEO',
  ESPERANDO_CONDICION: 'Esperando condición · monitorizado', EN_COLA: 'En cola', LIBRE: 'Sin objetivo', PAUSADO: 'Pausado', LISTO: 'Listo · tu turno', TERMINADO: 'Terminado', CANCELADO: 'Cancelado' };
// Una decisión pendiente de Antonio (del objetivo o del canon) manda sobre cualquier otro estado.
const decisionLabel = (c) => { const n = decisionCount(c); return n > 1 ? `ESPERANDO TU DECISIÓN · ${n}` : 'ESPERANDO TU DECISIÓN'; };
const status = (c, text) => h('span', { class: 'status' }, h('i', { class: 'dot', 'aria-hidden': 'true' }),
  text || (needsDecision(c) ? decisionLabel(c) : MOOD_LABEL[c.estado] || c.estado));

/** Decisiones del canon (preguntas y cambios protegidos) en el puesto: cuántas, estado real del objetivo y a decidirlas. */
function canonDecisionLine(c) {
  const n = (c.decisiones?.length || 0) + (c.propuestas?.length || 0);
  if (!n) return null;
  return h('div', { class: 'decision' },
    h('p', { class: 'ln' }, h('b', {}, 'TE NECESITA'), ` ${n} ${n === 1 ? 'decisión pendiente' : 'decisiones pendientes'}`,
      c.estado !== 'ESPERANDO_DECISION' && c.estado !== 'LIBRE' ? ` · el objetivo sigue: ${MOOD_LABEL[c.estado] || c.estado}` : ''),
    h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => openDecisions(c.id) }, 'DECIDIR')));
}

/** Puesto de trabajo (EN MARCHA): qué hace, qué sigue y, si hay que decidir, la decisión a mano. */
function desk(c) {
  const running = ['TRABAJANDO', 'SIN_ACTIVIDAD'].includes(c.estado);
  const [ahora, siguiente] = WAITING.includes(c.estado) ? waitLines(c) : [running && c.actividad ? `${c.actividad} · ${c.ahora || ''}` : c.ahora, c.siguiente];
  const decision = jobDecision(c);
  return h('article', { class: `desk m-${mood(c)}`, 'data-id': c.id },
    h('header', { class: 'unit-head' }, logo(c),
      h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c)),
      c.estado === 'TRABAJANDO' ? h('span', { class: 'beacon', title: 'Trabajando ahora', 'aria-hidden': 'true' }) : null),
    h('p', { class: 'ln goal', title: c.objetivo }, c.objetivo),
    line('AHORA', ahora),
    line('SIGUIENTE', siguiente, 'next'),
    c.detalle && ['BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'].includes(c.estado) ? h('p', { class: 'note' }, c.detalle) : null,
    c.pendientes ? h('p', { class: 'ln muted' }, h('b', {}, 'PENDIENTES'), ` ${c.pendientes}`) : null,
    c.anadidos ? h('p', { class: 'ln muted' }, h('b', {}, 'AÑADIDO'), ` ${c.anadidos} sin incorporar todavía`) : null,
    esperandoLine(c),
    decision,
    canonDecisionLine(c),
    h('div', { class: 'actions' }, buttonsFor(c)));
}

/** Otros objetivos del proyecto que esperan una condición (monitorizados, sin ocupar el hueco). */
const esperandoLine = (c) => (c.esperando?.length ? h('p', { class: 'ln muted', title: c.esperando.map((x) => x.condicion).join(' · ') },
  h('b', {}, 'MONITORIZADO'), ` ${c.esperando.length} objetivo${c.esperando.length === 1 ? '' : 's'} esperando una condición`) : null);

/** Azulejo (EN ESPERA): logo, nombre, estado mínimo y las acciones de siempre (y, si espera, qué espera). */
function tile(c) {
  return h('article', { class: `tile m-${mood(c)}`, 'data-id': c.id },
    logo(c),
    h('div', { class: 'title' }, h('h3', { title: c.nombre }, c.nombre), status(c),
      c.estado === 'ESPERANDO_CONDICION' && c.condicion ? h('small', { class: 'muted cond', title: c.condicion }, c.condicion) : null),
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
  paintConditions();
  rui?.paintCards($('#remotes'));
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
  const n = list.length;
  const estado = (x) => [x.principal ? 'Monitorizado' : `Otro objetivo del proyecto · el proyecto: ${MOOD_LABEL[x.estado] || x.estado}`,
    x.decide ? 'además te necesita (decisión pendiente)' : ''].filter(Boolean).join(' · ');
  $('#conds').replaceChildren(h('details', { class: 'fold cond-global', open: condOpen ? true : null,
    ontoggle: (e) => { condOpen = e.currentTarget.open; } },
  h('summary', {}, `🔭 CONDICIONES EN ESPERA · ${n}`),
  n ? h('div', { class: 'cond-body' },
    h('div', { class: 'cond-top' }, h('button', { class: 'btn primary small', type: 'button', onclick: (e) => copyCond(conditionsText(list), e.currentTarget) }, 'COPIAR TODAS')),
    list.map((x) => h('section', { class: 'cond-item', 'data-cond': `${x.id}:${x.trabajo}` },
      h('h3', {}, x.proyecto),
      h('p', { class: 'cond-text' }, x.condicion),
      h('p', { class: 'cond-meta muted' }, estado(x)),
      x.principal ? null : h('p', { class: 'cond-meta cond-goal muted', title: x.objetivo }, h('b', {}, 'OBJETIVO'), ` ${x.objetivo}`),
      h('button', { class: 'btn small', type: 'button', 'aria-label': `Copiar la condición de ${x.proyecto}`, onclick: (e) => copyCond(x.condicion, e.currentTarget) }, 'COPIAR'))))
    : h('p', { class: 'muted cond-empty' }, 'Ningún proyecto está esperando una condición ahora mismo.')));
}

// DECISIONES PENDIENTES (vista global): las preguntas que sólo contesta Antonio, agrupadas por proyecto. Sin IA: salen
// tal cual del canon de cada tarjeta. RESPONDER guarda la respuesta como decisión del canon; POSPONER la aparca 7 días.
function decisionHandlers(p) {
  return {
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
  const sig = JSON.stringify(withDec.map((p) => [p.id, p.nombre, p.estado, p.trabajo, p.propuesta, p.recomendacion, p.consejo, p.propuestas, p.decisiones]));
  if (sig === decSig) return;
  decSig = sig;
  if (!n) { box.replaceChildren(); return; }
  const wasOpen = new Set([...box.querySelectorAll('details[open]')].map((x) => x.dataset.k));
  box.replaceChildren(
    h('button', { class: 'icon-btn dec-copy', type: 'button', 'aria-label': `Copiar las ${n} decisiones pendientes`, title: 'Copiar todas las decisiones (para pegarlas en ChatGPT)',
      onclick: (e) => copyDecisions(e.currentTarget) }, h('span', { 'aria-hidden': 'true' }, '⧉')),
    h('details', { class: 'fold dec-global', 'data-k': 'decisiones', open: decOpen ? true : null, ontoggle: (e) => { decOpen = e.currentTarget.open; } },
      h('summary', {}, `⚠ ${n} ${n === 1 ? 'DECISIÓN PENDIENTE' : 'DECISIONES PENDIENTES'} · te ${n === 1 ? 'necesita' : 'necesitan'}`),
      withDec.map((p) => h('section', { class: 'dec-proj', 'data-dec': p.id }, h('h3', {}, p.nombre),
        jobDecision(p),
        proposals(p, (id, que, b) => run(`canon.${que}`, { proyecto: p.id, id }, que === 'aprobar' ? 'Aprobado' : 'Rechazado', b), (ref, b) => actions.consult(p, ref, b)),
        pendingDecisions(p.decisiones, decisionHandlers(p), false)))));
  for (const x of box.querySelectorAll('details')) if (wasOpen.has(x.dataset.k)) x.open = true;
}

/** DECIDIR en un puesto: abre el aviso global y lleva al proyecto. */
function openDecisions(id) {
  decOpen = true;
  const d = $('#decisions details');
  if (d) d.open = true;
  ($(`#decisions [data-dec="${CSS.escape(id)}"]`) || $('#decisions'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const consult = (ref, b) => actions.consult(c, ref, b);
  const openMap = () => { $('#map-title').textContent = `Mapa · ${c.nombre}`; paintMap(d.mapa, decide, consult); $('#map').showModal(); };
  body.replaceChildren(...[summaryPanel(c, d), esperasPanel(c, d), mapPanel(d.mapa, { open: openMap, decide, ...decisionHandlers(c) }), writePanel(c, d), roundsPanel(d), techPanel(c, d)].filter(Boolean));
  if ($('#map').open) paintMap(d.mapa, decide, consult);
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
    h('div', { class: 'sum-head' }, h('span', { class: `pill tone-${needsDecision(c) ? 'ask' : tone}` }, needsDecision(c) ? decisionLabel(c) : label),
      c.pendientes ? h('span', { class: 'chip' }, `Pendientes ${c.pendientes}`) : null,
      c.anadidos ? h('span', { class: 'chip' }, `Añadidos sin incorporar ${c.anadidos}`) : null),
    hasJob && c.estado !== 'CANCELADO' ? h('div', { class: 'sum-ceo' },
      seg(`modo-${c.trabajo}`, 'CEO', [['AUTO', 'AUTO', MODO_HELP.AUTO], ['MANUAL', 'MANUAL', MODO_HELP.MANUAL]], modo,
        (v) => run('trabajo.modo', { trabajo: c.trabajo, modo: v }, v)),
      h('small', { class: 'muted' }, MODO_HELP[modo])) : null,
    hasJob ? fold('ceo', `CEO: ${modo === 'MANUAL' ? 'Antonio' : ceo.actual || 'Codex'} · ${modo} · Sesión: ${d.sesion === 'NUEVA' ? 'nueva' : 'actual'} · Claude ejecutor: ${execText}`,
      h('ul', { class: 'kv' },
        ceo.motivo ? h('li', {}, `Motivo: ${ceo.motivo}`) : null,
        ceo.vuelve ? h('li', {}, `Codex vuelve a probarse: ${when(ceo.vuelve)}`) : null,
        (ceo.proveedores || []).map((x) => h('li', {}, `${x.nombre}: ${future(x.hasta) ? `limitado (${x.motivo}) hasta aprox. ${hhmm(x.hasta)}` : 'disponible'}`)))) : null,
    autonomiaFold(d.autonomia),
    hasJob ? diagnosticoFold(d.diagnostico) : null,
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
    h('div', { class: 'actions' }, buttonsFor(c).filter((b) => b && b.getAttribute('aria-label') !== `Detalles de ${c.nombre}`)));
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
  return fold('autonomia', `Autonomía desde V2.7: ${x.dudas_resueltas_ceo ?? '—'} dudas resueltas por el CEO · ${x.dudas_escaladas_antonio ?? '—'} escaladas a ti · ${x.intervenciones_por_objetivo ?? '—'} intervenciones/objetivo`,
    h('ul', { class: 'kv' },
      fila('objetivos', 'Objetivos'), fila('terminados', 'Terminados'), fila('dudas_resueltas_ceo', 'Dudas resueltas por el CEO'),
      fila('dudas_escaladas_antonio', 'Dudas escaladas a ti'), fila('pct_terminados_sin_antonio', 'Terminados sin intervenir tú'),
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
  return h('section', { class: 'panel waits m-wait' }, h('h4', {}, `Esperando una condición (${list.length})`),
    list.map((x) => h('div', { class: 'wait-item' },
      h('p', { class: 'ln goal', title: x.objetivo }, x.objetivo),
      x.esperas.filter((e) => e.estado === 'ACTIVA').map((e) => h('div', { class: 'wait-cond' },
        line(e.interna ? 'SIGUE SOLO (interna)' : 'ESPERA', e.descripcion),
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
  return h('section', { class: 'panel' }, h('h4', {}, `Rondas (${d.rondas?.length || 0})`),
    ...(d.rondas?.length ? d.rondas.map((r) => roundItem(r, d.trabajo?.trabajo)) : [h('p', { class: 'muted' }, 'Sin rondas todavía.')]));
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
  rui ??= LOCAL ? null : remoteUi({ api, ask, toast, show, data: () => data, ago });
  show('p-list');
  await refresh();
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
