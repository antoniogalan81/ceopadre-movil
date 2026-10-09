// AUTOMATIZACIONES y BANDEJA DE APROBACIÓN en el PC y en el móvil (la misma pantalla). Pinta lo que llega en las tarjetas
// (`automatizaciones`, `bandeja`) y deja órdenes de la lista cerrada; no ejecuta nada. Todo el texto entra como texto.
import { h } from './dom.js';

// Estado de un botón: disponible · ejecutándose · esperando autorización · completada · parcial · error (y sus matices).
const STATE = {
  DISPONIBLE: ['Disponible', 'idle'], EJECUTANDO: ['Ejecutándose', 'work'], ESPERANDO_AUTORIZACION: ['Esperando tu autorización', 'ask'],
  COMPLETADA: ['Completada', 'ok'], PARCIAL: ['Completada parcialmente', 'warn'], ERROR: ['Error', 'bad'], CANCELADA: ['Cancelada', 'idle'],
  PAUSADA: ['Pausada', 'idle'], DESACTIVADA: ['Desactivada', 'idle'],
};
// Integración: lo que vio la última ejecución que la usó (nunca «conectada» sólo por estar configurada).
const INTEG = { OK: ['✓', 'ok', 'funcionó'], FALLO: ['✕', 'bad', 'falló'], NO_DISPONIBLE: ['✕', 'bad', 'no disponible'], SIN_VERIFICAR: ['?', 'idle', 'sin verificar'] };
const MSG = {
  PENDIENTE: ['Pendiente de tu aprobación', 'ask'], APROBADO: ['Aprobada · en cola de envío', 'work'], ENVIANDO: ['Enviando…', 'work'],
  ENVIADO: ['Enviada ✓', 'ok'], NO_CONFIRMADO: ['Envío sin confirmar: míralo en la conversación', 'bad'], FALLIDO: ['No se envió', 'bad'],
  BLOQUEADO: ['Bloqueada: la conversación cambió', 'warn'], RECHAZADO: ['Rechazada', 'idle'], SUSTITUIDO: ['Sustituida por otra más reciente', 'idle'],
};
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');

export function autoUi({ api, ask, toast, show, data, run, viewText, ai }) {
  let mode = null;           // 'list' | 'edit' | 'runs' | 'inbox'
  let onlyProject = null;    // lista de un solo proyecto (desde DETALLES)
  let form = null;           // editor: { id?, proyecto, nombre, … pasos[] }
  let viewing = null;        // { id, ver } (ejecuciones y versiones de una)
  let sig = '';
  const selected = new Set(); // bandeja: ids elegidos
  const projects = () => data().proyectos || [];
  const all = () => projects().flatMap((p) => (p.automatizaciones || []).map((a) => ({ ...a, proyectoNombre: p.nombre })));
  const inbox = () => projects().flatMap((p) => (p.bandeja || []).map((m) => ({ ...m, proyectoNombre: p.nombre })));
  const pending = () => inbox().filter((m) => m.estado === 'PENDIENTE');
  const online = () => data().pc?.online !== false;
  const cmd = async (op, params, okMsg, btn) => run(op, params, okMsg, btn);

  // ------------------------------------------------------------ barra superior y avisos
  function paintTop() {
    const n = inbox().filter((m) => ['PENDIENTE', 'BLOQUEADO', 'NO_CONFIRMADO', 'FALLIDO'].includes(m.estado)).length;
    const b = document.getElementById('b-autos');
    const r = document.getElementById('b-inbox');
    if (b) b.hidden = false;
    if (r) { r.hidden = !n; r.textContent = `RESPUESTAS · ${n}`; }
    // En la lista de decisiones: las respuestas que esperan a Antonio, con lo que hay que hacer (no un «te necesita» genérico).
    const box = document.getElementById('inbox-line');
    if (box) {
      const p = pending().length, other = n - p;
      box.hidden = !n;
      box.replaceChildren(...(n ? [h('p', { class: 'ln' }, h('b', {}, 'TU AUTORIZACIÓN'),
        ` ${p ? `${p} respuesta${p === 1 ? '' : 's'} preparada${p === 1 ? '' : 's'} esperan que las revises y apruebes antes de enviarse` : ''}${p && other ? ' · ' : ''}${other ? `${other} envío${other === 1 ? '' : 's'} necesita${other === 1 ? '' : 'n'} que lo mires (bloqueado, sin confirmar o fallido)` : ''}`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => openInbox() }, 'REVISAR RESPUESTAS'))] : []));
    }
  }

  // ------------------------------------------------------------ pantallas
  function openList(projectId = null) { mode = 'list'; onlyProject = projectId; sig = ''; paint(true); show('p-autos'); window.scrollTo(0, 0); }
  function openInbox() { mode = 'inbox'; sig = ''; paint(true); show('p-bandeja'); window.scrollTo(0, 0); }
  async function openEditor(a = null, projectId = null) {
    if (a) {
      const r = await api.cmd('automatizacion.ver', { id: a.id });
      if (!r?.ok) { toast(r?.error || 'No se pudo abrir', 'bad'); return; }
      form = { id: a.id, proyecto: a.proyecto, ...r.data.actual, pasos: (r.data.actual.pasos || []).map((p) => ({ ...p })) };
    } else form = { proyecto: projectId || onlyProject || projects()[0]?.id, nombre: '', descripcion: '', procedimiento: '', pasos: [], integraciones: [], recursos: [], modo: 'AUTO', prueba: '', siguiente: null };
    mode = 'edit'; paint(true); show('p-autos'); window.scrollTo(0, 0);
  }
  async function openRuns(a) {
    const r = await api.cmd('automatizacion.ver', { id: a.id });
    if (!r?.ok) { toast(r?.error || 'No se pudo abrir', 'bad'); return; }
    viewing = { id: a.id, ver: r.data }; mode = 'runs'; paint(true); show('p-autos'); window.scrollTo(0, 0);
  }
  function back() {
    if (mode === 'edit' || mode === 'runs') { mode = 'list'; form = null; viewing = null; paint(true); return; }
    mode = null; show('p-list');
  }

  // ------------------------------------------------------------ un botón
  function integrations(a) {
    const xs = Object.entries(a.integraciones || {});
    if (!xs.length) return null;
    return h('p', { class: 'a-ints' }, xs.map(([k, v]) => {
      const [ico, tone, label] = INTEG[v.estado] || INTEG.SIN_VERIFICAR;
      return h('span', { class: `a-int t-${tone}`, title: `${k}: ${label}${v.at ? ` (${fecha(v.at)})` : ''}${v.detalle ? ` · ${v.detalle}` : ''}` }, `${ico} ${k}`);
    }));
  }
  function counters(res) {
    const xs = Object.entries(res?.contadores || {});
    return xs.length ? h('div', { class: 'a-count' }, xs.map(([k, v]) => h('div', {}, h('b', {}, String(v)), h('small', {}, k.replaceAll('_', ' '))))) : null;
  }
  function lastLine(a) {
    const u = a.ultima;
    if (!u) return h('p', { class: 'ln muted' }, 'Nunca se ha ejecutado.');
    if (u.estado === 'EJECUTANDO' || u.estado === 'ESPERANDO_AUTORIZACION' || u.estado === 'PAUSADA') {
      return h('p', { class: 'ln' }, h('b', {}, 'AHORA'), ` ${u.texto || ''}${u.progreso ? ` · ${u.progreso}` : ''}${u.propuesta ? ` · ${u.propuesta}` : ''}`);
    }
    return h('p', { class: 'ln' }, h('b', {}, 'ÚLTIMA'), ` ${fecha(u.fin || u.inicio)} · ${STATE[u.estado]?.[0] || u.estado}${u.prueba ? ' (prueba)' : ''}${u.resultado?.resumen ? ` · ${u.resultado.resumen}` : u.error ? ` · ${u.error}` : u.detalle ? ` · ${u.detalle}` : ''}`);
  }
  function actionsFor(a) {
    const u = a.ultima;
    const running = u && ['EJECUTANDO', 'ESPERANDO_AUTORIZACION', 'PAUSADA'].includes(u.estado) && !u.fin;
    const out = [];
    if (running && u.detalle) out.push(h('button', { class: 'btn primary small', type: 'button', onclick: (e) => cmd('automatizacion.reanudar', { ejecucion: u.id }, 'Reanudada', e.currentTarget) }, 'REANUDAR'));
    if (running) out.push(h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => cancel(a, u, e.currentTarget) }, 'Cancelar'));
    else {
      out.push(h('button', { class: 'btn primary a-run', type: 'button', disabled: !a.activa || !online(), onclick: (e) => execute(a, false, e.currentTarget) }, '▶ EJECUTAR'));
      if (u && ['ERROR', 'PARCIAL', 'CANCELADA'].includes(u.estado)) out.push(h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => retry(a, u, e.currentTarget) }, 'Reintentar'));
    }
    out.push(h('button', { class: 'btn ghost small', type: 'button', onclick: () => openRuns(a) }, 'Historial'));
    out.push(h('details', { class: 'a-more' }, h('summary', { class: 'btn ghost small' }, 'Más'), h('div', { class: 'a-menu' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => openEditor(a) }, 'Editar'),
      h('button', { class: 'btn ghost small', type: 'button', disabled: running || !a.activa, onclick: (e) => execute(a, true, e.currentTarget) }, 'Ejecutar en prueba'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => duplicate(a, e.currentTarget) }, 'Duplicar'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => cmd('automatizacion.activar', { id: a.id, activa: !a.activa }, 'Hecho', e.currentTarget) }, a.activa ? 'Desactivar' : 'Activar'),
      h('button', { class: 'btn ghost-danger small', type: 'button', disabled: running, onclick: (e) => archive(a, e.currentTarget) }, 'Archivar'))));
    return out;
  }
  function card(a) {
    const [label, tone] = STATE[a.estado] || [a.estado, 'idle'];
    const u = a.ultima;
    return h('article', { class: `a-card t-${tone}`, 'data-id': `auto-${a.id}` },
      h('header', {}, h('h3', {}, a.nombre), chip(label, tone)),
      a.descripcion ? h('p', { class: 'a-desc' }, a.descripcion) : null,
      lastLine(a),
      u?.aprobaciones ? h('p', { class: 'ln' }, h('b', {}, 'TU AUTORIZACIÓN'), ` ${u.aprobaciones} respuesta${u.aprobaciones === 1 ? '' : 's'} esperan tu aprobación `,
        h('button', { class: 'btn ghost small', type: 'button', onclick: openInbox }, 'Revisar')) : null,
      u?.resultado?.pendientes?.length ? h('ul', { class: 'a-pend' }, u.resultado.pendientes.slice(0, 4).map((x) => h('li', {}, x))) : null,
      counters(u?.resultado),
      integrations(a),
      h('p', { class: 'a-meta muted' }, [`v${a.version}`, a.modo === 'DIRECTO' ? 'Claude directo' : 'Codex dirige', a.pasos ? `${a.pasos} paso${a.pasos === 1 ? '' : 's'}` : null,
        a.verificada ? `última verificada ${fecha(a.verificada.at)}${a.verificada.prueba ? ' (prueba)' : ''}` : 'ninguna ejecución verificada'].filter(Boolean).join(' · ')),
      h('div', { class: 'a-acts' }, actionsFor(a)));
  }

  async function execute(a, prueba, btn) {
    if (!online()) { toast('El PC no está conectado: la orden no se envía.', 'bad'); return; }
    const ok = await ask({ title: `${prueba ? 'Probar' : 'Ejecutar'} «${a.nombre}»`, ok: prueba ? 'Ejecutar en prueba' : 'Ejecutar',
      help: `${a.proyectoNombre || ''}: se lanza en el PC (${a.modo === 'DIRECTO' ? 'Claude' : 'Codex dirige a Claude'}).${prueba ? ' MODO PRUEBA: sin tocar datos reales.' : ''} Verás el progreso aquí; nada se envía a terceros sin tu aprobación.` });
    if (ok) await cmd('automatizacion.ejecutar', { id: a.id, confirmado: true, prueba }, 'Lanzada', btn);
  }
  async function cancel(a, u, btn) {
    const ok = await ask({ title: `¿Cancelar «${a.nombre}»?`, ok: 'Sí, cancelar', danger: true, help: 'Se detiene la ejecución en curso. No se revierte nada de lo ya hecho.' });
    if (ok) await cmd('automatizacion.cancelar', { ejecucion: u.id, confirmado: true }, 'Cancelada', btn);
  }
  async function retry(a, u, btn) {
    const ok = await ask({ title: `Reintentar «${a.nombre}»`, ok: 'Reintentar', help: 'Ejecución nueva que continúa desde el resultado de la anterior, sin repetir lo ya hecho y verificado.' });
    if (ok) await cmd('automatizacion.reintentar', { ejecucion: u.id }, 'Lanzada', btn);
  }
  async function duplicate(a, btn) {
    const r = await ask({ title: `Duplicar «${a.nombre}»`, ok: 'Duplicar', help: 'La copia es independiente: edítala para adaptarla.',
      fields: [{ name: 'proyecto', label: 'En el proyecto', type: 'choice', options: projects().map((p) => ({ value: p.id, label: p.nombre })) }, { name: 'nombre', label: 'Nombre (opcional)', required: false }] });
    if (r) await cmd('automatizacion.duplicar', { id: a.id, proyecto: r.proyecto, nombre: r.nombre || undefined }, 'Duplicada', btn);
  }
  async function archive(a, btn) {
    const ok = await ask({ title: `¿Archivar «${a.nombre}»?`, ok: 'Archivar', danger: true, help: 'Deja de ofrecerse. Sus versiones y ejecuciones se conservan.' });
    if (ok) await cmd('automatizacion.archivar', { id: a.id, confirmado: true }, 'Archivada', btn);
  }

  function list() {
    const ps = projects().filter((p) => !onlyProject || p.id === onlyProject);
    const groups = ps.map((p) => [p, (p.automatizaciones || []).map((a) => ({ ...a, proyectoNombre: p.nombre }))]).filter(([p, xs]) => xs.length || p.id === onlyProject);
    return [h('div', { class: 'a-top' }, h('button', { class: 'btn accent', type: 'button', onclick: () => openEditor(null, onlyProject) }, '+ Nueva automatización'),
      onlyProject ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => openList(null) }, 'Ver todos los proyectos') : null,
      inbox().length ? h('button', { class: 'btn ghost small', type: 'button', onclick: openInbox }, `Respuestas por aprobar · ${pending().length}`) : null),
    groups.length ? groups.map(([p, xs]) => h('section', { class: 'a-group' }, h('div', { class: 'zone-head' }, h('h2', {}, p.nombre), h('span', { class: 'count' }, String(xs.length))),
      xs.length ? h('div', { class: 'a-cards' }, xs.map(card)) : h('p', { class: 'empty' }, 'Este proyecto aún no tiene botones.')))
      : h('p', { class: 'empty' }, 'Todavía no hay automatizaciones. Crea la primera con «+ Nueva automatización».')];
  }

  // ------------------------------------------------------------ historial de una automatización
  function runItem(r) {
    const [label, tone] = STATE[r.estado] || [r.estado, 'idle'];
    const res = r.resultado;
    return h('article', { class: `a-runrow t-${tone}` },
      h('header', {}, h('b', {}, `${fecha(r.inicio)}${r.fin ? ` → ${fecha(r.fin)}` : ''}`), chip(label, tone),
        h('small', { class: 'muted' }, `v${r.version} · ${r.origen}${r.prueba ? ' · prueba' : ''}${r.reintento_de ? ' · reintento' : ''}`)),
      r.texto ? h('p', { class: 'ln' }, `${r.texto}${r.progreso ? ` · ${r.progreso}` : ''}`) : null,
      res?.resumen ? h('p', { class: 'a-desc' }, res.resumen) : null,
      r.error ? h('p', { class: 'note' }, r.error) : null,
      counters(res),
      res?.integraciones && Object.keys(res.integraciones).length ? h('ul', { class: 'a-pend' }, Object.entries(res.integraciones).map(([k, v]) => h('li', {}, `${k}: ${v.estado}${v.detalle ? ` · ${v.detalle}` : ''}`))) : null,
      res?.pendientes?.length ? [h('p', { class: 'ln' }, h('b', {}, 'REQUIERE TU INTERVENCIÓN')), h('ul', { class: 'a-pend' }, res.pendientes.map((x) => h('li', {}, x)))] : null,
      res?.errores?.length ? [h('p', { class: 'ln' }, h('b', {}, 'ERRORES')), h('ul', { class: 'a-pend' }, res.errores.map((x) => h('li', {}, x)))] : null,
      h('div', { class: 'a-acts' }, r.trabajo ? h('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const x = await api.cmd('ronda.informe', { trabajo: r.trabajo }); if (x?.ok) viewText(`Informe · ${fecha(r.inicio)}`, x.data.texto); else toast(x?.error || 'Sin informe', 'bad'); } finally { e.currentTarget.disabled = false; }
      } }, 'Informe completo') : null,
      !['EJECUTANDO', 'ESPERANDO_AUTORIZACION', 'PAUSADA'].includes(r.estado) && r.estado !== 'COMPLETADA'
        ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => cmd('automatizacion.reintentar', { ejecucion: r.id }, 'Lanzada', e.currentTarget) }, 'Reintentar') : null));
  }
  function runsView() {
    const v = viewing.ver;
    return [h('section', { class: 'panel' }, h('h4', {}, `Versión vigente · v${v.actual.version}`),
      h('p', { class: 'a-desc' }, v.actual.descripcion || ''),
      h('details', { class: 'fold' }, h('summary', {}, 'Procedimiento completo'), h('pre', { class: 'viewer-text' }, v.actual.procedimiento)),
      v.actual.pasos?.length ? h('ol', { class: 'a-steps' }, v.actual.pasos.map((p) => h('li', {}, h('b', {}, p.titulo), p.revision ? ' · revisión humana' : '', p.si ? ` · sólo si ${p.si}` : ''))) : null,
      h('div', { class: 'a-acts' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => openEditor({ id: v.id, proyecto: v.proyecto }) }, 'Editar'))),
    h('section', { class: 'panel' }, h('h4', {}, 'Ejecuciones'), v.ejecuciones.length ? v.ejecuciones.map(runItem) : h('p', { class: 'muted' }, 'Ninguna todavía.')),
    h('section', { class: 'panel' }, h('h4', {}, 'Versiones'), h('ul', { class: 'a-pend' }, v.versiones.map((x) => h('li', {}, `v${x.version} · ${fecha(x.created_at)} · ${x.autor}${x.nota ? ` · ${x.nota}` : ''}`))))];
  }

  // ------------------------------------------------------------ editor (crear / editar sin programar)
  function editor() {
    const f = form;
    const field = (label, el, help) => h('label', { class: 'field' }, label, el, help ? h('small', { class: 'muted' }, help) : null);
    const input = (k, attrs = {}) => { const el = h('input', { type: 'text', spellcheck: 'false', ...attrs }); el.value = f[k] ?? ''; el.addEventListener('input', () => { f[k] = el.value; }); return el; };
    const area = (k, rows, attrs = {}) => { const el = h('textarea', { rows, ...attrs }); el.value = f[k] ?? ''; el.addEventListener('input', () => { f[k] = el.value; }); return el; };
    const listInput = (k) => { const el = h('input', { type: 'text', spellcheck: 'false' }); el.value = (f[k] || []).join(', '); el.addEventListener('input', () => { f[k] = el.value.split(',').map((x) => x.trim()).filter(Boolean); }); return el; };
    const projSel = h('select', { disabled: !!f.id }, projects().map((p) => h('option', { value: p.id }, p.nombre)));
    projSel.value = f.proyecto;
    projSel.addEventListener('change', () => { f.proyecto = projSel.value; f.siguiente = null; paint(true); });
    const modo = h('select', {}, h('option', { value: 'AUTO' }, 'Codex dirige a Claude y exige evidencia (recomendado)'), h('option', { value: 'DIRECTO' }, 'Claude directo, sin CEO (más rápido)'));
    modo.value = f.modo || 'AUTO';
    modo.addEventListener('change', () => { f.modo = modo.value; });
    const others = (projects().find((p) => p.id === f.proyecto)?.automatizaciones || []).filter((a) => a.id !== f.id);
    const next = h('select', {}, h('option', { value: '' }, 'Nada'), others.map((a) => h('option', { value: a.id }, a.nombre)));
    next.value = f.siguiente || '';
    next.addEventListener('change', () => { f.siguiente = next.value || null; });
    const steps = h('ol', { class: 'a-steps edit' }, (f.pasos || []).map((p, i) => {
      const t = h('input', { type: 'text', placeholder: 'Título del paso' }); t.value = p.titulo || ''; t.addEventListener('input', () => { p.titulo = t.value; });
      const x = h('textarea', { rows: 3, placeholder: 'Qué hay que hacer en este paso' }); x.value = p.texto || ''; x.addEventListener('input', () => { p.texto = x.value; });
      const si = h('input', { type: 'text', placeholder: 'Sólo si… (opcional)' }); si.value = p.si || ''; si.addEventListener('input', () => { p.si = si.value; });
      const rev = h('input', { type: 'checkbox' }); rev.checked = !!p.revision; rev.addEventListener('change', () => { p.revision = rev.checked; });
      const ret = h('select', {}, [0, 1, 2, 3].map((n) => h('option', { value: String(n) }, n ? `${n} reintento${n > 1 ? 's' : ''}` : 'sin reintentos'))); ret.value = String(p.reintentos || 0);
      ret.addEventListener('change', () => { p.reintentos = Number(ret.value); });
      const move = (d) => { const j = i + d; if (j < 0 || j >= f.pasos.length) return; [f.pasos[i], f.pasos[j]] = [f.pasos[j], f.pasos[i]]; paint(true); };
      return h('li', { class: 'a-step' }, t, x, si, h('div', { class: 'a-acts' }, h('label', { class: 'check' }, rev, ' Revisión humana (para y te pregunta)'), ret,
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Subir paso', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Bajar paso', onclick: () => move(1) }, '↓'),
        h('button', { class: 'btn ghost-danger small', type: 'button', onclick: () => { f.pasos.splice(i, 1); paint(true); } }, 'Quitar')));
    }));
    const save = h('button', { class: 'btn primary big', type: 'button', onclick: async (e) => {
      const payload = { ...(f.id ? { id: f.id } : { proyecto: f.proyecto }), nombre: f.nombre, descripcion: f.descripcion, procedimiento: f.procedimiento,
        pasos: (f.pasos || []).filter((p) => (p.titulo || '').trim()), integraciones: f.integraciones, recursos: f.recursos, modo: f.modo, prueba: f.prueba, siguiente: f.siguiente };
      if (await cmd('automatizacion.guardar', payload, 'Guardada', e.currentTarget)) { mode = 'list'; form = null; paint(true); }
    } }, f.id ? `Guardar versión ${(f.version || 0) + 1}` : 'Crear automatización');
    return [h('section', { class: 'panel a-form' },
      field('Proyecto', projSel),
      field('Nombre del botón', input('nombre', { maxlength: 60, placeholder: 'RECOGER FACTURAS' })),
      field('Descripción', area('descripcion', 2, { maxlength: 600, placeholder: 'Qué hace, en una o dos frases' })),
      field('Procedimiento completo', area('procedimiento', 12, { placeholder: 'Las instrucciones completas, como las escribirías a Claude. Se guardan y se usan cada vez que pulses el botón.' }),
        'Las reglas fijas de CEOPadre van siempre delante (nada se envía a terceros sin tu aprobación, sin datos inventados, sin duplicados) y el texto no puede quitarlas.'),
      h('p', { class: 'field-label' }, 'Pasos (opcional, en orden)'), steps,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { (f.pasos ||= []).push({ titulo: '', texto: '', revision: false, si: '', reintentos: 0 }); paint(true); } }, '+ Añadir paso'),
      field('Quién lo ejecuta', modo),
      field('Integraciones que usa', listInput('integraciones'), 'Separadas por comas: gmail, drive, sheets, whatsapp, wechat… Cada ejecución dice si funcionaron.'),
      field('Recursos exclusivos', listInput('recursos'), 'Lo que no pueden usar dos automatizaciones a la vez (p. ej. wechat-ui, contabilidad).'),
      field('Instrucciones en modo prueba', area('prueba', 3, { placeholder: 'Cómo ejecutarla sin tocar datos reales (carpeta aislada, sin escribir en hojas reales…)' })),
      field('Al completarse, ejecutar también', next)), save];
  }

  // ------------------------------------------------------------ bandeja de aprobación
  async function edit(m, btn) {
    const r = await ask({ title: `Editar respuesta a ${m.contacto}`, ok: 'Guardar', fields: [{ name: 'texto', label: 'Respuesta', type: 'textarea', value: m.texto }] });
    if (r) await cmd('bandeja.editar', { id: m.id, texto: r.texto }, 'Editada', btn);
  }
  async function original(m, btn) {
    btn.disabled = true;
    try {
      const r = await api.cmd('bandeja.leer', { id: m.id });
      if (!r?.ok) { toast(r?.error || 'No se pudo leer', 'bad'); return; }
      const d = r.data;
      viewText(`${d.contacto} · conversación`, [`MENSAJE RECIBIDO\n${d.recibido_texto || d.recibido || '(sin texto)'}`, d.conversacion ? `Conversación: ${d.conversacion}` : '',
        d.texto !== d.propuesta ? `PROPUESTA ORIGINAL DE LA IA\n${d.propuesta}` : '', d.notas ? `NOTAS\n${d.notas}` : '',
        `HISTORIAL\n${d.eventos.map((e) => `${fecha(e.at)} · ${e.tipo} · ${e.origen || ''}`).join('\n')}`, d.evidencia ? `EVIDENCIA DEL ENVÍO\n${d.evidencia}` : ''].filter(Boolean).join('\n\n'));
    } finally { btn.disabled = false; }
  }
  async function approve(ms, btn) {
    if (!ms.length) { toast('Elige al menos una respuesta', 'bad'); return; }
    const ok = await ask({ title: ms.length === 1 ? `¿Enviar a ${ms[0].contacto}?` : `¿Enviar ${ms.length} respuestas?`, ok: ms.length === 1 ? 'Aprobar y enviar' : `Enviar las ${ms.length}`,
      help: `${ms.map((m) => `• ${m.contacto}: «${m.texto.length > 140 ? `${m.texto.slice(0, 140)}…` : m.texto}»`).join('\n')}\n\nSe envían desde el PC exactamente estos textos, uno a uno. Si una conversación cambió, ése se bloquea y vuelve a revisión.` });
    if (!ok) return;
    const items = await Promise.all(ms.map(async (m) => ({ id: m.id, huella_texto: await sha256(m.texto) })));
    btn && (btn.disabled = true);
    try {
      const r = await api.cmd('bandeja.aprobar', { confirmado: true, items });
      if (!r?.ok) { toast(r?.error || 'No se pudo', 'bad'); return; }
      const bad = r.data.resultados.filter((x) => !x.ok);
      toast(bad.length ? `${r.data.mensaje}: ${bad.map((x) => `#${x.id} ${x.error}`).join(' · ')}` : r.data.mensaje, bad.length ? 'bad' : 'ok');
      for (const x of r.data.resultados) if (x.ok) selected.delete(x.id);
    } finally { if (btn) btn.disabled = false; }
    paint(true);
  }
  async function reject(ms, btn) {
    const r = await ask({ title: ms.length === 1 ? `Rechazar la respuesta a ${ms[0].contacto}` : `Rechazar ${ms.length} respuestas`, ok: 'Rechazar', danger: true,
      fields: [{ name: 'motivo', label: 'Motivo (opcional)', type: 'textarea', required: false }] });
    if (r && await cmd('bandeja.rechazar', { ids: ms.map((m) => m.id), motivo: r.motivo }, 'Rechazada', btn)) for (const m of ms) selected.delete(m.id);
  }
  function message(m) {
    const [label, tone] = MSG[m.estado] || [m.estado, 'idle'];
    const box = h('input', { type: 'checkbox', 'aria-label': `Seleccionar respuesta a ${m.contacto}`, disabled: m.estado !== 'PENDIENTE' });
    box.checked = selected.has(m.id);
    box.addEventListener('change', () => { if (box.checked) selected.add(m.id); else selected.delete(m.id); paintBar(); });
    const acts = {
      PENDIENTE: [h('button', { class: 'btn primary small', type: 'button', onclick: (e) => approve([m], e.currentTarget) }, 'APROBAR Y ENVIAR'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => edit(m, e.currentTarget) }, 'EDITAR'),
        h('button', { class: 'btn accent small', type: 'button', onclick: () => ai?.open({ tipo: 'bandeja', id: m.id }) }, 'EDITAR CON IA'),
        h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => reject([m], e.currentTarget) }, 'RECHAZAR')],
      BLOQUEADO: [h('button', { class: 'btn primary small', type: 'button', onclick: (e) => cmd('bandeja.revisar', { id: m.id }, 'Vuelve a revisión', e.currentTarget) }, 'Revisar de nuevo'),
        h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => reject([m], e.currentTarget) }, 'Rechazar')],
      FALLIDO: [h('button', { class: 'btn primary small', type: 'button', onclick: (e) => cmd('bandeja.reintentar', { id: m.id }, 'En cola', e.currentTarget) }, 'Reintentar envío'),
        h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => reject([m], e.currentTarget) }, 'Rechazar')],
      NO_CONFIRMADO: [h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => cmd('bandeja.resolver', { id: m.id, enviado: true }, 'Marcada como enviada', e.currentTarget) }, 'Sí salió'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => cmd('bandeja.resolver', { id: m.id, enviado: false }, 'Vuelve a la bandeja', e.currentTarget) }, 'No salió')],
      // Aprobada pero aún en cola: editarla (a mano o con IA) anula esa aprobación y vuelve a pedirla.
      APROBADO: [h('button', { class: 'btn accent small', type: 'button', onclick: () => ai?.open({ tipo: 'bandeja', id: m.id }) }, 'EDITAR CON IA')],
    }[m.estado] || [];
    return h('article', { class: `a-msg t-${tone}`, 'data-id': `msg-${m.id}` },
      h('header', {}, h('label', { class: 'a-sel' }, box, h('b', {}, m.contacto)), chip(label, tone)),
      h('p', { class: 'a-meta muted' }, [m.proyectoNombre, m.canal, fecha(m.creado), m.editada ? 'editada por ti' : 'propuesta por la IA'].filter(Boolean).join(' · ')),
      h('p', { class: 'ln' }, h('b', {}, 'RECIBIDO'), ` ${m.recibido || '—'}`),
      h('div', { class: 'a-reply' }, h('b', {}, 'RESPUESTA PROPUESTA'), h('p', { class: 'r-text' }, m.texto)),
      m.motivo ? h('p', { class: 'note' }, m.motivo) : null,
      h('div', { class: 'a-acts' }, acts, h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => original(m, e.currentTarget) }, 'Ver original e historial')));
  }
  let bar = null;
  function paintBar() {
    if (!bar) return;
    const sel = pending().filter((m) => selected.has(m.id));
    bar.replaceChildren(h('button', { class: 'btn ghost small', type: 'button', onclick: () => { const all2 = pending(); const on = all2.every((m) => selected.has(m.id)); for (const m of all2) if (on) selected.delete(m.id); else selected.add(m.id); paint(true); } },
      pending().length && pending().every((m) => selected.has(m.id)) ? 'Quitar selección' : `Seleccionar todos los pendientes (${pending().length})`),
    h('button', { class: 'btn primary small', type: 'button', disabled: !sel.length || !online(), onclick: (e) => approve(sel, e.currentTarget) }, `Revisar y enviar seleccionados (${sel.length})`),
    h('button', { class: 'btn ghost-danger small', type: 'button', disabled: !sel.length, onclick: (e) => reject(sel, e.currentTarget) }, 'Rechazar seleccionados'));
  }
  function inboxView() {
    const xs = inbox();
    for (const id of [...selected]) if (!xs.some((m) => m.id === id && m.estado === 'PENDIENTE')) selected.delete(id);
    bar = h('div', { class: 'a-bar' });
    paintBar();
    const order = ['PENDIENTE', 'BLOQUEADO', 'NO_CONFIRMADO', 'FALLIDO', 'APROBADO', 'ENVIANDO'];
    const sorted = [...xs].sort((a, b) => order.indexOf(a.estado) - order.indexOf(b.estado) || String(a.creado).localeCompare(String(b.creado)));
    return [!online() ? h('p', { class: 'pcline' }, 'El PC no está conectado: puedes revisar, pero no aprobar ni enviar hasta que vuelva.') : null,
      xs.length ? bar : null,
      xs.length ? sorted.map(message) : h('p', { class: 'empty' }, 'No hay respuestas esperando. Cuando una automatización prepare respuestas, aparecerán aquí.')];
  }

  // ------------------------------------------------------------ pintar
  function paint(force = false) {
    paintTop();
    if (!mode) return;
    const t = document.getElementById(mode === 'inbox' ? 'bi-title' : 'a-title');
    if (mode === 'inbox') {
      // No se repinta con un diálogo abierto (se perdería lo que se escribe) ni si nada cambió.
      const s = JSON.stringify(inbox().map((m) => [m.id, m.estado, m.texto, m.motivo])) + online();
      if (!force && (s === sig || document.querySelector('dialog[open]'))) return;
      sig = s;
      t.textContent = 'Respuestas por aprobar';
      document.getElementById('bi-sub').textContent = `${pending().length} pendiente${pending().length === 1 ? '' : 's'} · ${online() ? 'PC conectado' : 'PC desconectado'}`;
      document.getElementById('bi-body').replaceChildren(...inboxView().flat(Infinity).filter(Boolean));
      return;
    }
    // El editor sólo se pinta al abrirlo o al cambiar su estructura: el refresco periódico no borra lo que se escribe.
    if (mode === 'edit' && !force) return;
    if (mode === 'runs' && !force) return;
    if (mode === 'list') {
      const s = JSON.stringify(all().map((a) => [a.id, a.estado, a.activa, a.version, a.ultima?.id, a.ultima?.estado, a.ultima?.progreso, a.ultima?.aprobaciones, a.integraciones])) + onlyProject + online() + inbox().length;
      if (!force && (s === sig || document.querySelector('dialog[open], details.a-more[open]'))) return;
      sig = s;
    }
    const p = onlyProject && projects().find((x) => x.id === onlyProject);
    t.textContent = mode === 'edit' ? (form.id ? 'Editar automatización' : 'Nueva automatización') : mode === 'runs' ? viewing.ver.nombre : `Automatizaciones${p ? ` · ${p.nombre}` : ''}`;
    document.getElementById('a-sub').textContent = mode === 'list' ? `${all().length} botón${all().length === 1 ? '' : 'es'} · ${online() ? 'PC conectado' : 'PC desconectado'}` : '';
    document.getElementById('a-body').replaceChildren(...(mode === 'edit' ? editor() : mode === 'runs' ? runsView() : list()).flat(Infinity).filter(Boolean));
  }

  document.getElementById('a-back').addEventListener('click', back);
  document.getElementById('bi-back').addEventListener('click', () => { mode = null; show('p-list'); });
  document.getElementById('b-autos')?.addEventListener('click', () => openList(null));
  document.getElementById('b-inbox')?.addEventListener('click', openInbox);
  return { paint, openList, openInbox, isOpen: () => !!mode, projectPanel };

  /** En DETALLES de un proyecto: sus botones y lo que espera aprobación (acceso directo desde la ficha). */
  function projectPanel(c) {
    const xs = (c.automatizaciones || []).map((a) => ({ ...a, proyectoNombre: c.nombre }));
    const n = (c.bandeja || []).filter((m) => m.estado === 'PENDIENTE').length;
    return h('section', { class: 'panel' }, h('h4', {}, 'Automatizaciones'),
      xs.length ? h('div', { class: 'a-cards compact' }, xs.map(card)) : h('p', { class: 'muted' }, 'Sin botones todavía.'),
      n ? h('p', { class: 'ln' }, h('b', {}, 'TU AUTORIZACIÓN'), ` ${n} respuesta${n === 1 ? '' : 's'} esperan aprobación `, h('button', { class: 'btn ghost small', type: 'button', onclick: openInbox }, 'Revisar')) : null,
      h('div', { class: 'a-acts' }, h('button', { class: 'btn accent small', type: 'button', onclick: () => openEditor(null, c.id) }, '+ Nueva automatización'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => openList(c.id) }, 'Abrir AUTOMATIZACIONES')));
  }
}
