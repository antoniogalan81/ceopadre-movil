// MAPA DEL PROYECTO: el canon pintado para Antonio. Sólo lee los campos que manda el PC (src/canon.js mapView);
// sin IA, sin YAML/JSON a la vista y sin rutas. Lo técnico (id, huella, esquema) queda plegado.
import { h } from './dom.js';

const MARK = { hecho: '✓', en_curso: '●', falta: '○', bloqueado: '⛔' };
const COLS = [['hecho', 'HECHO'], ['en_curso', 'EN CURSO'], ['falta', 'FALTA']];
const day = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; };
const lbl = (t) => h('p', { class: 'lbl' }, t);
const list = (items, cls = '') => h('ul', { class: `mlist ${cls}` }, items.map((x) => h('li', {}, x)));

/** Un punto de estado; la evidencia sólo en el mapa completo y en pequeño (sin llenar la pantalla de etiquetas). */
function statusItem(kind, it, full) {
  const ev = full && it.evidence ? h('small', { class: `ev ev-${it.evidence.toLowerCase()}` }, ` ${it.evidence.toLowerCase()}${it.date ? ` ${day(it.date) || it.date}` : ''}`) : null;
  return h('li', { class: `st-${kind}` }, h('i', { 'aria-hidden': 'true' }, MARK[kind]), ' ', it.text, ev);
}

const short = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Botón de decisión con un solo símbolo (✓ ✕ ? ✎ ⏱): SIEMPRE con nombre accesible y ayuda al pasar el ratón. */
// V3.3: el texto también se VE (antes sólo el símbolo: «✓ ✕ ?» no decía qué hacía cada uno).
const dbtn = (glyph, label, onclick, cls) => h('button', { class: `dbtn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick },
  h('span', { 'aria-hidden': 'true' }, glyph), h('span', { class: 'dbtn-l', 'aria-hidden': 'true' }, label));

/**
 * ✓ ✕ ↺ ? de una decisión. V3.7: cada botón dice la ACCIÓN REAL que autoriza (texto del CEO para esta versión de la
 * decisión, o «Aprobar la propuesta» si aún no habló); ↺ = la alternativa del CEO; el recomendado se marca. `ask`
 * (Consultar al CEO) es consultivo: nunca aprueba ni rechaza.
 */
export function decideRow({ yes, no, ask, alt = null, altLabel = '', rec = null, yesLabel = 'Aprobar la propuesta', noLabel = 'Rechazar la propuesta' }) {
  const b = (g, l, fn, cls, k) => {
    const x = dbtn(g, l, fn, `${cls}${rec === k ? ' rec' : ''}`);
    if (rec === k) { x.setAttribute('aria-label', `${l} (recomendado por el CEO)`); x.title = `${l} — lo recomienda el CEO`; x.append(h('span', { class: 'rec-tag', 'aria-hidden': 'true' }, 'RECOMENDADO')); }
    return x;
  };
  return h('div', { class: 'dec-btns', role: 'group', 'aria-label': 'Decidir' },
    yes ? b('✓', yesLabel, yes, 'yes', 'APROBAR') : null, no ? b('✕', noLabel, no, 'no', 'RECHAZAR') : null,
    alt ? b('↺', altLabel || 'Hacer la alternativa del CEO', alt, 'alt', 'ALTERNATIVA') : null, ask ? dbtn('?', 'Consultar al CEO', ask, 'ask') : null);
}

/**
 * V3.11 · LO COMÚN DE TODA DECISIÓN, debajo de ✓ ✕ ↺ ?: mismos nombres y mismo orden en todas las pantallas (Dirección,
 * Proyectos, Objetivos, la conversación con el CEO; PC y móvil). Cada tarjeta pasa SÓLO lo que tiene sentido para ella
 * (p. ej. un trabajo esperando no se pospone: seguiría parado igual). Ninguno decide nada salvo «Dar otra instrucción».
 */
export function comunes({ copy = null, detalles = null, instruir = null, posponer = null, posponerLabel = 'Posponer 7 días' } = {}) {
  const L = (txt, fn, title) => (fn ? h('button', { class: 'link com', type: 'button', title, onclick: (e) => fn(e.currentTarget) }, txt) : null);
  const xs = [L('📋 Copiar consulta', copy, 'Copia el asunto entero (sin datos sensibles) para consultarlo fuera, p. ej. en ChatGPT'),
    L('🔎 Ver detalles', detalles, 'Contexto, justificación, alternativas, riesgos y qué pasa con cada opción'),
    L('✎ Dar otra instrucción', instruir, 'No aceptar la propuesta tal cual: di qué hacer en su lugar'),
    L(`⏱ ${posponerLabel}`, posponer, 'Dejarla pendiente sin avisos; lo que no depende de ella sigue trabajando')].filter(Boolean);
  return xs.length ? h('div', { class: 'dec-com', role: 'group', 'aria-label': 'Más opciones de la decisión' }, xs) : null;
}

// Qué hace CEOPadre DE VERDAD según la clase de decisión (lo que hace el motor; no depende de la IA).
export const EFECTO = {
  trabajo: 'Aprobar deja que el CEO siga con lo propuesto. No autoriza publicar, desplegar, enviar a terceros ni gastar si no estaba en la propuesta: eso se pregunta aparte.',
  propuesta: 'Sólo cambia el mapa del proyecto (lo que CEOPadre da por decidido). No inicia trabajos ni publica nada.',
  pregunta: 'Tu respuesta queda como decisión del proyecto y el CEO la seguirá en los próximos trabajos.',
  necesidad: 'Lo que decidas queda en el registro de decisiones del objetivo y llega al director y a los trabajos vinculados. El resto del objetivo sigue mientras tanto.',
};
const REC_TXT = { APROBAR: (k) => k.aprobar || 'Aprobar la propuesta', RECHAZAR: (k) => k.rechazar || 'Rechazar la propuesta', ALTERNATIVA: (k) => k.alternativa?.etiqueta || 'Otra vía',
  POSPONER: () => 'Esperar', INVESTIGAR: () => 'Comprobar antes un dato', RESPONDER: () => 'Responder' };
/**
 * V3.8 — LA DECISIÓN EXPLICADA de antemano por el CEO (una vez por versión; nada se calcula al abrir): qué pasa, qué
 * proponen, qué recomienda y por qué, qué pasará con cada botón, el riesgo y qué hace CEOPadre de verdad. Sin jerga.
 * Devuelve null si el CEO aún no la explicó (entonces se ve lo de siempre).
 */
export function explica(k, tipo) {
  if (k?.estado === 'PENDIENTE') return h('p', { class: 'advice v-wait', role: 'status' }, h('b', {}, 'CEO'), ' · preparando la explicación…');
  const e = k?.explicacion;
  if (!e || k.estado !== 'OK') return null;
  const f = (t, v, cls = '') => (v ? h('div', { class: `ex-row ${cls}` }, h('dt', {}, t), h('dd', {}, v)) : null);
  const rec = REC_TXT[k.veredicto]?.(k);
  return h('dl', { class: 'explica' },
    f('QUÉ PASA', e.que_pasa), f(tipo === 'pregunta' ? 'QUÉ SE PREGUNTA' : 'QUÉ TE PROPONEN', e.que_proponen),
    f('EL CEO RECOMIENDA', rec ? [h('b', {}, rec), k.respuesta && k.respuesta !== rec ? ` — ${k.respuesta}` : ''] : k.respuesta, 'rec'),
    f('POR QUÉ', k.motivo),
    f(`SI ELIGES «${k.aprobar || 'Aprobar'}»`, e.si_apruebo), f(`SI ELIGES «${k.rechazar || 'Rechazar'}»`, e.si_rechazo),
    k.alternativa ? f(`SI ELIGES «${k.alternativa.etiqueta}»`, k.alternativa.texto) : null,
    f('RIESGO', k.riesgo, 'bad'),
    f('QUÉ HACE CEOPADRE', EFECTO[tipo], 'efecto'));
}
const tecnico = (...kids) => h('details', { class: 'prop-more tecnico' }, h('summary', {}, 'Detalle técnico'), ...kids);

const VEREDICTO = { APROBAR: ['✓', 'APROBAR', 'yes'], RECHAZAR: ['✕', 'RECHAZAR', 'no'], RESPONDER: ['✎', 'RESPONDER', 'ans'], ALTERNATIVA: ['↺', 'OTRA VÍA', 'alt'] };
/** Recomendación de Codex en la propia tarjeta: «CODEX · ✓ APROBAR» + una frase (+ riesgo sólo si lo hay). Antonio decide. */
export function advice(c) {
  if (!c) return null;
  if (c.estado === 'PENDIENTE') return h('p', { class: 'advice v-wait', role: 'status' }, h('b', {}, 'CEO'), ' · analizando…');
  if (c.estado === 'ERROR') return h('p', { class: 'advice v-err', role: 'status' }, h('b', {}, 'CEO'), ` · no se pudo consultar: ${c.error || 'error'}`);
  const [g, t, k] = VEREDICTO[c.veredicto] || ['?', c.veredicto || '', 'ans'];
  // Lo recomendado, dicho con la acción real (no sólo «APROBAR»): el texto del botón que el CEO recomienda pulsar.
  const que = c.veredicto === 'APROBAR' ? c.aprobar : c.veredicto === 'RECHAZAR' ? c.rechazar : c.veredicto === 'ALTERNATIVA' ? c.alternativa?.etiqueta : null;
  return h('div', { class: `advice v-${k}`, role: 'status' },
    h('p', { class: 'advice-head' }, h('b', {}, 'EL CEO RECOMIENDA'), ` · ${g} ${que || t}`),
    c.veredicto === 'ALTERNATIVA' && c.alternativa?.texto ? h('p', { class: 'advice-alt' }, c.alternativa.texto) : null,
    c.respuesta ? h('p', { class: 'advice-ans' }, c.respuesta) : null,
    c.motivo ? h('p', {}, c.motivo) : null,
    c.riesgo ? h('p', { class: 'advice-risk' }, h('b', {}, 'RIESGO'), ' ', c.riesgo) : null);
}

/**
 * CAMBIOS PROPUESTOS a lo protegido. Primero QUÉ CAMBIA (y el impacto si lo hay) y ✓ ✕ ?; el antes/después completo y el
 * motivo, plegados en «Detalles» (se entiende desde el móvil en segundos). `consult(ref, btn)` = Consultar al CEO (abre la conversación).
 */
export function proposals(m, decide, consult = null, copy = null) {
  if (!m.propuestas?.length) return null;
  return h('div', { class: 'props' }, lbl(`CAMBIOS PROPUESTOS (${m.propuestas.length})`),
    m.propuestas.map((p) => h('article', { class: 'prop', 'data-ref': p.ref || null },
      // Con la explicación del CEO, lo técnico (campo, antes/después) queda plegado.
      explica(p.consejo, 'propuesta') ? null : h('p', { class: 'prop-field' }, '🔒 ', p.campo),
      explica(p.consejo, 'propuesta') ? null : h('p', { class: 'ln what' }, h('b', {}, 'QUÉ CAMBIA'), ' ', short(p.despues, 260)),
      explica(p.consejo, 'propuesta') || (p.impacto ? h('p', { class: 'ln' }, h('b', {}, 'IMPACTO'), ' ', short(p.impacto, 200)) : null),
      h('details', { class: 'prop-more', 'data-k': `prop-${p.id}` }, h('summary', {}, explica(p.consejo, 'propuesta') ? 'Detalle técnico' : 'Detalles'),
        h('p', { class: 'ln small' }, '🔒 ', p.campo),
        h('div', { class: 'prop-diff' },
          h('div', {}, h('small', {}, 'AHORA'), h('p', {}, p.antes)),
          h('div', {}, h('small', {}, 'PROPUESTO'), h('p', {}, p.despues))),
        p.motivo ? h('p', { class: 'ln' }, h('b', {}, 'MOTIVO'), ' ', p.motivo) : null,
        p.impacto && p.impacto.length > 200 ? h('p', { class: 'ln' }, h('b', {}, 'IMPACTO'), ' ', p.impacto) : null),
      explica(p.consejo, 'propuesta') ? null : advice(p.consejo),
      decideRow({ yes: (e) => decide(p.id, 'aprobar', e.currentTarget, p), no: (e) => decide(p.id, 'rechazar', e.currentTarget, p),
        yesLabel: p.consejo?.aprobar || 'Aplicar el cambio propuesto', noLabel: p.consejo?.rechazar || 'Dejar el mapa como está',
        alt: p.consejo?.alternativa ? (e) => decide(p.id, 'alternativa', e.currentTarget, p) : null, altLabel: p.consejo?.alternativa?.etiqueta, rec: p.consejo?.veredicto,
        ask: consult && p.ref ? (e) => consult(p.ref, e.currentTarget) : null }),
      // Otra instrucción = preguntar al CEO por otra vía (la alternativa sale de la conversación); no se pospone: no bloquea nada.
      comunes({ copy: copy && p.ref ? (b) => copy(p.ref, b) : null }))));
}

/** DECISIONES PENDIENTES de un proyecto: preguntas que sólo contesta Antonio: ✎ responder, ⏱ posponer, ? preguntar a Codex. */
export function pendingDecisions(list, { answer, postpone, consult = null, alternativa = null, copy = null }, title = true) {
  if (!list?.length) return null;
  return h('div', { class: 'dec-pend' }, title ? lbl(`DECISIONES PENDIENTES (${list.length})`) : null,
    h('ul', { class: 'mlist' }, list.map((d) => h('li', { class: 'dec-item', 'data-ref': d.ref || null },
      h('p', {}, '• ', d.pregunta),
      explica(d.consejo, 'pregunta') || advice(d.consejo),
      h('div', { class: 'dec-btns', role: 'group', 'aria-label': 'Decidir' },
        dbtn('✎', 'Responder', (e) => answer(d, e.currentTarget), 'yes'),
        alternativa && d.consejo?.alternativa && d.version ? dbtn('↺', `Responder: ${d.consejo.alternativa.etiqueta}`, (e) => alternativa(d, e.currentTarget), 'alt rec') : null,
        consult && d.ref ? dbtn('?', 'Consultar al CEO', (e) => consult(d.ref, e.currentTarget), 'ask') : null),
      // Una pregunta abierta: «otra instrucción» ES responder (✎), así que aquí sólo copiar y posponer.
      comunes({ copy: copy && d.ref ? (b) => copy(d.ref, b) : null, posponer: (b) => postpone(d, b) })))));
}

/** Vista de 20 segundos: qué queremos, dónde estamos, qué sigue y qué no se toca. */
export function mapPanel(m, { open, decide, answer, postpone, consult, alternativa, copy }) {
  if (!m) return null;
  if (m.error) return h('section', { class: 'panel map' }, h('h4', {}, 'MAPA DEL PROYECTO'), h('p', { class: 'note' }, m.error));
  const e = m.estado;
  return h('section', { class: 'panel map', 'aria-label': 'Mapa del proyecto' },
    h('header', { class: 'map-head' }, h('h4', {}, 'MAPA DEL PROYECTO'), h('small', { class: 'muted' }, `canon v${m.revision}`),
      h('button', { class: 'link', type: 'button', onclick: open }, 'Ver mapa completo')),
    m.definicion?.resumen ? [lbl('QUÉ ES'), h('p', { class: 'summary' }, m.definicion.resumen)] : null,
    lbl('MISIÓN DEL PROYECTO'),
    m.mision ? h('p', { class: 'mission' }, m.mision) : [h('p', { class: 'mission muted' }, 'Necesita revisión: la misión aún no está definida.'),
      m.preguntas.length ? h('p', { class: 'note' }, '? ', m.preguntas[0]) : null],
    h('div', { class: 'map-cols' }, COLS.map(([k, t]) => h('div', { class: 'map-col' },
      h('p', { class: 'lbl' }, `${t} ${e[k].length}`),
      e[k].length ? h('ul', { class: 'mlist st' }, e[k].slice(0, 3).map((it) => statusItem(k, it, false)), e[k].length > 3 ? h('li', { class: 'more' }, `+${e[k].length - 3} más`) : null)
        : h('p', { class: 'muted small' }, '—')))),
    e.bloqueado.length ? h('p', { class: 'note' }, '⛔ ', e.bloqueado[0].text) : null,
    m.reglas.length ? [lbl('REGLAS CLAVE'), h('ul', { class: 'mlist rules' }, m.reglas.slice(0, 3).map((r) => h('li', {}, '🔒 ', r)))] : null,
    pendingDecisions(m.pendientes, { answer, postpone, consult, alternativa, copy }),
    proposals(m, decide, consult, copy));
}

/** Flujo del sistema: cajas en vertical con flechas; las bifurcaciones, debajo de su paso. Sin librerías. */
function flow(steps) {
  return h('ol', { class: 'flow' }, steps.map((s) => h('li', {},
    h('span', { class: 'flow-step' }, s.step),
    s.branches.length ? h('ul', { class: 'flow-br' }, s.branches.map((b) => h('li', {}, h('b', {}, b.if), ' → ', b.then))) : null)));
}

const sec = (title, ...kids) => h('section', { class: 'msec' }, h('h3', {}, title), ...kids);
const line = (k, v) => (v ? h('p', { class: 'ln' }, h('b', {}, k), ' ', v) : null);

/** QUÉ ES Y QUÉ HACE: definición del proyecto y la lista completa de capacidades (existe / en desarrollo / planificado). */
function definition(d) {
  if (!d) return null;
  const n = d.actuales.reduce((s, g) => s + g.items.length, 0);
  return [
    sec('QUÉ ES', d.que_es || d.resumen ? h('p', {}, d.que_es || d.resumen) : null,
      line('FUNCIÓN PRINCIPAL', d.funcion), line('USUARIO PRINCIPAL', d.usuario), line('ESTADO', d.estado)),
    n ? sec(`QUÉ HACE HOY (${n})`, d.actuales.map((g) => [g.grupo ? lbl(g.grupo.toUpperCase()) : null, list(g.items, 'caps')])) : null,
    d.en_desarrollo.length ? sec(`EN DESARROLLO (${d.en_desarrollo.length})`, list(d.en_desarrollo)) : null,
    d.planificado.length ? sec(`PLANIFICADO (${d.planificado.length})`, list(d.planificado, 'plan')) : null,
    d.sin_verificar.length ? sec('SIN VERIFICAR', list(d.sin_verificar, 'warn')) : null,
  ];
}

/** Mapa completo (dentro del diálogo): todo el canon legible, en el orden de prioridad de Antonio. */
export function mapBody(m, decide, consult = null) {
  if (!m || m.error) return [h('p', { class: 'note' }, m?.error || 'Sin canon.')];
  const e = m.estado;
  const stat = (k, t) => sec(`${t} (${e[k].length})`, e[k].length ? h('ul', { class: 'mlist st' }, e[k].map((it) => statusItem(k, it, true))) : h('p', { class: 'muted' }, '—'));
  return [
    proposals(m, decide, consult),
    ...(definition(m.definicion) || []),
    sec('MISIÓN', m.mision ? h('p', { class: 'mission' }, m.mision) : h('p', { class: 'muted' }, 'Necesita revisión.'),
      m.criterios.length ? [lbl('CRITERIOS DE ÉXITO'), list(m.criterios)] : null),
    m.incluido.length || m.excluido.length ? sec('ALCANCE', m.incluido.length ? list(m.incluido) : null,
      m.excluido.length ? [lbl('FUERA DE ALCANCE'), list(m.excluido, 'out')] : null) : null,
    stat('en_curso', 'EN CURSO'), stat('falta', 'SIGUIENTE'), stat('hecho', 'HECHO'),
    e.bloqueado.length ? stat('bloqueado', 'BLOQUEOS') : null,
    m.flujo.length || m.componentes.length || m.reglas_operacion.length ? sec('FUNCIONAMIENTO',
      m.flujo.length ? flow(m.flujo) : null,
      m.componentes.length ? [lbl('COMPONENTES'), list(m.componentes)] : null,
      m.reglas_operacion.length ? [lbl('REGLAS DE OPERACIÓN'), list(m.reglas_operacion)] : null) : null,
    m.reglas.length ? sec('NO NEGOCIABLES', h('ul', { class: 'mlist rules' }, m.reglas.map((r) => h('li', {}, '🔒 ', r)))) : null,
    m.arquitectura.length ? sec('ARQUITECTURA APROBADA', h('ul', { class: 'mlist rules' }, m.arquitectura.map((r) => h('li', {}, '🔒 ', r)))) : null,
    m.decisiones.length ? sec('DECISIONES IMPORTANTES', h('ul', { class: 'mlist dec' }, m.decisiones.map((d) => h('li', {},
      d.protegida ? '🔒 ' : '', h('b', {}, d.texto), d.por_que ? h('span', { class: 'muted' }, ` — ${d.por_que}`) : null, d.fecha ? h('small', { class: 'muted' }, ` (${day(d.fecha) || d.fecha})`) : null)))) : null,
    m.conflictos.length ? sec('CONFLICTOS · NECESITA REVISIÓN', list(m.conflictos, 'warn')) : null,
    m.preguntas.length ? sec('PREGUNTAS ABIERTAS', list(m.preguntas)) : null,
    m.recursos.length ? sec('RECURSOS DISPONIBLES', h('ul', { class: 'mlist' }, m.recursos.map((r) => h('li', {}, h('b', {}, r.nombre), r.para ? ` — ${r.para}` : '')))) : null,
    m.resueltas.length ? sec('CAMBIOS RESUELTOS', list(m.resueltas.map((r) => `${r.campo}: ${r.estado}${r.fecha ? ` (${day(r.fecha)})` : ''}`))) : null,
    sec('FUENTES Y VERIFICACIÓN', m.fuentes.length ? list(m.fuentes) : null,
      h('p', { class: 'muted small' }, `Canon v${m.revision}${m.actualizado ? ` · actualizado ${day(m.actualizado)}` : ''}${m.verificado ? ` · verificado ${day(m.verificado)}` : ''}`)),
    h('details', { class: 'fold' }, h('summary', {}, 'Datos técnicos'),
      h('p', { class: 'mono' }, `id ${m.tecnico.id} · huella ${m.tecnico.hash} · esquema ${m.tecnico.schema}`)),
  ];
}
