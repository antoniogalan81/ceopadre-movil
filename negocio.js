// OBJETIVOS DE NEGOCIO en el PC y en el móvil (la misma pantalla). Pinta lo que devuelven las órdenes negocio.* y deja
// órdenes de la lista cerrada; no decide nada. Separa siempre lo HECHO (trabajos) de lo CONSEGUIDO (indicadores medidos).
// Sin porcentajes ni estimaciones: sólo valores medidos, con su fecha, y su objetivo.
import { h } from './dom.js';
import { proyectosEn } from './zones.js';

const TONE = { DEFINIENDO: 'work', ESPERANDO_APROBACION: 'ask', ACTIVA: 'work', ESPERANDO_ANTONIO: 'ask', PAUSADA: 'idle', ALCANZADA: 'ok', BLOQUEADA: 'bad', CANCELADA: 'idle',
  EN_SEGUIMIENTO: 'wait', CERRADA: 'idle' };
const CLOSED = ['ALCANZADA', 'CANCELADA', 'CERRADA'];
const TIPO_NEC = { CONEXION: 'Conectar una cuenta', DATO: 'Un dato', ACCION: 'Algo que sólo puedes hacer tú', DECISION: 'Una decisión', CAPACIDAD: 'Herramienta nueva para el catálogo', AUTOMATIZACION: 'Activar una automatización' };
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
    window.dispatchEvent(new CustomEvent('ceo:nav', { detail: { objetivo: id } })); // enlace directo y botón Atrás
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
  // HECHO · AHORA · DESPUÉS · TE NECESITO (V3.5): lo que de verdad ha pasado, sin porcentajes ni barras inventadas.
  function cuatro(o) {
    const v = o.vista || {};
    const linea = (t, cls, body) => h('div', { class: `q4 ${cls}` }, h('p', { class: 'lbl' }, t), body);
    const lista = (xs, f, empty) => (xs?.length ? h('ul', { class: 'mlist' }, xs.slice(0, 3).map((x) => h('li', {}, f(x)))) : h('p', { class: 'muted small' }, empty));
    return h('div', { class: 'q4-grid' },
      linea('HECHO', 'ok', lista(v.hecho, (t) => `${t.proyecto}: ${t.objetivo.split('\n')[0].slice(0, 140)}${t.comprobado?.length ? ' ✓' : ''}`, 'Nada terminado todavía.')),
      linea('AHORA', 'work', lista(v.ahora, (t) => `${t.proyecto}: ${t.pausado ? 'en pausa' : t.te_necesita ? 'esperando algo tuyo' : (t.ahora && t.ahora !== 'Aún no se ha hecho nada' ? t.ahora : t.objetivo.split('\n')[0]).slice(0, 140)}`, o.estado === 'PAUSADA' ? 'En pausa.' : 'Nada en marcha.')),
      linea('DESPUÉS', 'next', h('p', {}, v.despues || (o.estado === 'EN_SEGUIMIENTO' ? `Medir el resultado ${o.proxima_revision ? `el ${fecha(o.proxima_revision)}` : 'periódicamente'} (sin IA).` : o.estado === 'ESPERANDO_APROBACION' ? 'Empieza al aprobar el plan.' : o.proxima_revision ? `El CEO revisa el ${fecha(o.proxima_revision)}.` : 'El CEO decide al terminar lo que hay en marcha.'))),
      linea('TE NECESITO', v.te_necesito?.length || o.te_necesita ? 'need' : 'ok', v.te_necesito?.length ? lista(v.te_necesito, (n) => n.que, '') : h('p', { class: 'muted small' }, o.te_necesita ? 'Mira abajo.' : 'Nada ahora.')),
      v.entendido ? h('p', { class: 'q4-entendido' }, h('b', {}, 'ÚLTIMO CAMBIO ENTENDIDO: '), v.entendido) : null,
      v.resultado ? h('p', { class: `q4-res ${v.resultado === 'acreditado' ? 'ok' : 'warn'}` }, v.resultado === 'acreditado' ? 'Resultado empresarial ACREDITADO por sus indicadores.' : `Resultado empresarial: ${v.resultado}.`) : null);
  }
  // Lo que el CEO pidió a Antonio: qué, por qué, qué bloquea, qué sigue haciendo y cómo decirle que está hecho.
  function necesidades(o) {
    const xs = (o.necesidades || []).filter((n) => n.estado === 'PENDIENTE');
    if (!xs.length) return null;
    return h('section', { class: 'panel need-panel' }, h('h4', {}, `Necesito tu intervención (${xs.length})`), xs.map((n) => h('article', { class: 'need-card' },
      h('p', { class: 'need-t' }, h('b', {}, TIPO_NEC[n.tipo] || 'Necesito'), ` — ${n.que}`),
      h('dl', { class: 'wait-dl' },
        n.por_que ? [h('dt', {}, 'Por qué'), h('dd', {}, n.por_que)] : null,
        n.bloquea ? [h('dt', {}, 'Queda en espera'), h('dd', {}, n.bloquea)] : null,
        n.mientras ? [h('dt', {}, 'Mientras, sigo con'), h('dd', {}, n.mientras)] : null,
        n.como ? [h('dt', {}, 'Cómo'), h('dd', {}, n.como)] : null),
      h('div', { class: 'a-acts' },
        n.tipo === 'CONEXION' ? h('button', { class: 'btn primary small', type: 'button', onclick: () => window.dispatchEvent(new CustomEvent('ceo:conexiones', { detail: { servicio: n.conexion } })) }, `Conectar ${n.conexion || 'la cuenta'}`)
          : n.tipo === 'AUTOMATIZACION' ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => after(cmd('negocio.necesidad', { id: n.id, respuesta: 'Aprobada' }, 'Automatización activada', e.currentTarget)) }, 'Activar la automatización')
          : n.tipo === 'CAPACIDAD' ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => after(cmd('negocio.necesidad', { id: n.id, respuesta: 'Aprobada' }, 'Incorporada al catálogo', e.currentTarget)) }, 'Incorporar al catálogo')
          : h('button', { class: 'btn primary small', type: 'button', onclick: (e) => resolverNec(o, n, e.currentTarget) }, n.tipo === 'DECISION' || n.tipo === 'DATO' ? 'Responder' : 'Ya lo he hecho'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => descartarNec(o, n, e.currentTarget) }, 'No lo voy a hacer')))));
  }
  async function resolverNec(o, n, btn) {
    const r = await ask({ title: n.que, help: n.como || '', ok: 'Enviar', fields: [{ name: 'respuesta', label: n.tipo === 'ACCION' ? 'Qué has hecho (opcional)' : 'Tu respuesta', type: 'textarea', required: n.tipo !== 'ACCION' }] });
    if (r) await after(cmd('negocio.necesidad', { id: n.id, respuesta: r.respuesta || 'Hecho' }, 'Recibido: el CEO continúa', btn));
  }
  async function descartarNec(o, n, btn) {
    const r = await ask({ title: `¿Descartar «${n.que}»?`, help: 'El CEO replanifica sin ello.', ok: 'Descartar', fields: [{ name: 'motivo', label: 'Motivo (opcional)', required: false }] });
    if (r) await after(cmd('negocio.necesidad', { id: n.id, descartar: true, respuesta: r.motivo }, 'Descartada', btn));
  }
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
    const closed = CLOSED.includes(o.estado);
    return h('div', { class: 'a-acts' },
      mode === 'list' ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => openOne(o.id) }, 'Ver todo') : null,
      !closed ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => instruir(o, e.currentTarget) }, 'Nueva instrucción o prioridad') : null,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => window.dispatchEvent(new CustomEvent('ceo:abrir', { detail: { ref: `meta:${o.id}` } })) }, '💬 Consultar al CEO'),
      ['ACTIVA', 'ESPERANDO_ANTONIO', 'PAUSADA', 'EN_SEGUIMIENTO'].includes(o.estado) ? h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => after(cmd('negocio.medir', { id: o.id }, 'Medido', e.currentTarget)) }, 'Medir ahora') : null,
      o.estado === 'PAUSADA' ? h('button', { class: 'btn primary small', type: 'button', onclick: (e) => after(cmd('negocio.reanudar', { id: o.id }, 'Continúa', e.currentTarget)) }, '▶ CONTINUAR ESTE OBJETIVO')
        : !closed && o.estado !== 'BLOQUEADA' ? h('button', { class: 'btn ghost small', type: 'button', title: 'Pausa TODO este objetivo: no empieza nada nuevo y sus trabajos en marcha se detienen sin perder lo hecho', onclick: (e) => after(cmd('negocio.pausar', { id: o.id }, 'Objetivo en pausa', e.currentTarget)) }, '⏸ Pausar este objetivo') : null,
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
    // Paso 1: sólo la frase. Paso 2: el proyecto que nombra ya elegido, y sólo se ofrecen los proyectos con actividad.
    const t = await ask({ title: 'Nuevo objetivo de negocio', ok: 'Siguiente',
      help: 'Escribe el resultado que quieres conseguir, no la tarea. El CEO lo analiza, te pregunta lo imprescindible y te trae un plan con indicadores medibles; nada se ejecuta hasta que lo apruebes. Gasto 0 € y nada sale a terceros sin ti.',
      fields: [{ name: 'texto', label: 'Qué quieres conseguir', type: 'textarea', placeholder: 'Quiero conseguir clientes para GEST7 mediante redes sociales' }] });
    if (!t?.texto) return;
    const nombrados = proyectosEn(t.texto, ps);
    const vivos = ps.filter((p) => nombrados.includes(p.id) || (p.automatizaciones || []).length || !['LIBRE', 'CANCELADO'].includes(p.estado));
    const r = await ask({ title: 'Proyectos implicados', ok: 'Crear objetivo',
      help: nombrados.length ? `He reconocido: ${ps.filter((p) => nombrados.includes(p.id)).map((p) => p.nombre).join(', ')}. Cámbialo si hace falta.` : 'Elige el proyecto principal.',
      fields: [{ name: 'principal', label: 'Proyecto principal', type: 'choice', value: nombrados[0] || '', options: ps.map((p) => ({ value: p.id, label: p.nombre })) },
        ...vivos.map((p) => ({ name: `p_${p.id}`, label: `También ${p.nombre}`, type: 'checkbox', value: nombrados.slice(1).includes(p.id) }))] });
    if (!r) return;
    const ids = [r.principal, ...vivos.filter((p) => r[`p_${p.id}`]).map((p) => p.id)].filter((x, i, a) => x && a.indexOf(x) === i);
    await after(cmd('negocio.crear', { texto: t.texto, proyectos: ids, principal: r.principal }, 'Creado: el CEO prepara el plan', btn));
  }
  async function responder(o, btn) {
    const r = await ask({ title: 'Responder', help: o.pregunta || '', ok: 'Enviar respuesta', fields: [{ name: 'respuesta', label: 'Tu respuesta', type: 'textarea' }] });
    if (r) await after(cmd('negocio.responder', { id: o.id, respuesta: r.respuesta }, 'Respuesta enviada', btn));
  }
  async function instruir(o, btn) {
    const r = await ask({ title: 'Nueva instrucción o prioridad', help: 'Llega YA a los trabajos en marcha (Claude la incorpora sin empezar de cero) y el CEO revisa el plan ahora mismo: verás qué ha entendido en «Último cambio entendido». Si algo en marcha queda contradicho, lo para sin perder lo hecho.', ok: 'Enviar', fields: [{ name: 'texto', label: 'Instrucción', type: 'textarea' }] });
    if (r) await after(cmd('negocio.instruccion', { id: o.id, texto: r.texto }, 'Recibida: el CEO revisa el plan', btn));
  }
  async function cancelar(o, btn) {
    const r = await ask({ title: `¿Cancelar «${o.titulo}»?`, ok: 'Sí, cancelar', danger: true, help: 'El director deja de lanzar trabajos. No se revierte nada de lo hecho.',
      fields: o.trabajos.en_curso ? [{ name: 'trabajo', label: `Cancelar también el trabajo en marcha (${o.trabajos.en_curso.proyecto})`, type: 'checkbox' }] : [] });
    if (r) await after(cmd('negocio.cancelar', { id: o.id, confirmado: true, cancelar_trabajo: !!r.trabajo }, 'Cancelado', btn));
  }
  async function cerrar(o, btn) {
    const r = await ask({ title: `¿Cerrar «${o.titulo}»?`, ok: 'Cerrar',
      help: 'Sólo cuenta como ALCANZADO si los indicadores de resultado lo acreditan. Si no, queda EN SEGUIMIENTO (se sigue midiendo solo) salvo que marques cerrarlo sin acreditar.',
      fields: [{ name: 'motivo', label: 'Motivo (opcional)', required: false }, { name: 'sin_acreditar', label: 'Cerrarlo aunque el resultado no esté acreditado (no contará como alcanzado)', type: 'checkbox' }] });
    if (r) await after(cmd('negocio.cerrar', { id: o.id, confirmado: true, motivo: r.motivo, sin_acreditar: !!r.sin_acreditar }, 'Hecho', btn));
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
  // UN OBJETIVO (V3.3): primero las respuestas (qué queremos, cómo, qué se hizo, qué se comprobó, qué resultados hay,
  // qué hace ahora, qué viene, qué necesita de ti); después la hoja de ruta por fases y el detalle. HECHO ≠ CONSEGUIDO:
  // los trabajos dicen lo hecho; sólo los indicadores medidos dicen el resultado.
  function resumenOne(o) {
    const p = o.plan || {};
    const hechos = o.trabajos_lista.filter((t) => t.estado === 'TERMINADO');
    const comprobado = hechos.flatMap((t) => (t.comprobado || []).map((x) => `${t.proyecto}: ${x}`));
    const medidos = o.kpis.filter((k) => k.disponible && k.valor != null);
    const box = (t, body, cls = '') => h('div', { class: `dir-box ${cls}` }, h('p', { class: 'lbl' }, t), body);
    const ul = (xs, empty) => (xs.length ? h('ul', { class: 'mlist' }, xs.slice(0, 4).map((x) => h('li', {}, String(x).slice(0, 220))), xs.length > 4 ? h('li', { class: 'more' }, `+${xs.length - 4} más (abajo)`) : null) : h('p', { class: 'muted small' }, empty));
    return h('section', { class: 'panel dir' }, h('div', { class: 'dir-head' }, h('h4', {}, o.titulo), chip(o.estado_texto, TONE[o.estado] || 'idle')),
      cuatro(o), actions(o),
      needBox(o),
      h('div', { class: 'dir-grid' },
        box('QUÉ QUEREMOS CONSEGUIR', h('p', {}, p.resultado_buscado || o.texto)),
        box('ESTRATEGIA', p.hoja_de_ruta?.length ? h('p', {}, p.hoja_de_ruta.map((f) => f.fase).join(' → ')) : h('p', { class: 'muted small' }, o.estado === 'DEFINIENDO' ? 'El CEO la está preparando.' : 'Sin plan todavía.')),
        box('RESULTADOS REALES', ul(medidos.map((k) => `${k.nombre}: ${k.valor}${k.unidad ? ` ${k.unidad}` : ''} (objetivo ${k.sentido} ${k.objetivo})${k.cumple ? ' ✓' : ''}`), o.kpis.length ? 'Aún sin medir: se mide solo, sin IA.' : 'Sin indicadores aprobados.'), 'ok'),
        box('REALIZADO', ul(hechos.map((t) => `${t.proyecto}: ${t.objetivo}`), 'Ningún trabajo terminado todavía.')),
        box('COMPROBADO', ul(comprobado, 'Nada comprobado todavía.'), 'ok'),
        p.riesgos?.length ? box('OBSTÁCULOS', ul(p.riesgos, ''), 'bad') : null));
  }
  // HOJA DE RUTA: las fases del plan en orden, con su proyecto y cuándo se da por cumplida. El estado de cada fase no se
  // inventa: se enseña cuántos trabajos de ese proyecto hay terminados y si el que está en marcha es de ella.
  function roadmap(o) {
    const fases = o.plan?.hoja_de_ruta || [];
    if (!fases.length) return null;
    return h('section', { class: 'panel' }, h('h4', {}, 'Hoja de ruta'),
      h('ol', { class: 'road' }, fases.map((f, i) => {
        const hechos = o.trabajos_lista.filter((t) => t.estado === 'TERMINADO' && t.proyecto === f.proyecto).length;
        const enMarcha = o.trabajos.en_curso?.proyecto === f.proyecto;
        return h('li', { class: `road-step${enMarcha ? ' now' : hechos ? ' some' : ''}` }, h('span', { class: 'road-n', 'aria-hidden': 'true' }, String(i + 1)),
          h('div', {}, h('b', {}, f.fase), h('p', {}, f.objetivo),
            h('small', { class: 'muted' }, `${f.proyecto}${f.criterio ? ` · cumplida cuando ${f.criterio}` : ''}${hechos ? ` · ${hechos} trabajo${hechos === 1 ? '' : 's'} terminado${hechos === 1 ? '' : 's'} en este proyecto` : ''}${enMarcha ? ' · trabajando ahora' : ''}`)));
      })));
  }
  function one() {
    const o = viewing;
    return [resumenOne(o), necesidades(o), roadmap(o), planView(o),
      Object.keys(o.respuestas || {}).length ? h('section', { class: 'panel' }, h('h4', {}, 'Tus respuestas e instrucciones'), h('ul', { class: 'a-pend' }, Object.entries(o.respuestas).map(([k, v]) => h('li', {}, h('b', {}, k), ` · ${v}`)))) : null,
      h('section', { class: 'panel' }, h('h4', {}, `Trabajos (${o.trabajos_lista.length})`), o.trabajos_lista.length ? o.trabajos_lista.map((t) => h('article', { class: `a-runrow t-${t.estado === 'TERMINADO' ? 'ok' : ['CANCELADO'].includes(t.estado) ? 'idle' : 'work'}` },
        h('header', {}, h('b', {}, `${fecha(t.inicio)} · ${t.proyecto}`), chip(t.verificado ? 'Terminado y comprobado' : t.estado === 'CANCELADO' ? 'Cancelado' : 'En marcha', t.verificado ? 'ok' : 'work')),
        h('p', { class: 'a-desc' }, t.objetivo), t.ahora ? h('p', { class: 'ln' }, h('b', {}, 'SITUACIÓN'), ` ${t.ahora}`) : null,
        t.comprobado?.length ? h('ul', { class: 'a-pend' }, t.comprobado.map((x) => h('li', {}, x))) : null,
        h('div', { class: 'a-acts' }, h('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const x = await api.cmd('ronda.informe', { trabajo: t.trabajo }); if (x?.ok) viewText(`Informe · ${t.proyecto}`, x.data.texto); else toast(x?.error || 'Sin informe', 'bad'); } finally { e.currentTarget.disabled = false; }
        } }, 'Informe completo')))) : h('p', { class: 'muted' }, 'Ninguno todavía.')),
      h('details', { class: 'panel fold' }, h('summary', {}, 'Historial del director'), h('ul', { class: 'a-pend' }, o.eventos.map((e) => h('li', {}, h('small', { class: 'muted' }, `${fecha(e.at)} · ${e.tipo} · `), e.texto))))];
  }


  function paint(force = false) {
    paintTop();
    if (!mode) return;
    const s = JSON.stringify([mode, list, viewing]) + online();
    if (!force && (s === sig || document.querySelector('dialog[open]'))) return;
    sig = s;
    document.getElementById('n-title').textContent = mode === 'one' ? viewing.titulo : 'Objetivos de negocio';
    document.getElementById('n-sub').textContent = mode === 'list' ? `${list.filter((o) => !CLOSED.includes(o.estado)).length} abiertos · ${online() ? 'PC conectado' : 'PC desconectado'}` : viewing.estado_texto;
    document.getElementById('n-body').replaceChildren(...(mode === 'one' ? one() : [
      h('div', { class: 'a-top' }, h('button', { class: 'btn accent', type: 'button', disabled: !online(), onclick: (e) => crear(e.currentTarget) }, '+ Nuevo objetivo de negocio')),
      list.length ? h('div', { class: 'a-cards' }, list.map(card)) : h('p', { class: 'empty' }, 'Todavía no hay objetivos de negocio. Escribe el resultado que quieres conseguir («Quiero vender GEST7 por redes sociales») y CEOPadre preparará el plan.'),
    ]).flat(Infinity).filter(Boolean));
  }
  function paintTop() {
    const b = document.getElementById('b-negocio');
    const n = data().negocio?.te_necesitan || 0;
    if (b) { b.textContent = n ? `Objetivos · ${n}` : 'Objetivos'; b.classList.toggle('need', !!n); }
  }

  document.getElementById('n-back').addEventListener('click', back);
  document.getElementById('b-negocio')?.addEventListener('click', open);
  // Desde el centro de dirección: abrir uno concreto o crear uno nuevo sin pasar por la lista.
  return { paint, open, openOne: (id) => { open(); void openOne(id); }, crear: (btn) => { open(); void crear(btn); } };
}
