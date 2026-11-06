// OBJETIVOS DE NEGOCIO en el PC y en el móvil (la misma pantalla). Pinta lo que devuelven las órdenes negocio.* y deja
// órdenes de la lista cerrada; no decide nada. Separa siempre lo HECHO (trabajos) de lo CONSEGUIDO (indicadores medidos).
// Sin porcentajes ni estimaciones: sólo valores medidos, con su fecha, y su objetivo.
import { h } from './dom.js';

const TONE = { DEFINIENDO: 'work', ESPERANDO_APROBACION: 'ask', ACTIVA: 'work', ESPERANDO_ANTONIO: 'ask', PAUSADA: 'idle', ALCANZADA: 'ok', BLOQUEADA: 'bad', CANCELADA: 'idle' };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);

export function negocioUi({ api, ask, toast, show, data, run, viewText }) {
  let mode = null, list = [], viewing = null, sig = '', timer = null;
  const projects = () => data().proyectos || [];
  const online = () => data().pc?.online !== false;
  const cmd = (op, params, okMsg, btn) => run(op, params, okMsg, btn);

  async function load() {
    const r = await api.cmd('negocio.lista', {});
    if (r?.ok) list = r.data.objetivos;
    if (viewing) { const v = await api.cmd('negocio.ver', { id: viewing.id }); if (v?.ok) viewing = v.data; }
    paint();
  }
  function open() { mode = 'list'; viewing = null; sig = ''; show('p-negocio'); window.scrollTo(0, 0); void load(); clearInterval(timer); timer = setInterval(() => { if (mode && !document.hidden) void load(); }, 8000); }
  async function openOne(id) {
    const v = await api.cmd('negocio.ver', { id });
    if (!v?.ok) { toast(v?.error || 'No se pudo abrir', 'bad'); return; }
    viewing = v.data; mode = 'one'; sig = ''; paint(true); window.scrollTo(0, 0);
  }
  function back() { if (mode === 'one') { mode = 'list'; viewing = null; paint(true); return; } mode = null; clearInterval(timer); show('p-list'); }
  const after = async (ok) => { if (ok) await load(); return ok; };

  // ------------------------------------------------------------ piezas
  function kpiRow(k) {
    const val = !k.disponible ? 'no medible todavía' : k.error ? `sin medir · ${k.error}` : k.valor == null ? 'aún sin medir' : `${k.valor}${k.unidad ? ` ${k.unidad}` : ''}`;
    const tone = !k.disponible || k.error || k.valor == null ? 'idle' : k.cumple ? 'ok' : 'warn';
    return h('li', { class: `kpi t-${tone}` }, h('b', {}, k.nombre), ` · ${val}`, h('small', { class: 'muted' },
      ` · objetivo ${k.sentido} ${k.objetivo}${k.anterior != null && k.valor != null ? ` · antes ${k.anterior}` : ''}${k.medido_at ? ` · medido ${fecha(k.medido_at)}` : ''}${!k.disponible && k.nota ? ` · ${k.nota}` : ''}`));
  }
  const kpis = (o) => h('div', {}, h('p', { class: 'lbl' }, 'RESULTADO (indicadores medidos por CEOPadre, sin IA)'),
    o.kpis.length ? h('ul', { class: 'a-pend kpis' }, o.kpis.map(kpiRow)) : h('p', { class: 'muted' }, 'Sin indicadores aprobados todavía.'));
  const trabajos = (o) => h('p', { class: 'ln' }, h('b', {}, 'HECHO'),
    ` ${o.trabajos.terminados} trabajo${o.trabajos.terminados === 1 ? '' : 's'} terminado${o.trabajos.terminados === 1 ? '' : 's'} y verificado${o.trabajos.terminados === 1 ? '' : 's'}${o.trabajos.cancelados ? ` · ${o.trabajos.cancelados} cancelado${o.trabajos.cancelados === 1 ? '' : 's'}` : ''}`,
    o.trabajos.en_curso ? h('span', {}, ` · AHORA en ${o.trabajos.en_curso.proyecto}: ${o.trabajos.en_curso.ahora || o.trabajos.en_curso.estado}`) : null);
  function needBox(o) {
    if (o.estado === 'ESPERANDO_APROBACION') return h('div', { class: 'decision' }, h('p', { class: 'ln' }, h('b', {}, 'TU APROBACIÓN'), ' El plan está listo: revísalo, responde las preguntas y apruébalo.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => openOne(o.id) }, 'REVISAR EL PLAN')));
    if (o.estado === 'ESPERANDO_ANTONIO' || o.estado === 'BLOQUEADA') return h('div', { class: 'decision' }, h('p', { class: 'ln' }, h('b', {}, o.estado === 'BLOQUEADA' ? 'BLOQUEADO' : 'TE NECESITA'), ` ${o.pregunta || o.evaluacion || ''}`),
      h('div', { class: 'row' }, o.estado === 'ESPERANDO_ANTONIO' ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => responder(o, e.currentTarget) }, 'RESPONDER') : null,
        o.categoria === 'CIERRE' ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => cerrar(o, e.currentTarget) }, 'Sí, darlo por alcanzado') : null,
        ['BLOQUEADA', 'ESPERANDO_ANTONIO'].includes(o.estado) ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => after(cmd('negocio.reanudar', { id: o.id }, 'Reanudado', e.currentTarget)) }, 'REANUDAR') : null));
    return null;
  }
  function actions(o) {
    const closed = ['ALCANZADA', 'CANCELADA'].includes(o.estado);
    return h('div', { class: 'a-acts' },
      mode === 'list' ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => openOne(o.id) }, 'Ver todo') : null,
      !closed ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => instruir(o, e.currentTarget) }, 'Dar instrucción') : null,
      ['ACTIVA', 'ESPERANDO_ANTONIO', 'PAUSADA'].includes(o.estado) ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => after(cmd('negocio.medir', { id: o.id }, 'Medido', e.currentTarget)) }, 'Medir ahora') : null,
      o.estado === 'PAUSADA' ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => after(cmd('negocio.reanudar', { id: o.id }, 'Reanudado', e.currentTarget)) }, 'REANUDAR')
        : !closed && o.estado !== 'BLOQUEADA' ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => after(cmd('negocio.pausar', { id: o.id }, 'En pausa', e.currentTarget)) }, 'Pausar') : null,
      !closed ? h('button', { class: 'btn ghost-danger small', type: 'button', onclick: (e) => cancelar(o, e.currentTarget) }, 'Cancelar') : null);
  }
  function card(o) {
    return h('article', { class: `a-card t-${TONE[o.estado] || 'idle'}`, 'data-id': `meta-${o.id}` },
      h('header', {}, h('h3', {}, o.titulo), chip(o.estado_texto, TONE[o.estado] || 'idle')),
      h('p', { class: 'a-desc' }, o.texto),
      h('p', { class: 'a-meta muted' }, `${o.proyectos.map((p) => p.nombre).join(' · ')}${o.proxima_revision && o.estado === 'ACTIVA' ? ` · próxima revisión ${fecha(o.proxima_revision)}` : ''}`),
      needBox(o), kpis(o), trabajos(o),
      o.evaluacion ? h('p', { class: 'ln' }, h('b', {}, 'ÚLTIMA VALORACIÓN'), ` ${o.evaluacion}`) : null,
      o.estado === 'ACTIVA' || o.estado === 'ESPERANDO_ANTONIO' ? h('p', { class: 'a-meta muted' }, `Revisiones sin mejora: ${o.ciclos_sin_avance} de ${o.sin_avance_max} · trabajos esta semana: ${o.presupuesto.semana} de ${o.presupuesto.maximo}`) : null,
      actions(o));
  }

  // ------------------------------------------------------------ acciones
  async function crear(btn) {
    const ps = projects();
    if (!ps.length) { toast('Primero vincula algún proyecto', 'bad'); return; }
    const r = await ask({ title: 'Nuevo objetivo de negocio', ok: 'Crear',
      help: 'Escribe el resultado que quieres (no la tarea). CEOPadre investiga primero los proyectos y te trae un plan con indicadores medibles y las preguntas imprescindibles; nada se ejecuta hasta que lo apruebes. Gasto 0 € y nada sale a terceros sin ti.',
      fields: [{ name: 'texto', label: 'Objetivo', type: 'textarea', placeholder: 'Quiero vender GEST7 por redes sociales' },
        { name: 'principal', label: 'Proyecto principal', type: 'choice', options: ps.map((p) => ({ value: p.id, label: p.nombre })) },
        ...ps.map((p) => ({ name: `p_${p.id}`, label: `Implicar ${p.nombre}`, type: 'checkbox' }))] });
    if (!r) return;
    const ids = [r.principal, ...ps.filter((p) => r[`p_${p.id}`]).map((p) => p.id)].filter((x, i, a) => x && a.indexOf(x) === i);
    await after(cmd('negocio.crear', { texto: r.texto, proyectos: ids, principal: r.principal }, 'Creado: preparando el plan', btn));
  }
  async function responder(o, btn) {
    const r = await ask({ title: 'Responder', help: o.pregunta || '', ok: 'Enviar respuesta', fields: [{ name: 'respuesta', label: 'Tu respuesta', type: 'textarea' }] });
    if (r) await after(cmd('negocio.responder', { id: o.id, respuesta: r.respuesta }, 'Respuesta enviada', btn));
  }
  async function instruir(o, btn) {
    const r = await ask({ title: 'Instrucción para el director', help: 'La tendrá en cuenta en su próxima decisión. El trabajo en marcha no se corta.', ok: 'Guardar', fields: [{ name: 'texto', label: 'Instrucción', type: 'textarea' }] });
    if (r) await after(cmd('negocio.instruccion', { id: o.id, texto: r.texto }, 'Guardada', btn));
  }
  async function cancelar(o, btn) {
    const r = await ask({ title: `¿Cancelar «${o.titulo}»?`, ok: 'Sí, cancelar', danger: true, help: 'El director deja de lanzar trabajos. No se revierte nada de lo hecho.',
      fields: o.trabajos.en_curso ? [{ name: 'trabajo', label: `Cancelar también el trabajo en marcha (${o.trabajos.en_curso.proyecto})`, type: 'checkbox' }] : [] });
    if (r) await after(cmd('negocio.cancelar', { id: o.id, confirmado: true, cancelar_trabajo: !!r.trabajo }, 'Cancelado', btn));
  }
  async function cerrar(o, btn) {
    const r = await ask({ title: `¿Dar por alcanzado «${o.titulo}»?`, ok: 'Sí, cerrar', fields: [{ name: 'motivo', label: 'Motivo (opcional)', required: false }] });
    if (r) await after(cmd('negocio.cerrar', { id: o.id, confirmado: true, motivo: r.motivo }, 'Cerrado', btn));
  }
  async function aprobar(o, btn) {
    const qs = o.plan?.preguntas || [];
    const r = await ask({ title: 'Aprobar el plan', ok: 'Aprobar y empezar',
      help: 'Al aprobar, CEOPadre ejecutará los comandos de medición que ves en el plan (sólo lectura) y el director empezará a lanzar trabajos, de uno en uno.',
      fields: qs.map((q) => ({ name: q.id, label: `${q.id} · ${q.pregunta}${q.por_que ? ` (${q.por_que})` : ''}`, type: 'textarea' })) });
    if (!r) return;
    if (await cmd('negocio.aprobar', { id: o.id, plan_hash: o.plan_hash, respuestas: r }, 'Plan aprobado', btn)) { await openOne(o.id); }
  }
  async function corregir(o, btn) {
    const r = await ask({ title: 'Corregir el plan', help: 'Se rehace el diagnóstico con tu corrección.', ok: 'Rehacer el plan', fields: [{ name: 'motivo', label: 'Qué hay que cambiar', type: 'textarea' }] });
    if (r && await cmd('negocio.corregir_plan', { id: o.id, motivo: r.motivo }, 'Rehaciendo el plan', btn)) await openOne(o.id);
  }

  // ------------------------------------------------------------ un objetivo entero
  function planView(o) {
    const p = o.plan;
    if (!p) return h('section', { class: 'panel' }, h('h4', {}, 'Plan'), h('p', { class: 'muted' }, o.estado === 'DEFINIENDO' ? 'El diagnóstico lo está preparando.' : 'Sin plan.'));
    return h('section', { class: 'panel' }, h('h4', {}, 'Plan'),
      p.resultado_buscado ? h('p', { class: 'ln' }, h('b', {}, 'RESULTADO BUSCADO'), ` ${p.resultado_buscado}`) : null,
      p.estado_actual ? h('p', { class: 'a-desc' }, p.estado_actual) : null,
      p.hoja_de_ruta?.length ? [h('p', { class: 'lbl' }, 'HOJA DE RUTA'), h('ol', { class: 'a-steps' }, p.hoja_de_ruta.map((f) => h('li', {}, h('b', {}, f.fase), ` (${f.proyecto}) · ${f.objetivo}`, h('small', { class: 'muted' }, ` · cumplido si ${f.criterio}`))))] : null,
      p.kpis?.length ? [h('p', { class: 'lbl' }, 'CÓMO SE MIDE (lo ejecuta CEOPadre al aprobar)'), h('ul', { class: 'a-pend' }, p.kpis.map((k) => h('li', {}, h('b', {}, k.nombre), ` · objetivo ${k.sentido} ${k.objetivo}${k.unidad ? ` ${k.unidad}` : ''} · `,
        k.comprobar ? h('code', {}, k.comprobar.cmd) : h('i', {}, 'no medible todavía'), k.fuente ? h('small', { class: 'muted' }, ` · ${k.fuente}`) : null, k.nota ? h('small', { class: 'muted' }, ` · ${k.nota}`) : null)))] : null,
      p.riesgos?.length ? [h('p', { class: 'lbl' }, 'RIESGOS'), h('ul', { class: 'a-pend' }, p.riesgos.map((x) => h('li', {}, x)))] : null,
      o.estado === 'ESPERANDO_APROBACION' ? h('div', { class: 'a-acts' }, h('button', { class: 'btn primary', type: 'button', disabled: !online(), onclick: (e) => aprobar(o, e.currentTarget) }, 'RESPONDER Y APROBAR'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => corregir(o, e.currentTarget) }, 'Corregir el plan')) : null);
  }
  function one() {
    const o = viewing;
    return [h('section', { class: 'panel' }, card(o)), planView(o),
      Object.keys(o.respuestas || {}).length ? h('section', { class: 'panel' }, h('h4', {}, 'Tus respuestas e instrucciones'), h('ul', { class: 'a-pend' }, Object.entries(o.respuestas).map(([k, v]) => h('li', {}, h('b', {}, k), ` · ${v}`)))) : null,
      h('section', { class: 'panel' }, h('h4', {}, `Trabajos (${o.trabajos_lista.length})`), o.trabajos_lista.length ? o.trabajos_lista.map((t) => h('article', { class: `a-runrow t-${t.estado === 'TERMINADO' ? 'ok' : ['CANCELADO'].includes(t.estado) ? 'idle' : 'work'}` },
        h('header', {}, h('b', {}, `${fecha(t.inicio)} · ${t.proyecto}`), chip(t.verificado ? 'Terminado y verificado' : t.estado, t.verificado ? 'ok' : 'work')),
        h('p', { class: 'a-desc' }, t.objetivo), t.ahora ? h('p', { class: 'ln' }, h('b', {}, 'AHORA'), ` ${t.ahora}`) : null,
        t.comprobado?.length ? h('ul', { class: 'a-pend' }, t.comprobado.map((x) => h('li', {}, x))) : null,
        h('div', { class: 'a-acts' }, h('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const x = await api.cmd('ronda.informe', { trabajo: t.trabajo }); if (x?.ok) viewText(`Informe · ${t.proyecto}`, x.data.texto); else toast(x?.error || 'Sin informe', 'bad'); } finally { e.currentTarget.disabled = false; }
        } }, 'Informe completo')))) : h('p', { class: 'muted' }, 'Ninguno todavía.')),
      h('section', { class: 'panel' }, h('h4', {}, 'Historial'), h('ul', { class: 'a-pend' }, o.eventos.map((e) => h('li', {}, h('small', { class: 'muted' }, `${fecha(e.at)} · ${e.tipo} · `), e.texto))))];
  }

  function paint(force = false) {
    paintTop();
    if (!mode) return;
    const s = JSON.stringify([mode, list, viewing]) + online();
    if (!force && (s === sig || document.querySelector('dialog[open]'))) return;
    sig = s;
    document.getElementById('n-title').textContent = mode === 'one' ? viewing.titulo : 'Objetivos de negocio';
    document.getElementById('n-sub').textContent = mode === 'list' ? `${list.filter((o) => !['ALCANZADA', 'CANCELADA'].includes(o.estado)).length} abiertos · ${online() ? 'PC conectado' : 'PC desconectado'}` : viewing.estado_texto;
    document.getElementById('n-body').replaceChildren(...(mode === 'one' ? one() : [
      h('div', { class: 'a-top' }, h('button', { class: 'btn accent', type: 'button', disabled: !online(), onclick: (e) => crear(e.currentTarget) }, '+ Nuevo objetivo de negocio')),
      list.length ? h('div', { class: 'a-cards' }, list.map(card)) : h('p', { class: 'empty' }, 'Todavía no hay objetivos de negocio. Escribe el resultado que quieres conseguir («Quiero vender GEST7 por redes sociales») y CEOPadre preparará el plan.'),
    ]).flat(Infinity).filter(Boolean));
  }
  function paintTop() {
    const b = document.getElementById('b-negocio');
    const n = data().negocio?.te_necesitan || 0;
    if (b) { b.textContent = n ? `NEGOCIO · ${n}` : 'NEGOCIO'; b.classList.toggle('need', !!n); }
  }

  document.getElementById('n-back').addEventListener('click', back);
  document.getElementById('b-negocio')?.addEventListener('click', open);
  return { paint, open };
}
