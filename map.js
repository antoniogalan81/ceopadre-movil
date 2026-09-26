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

/** CAMBIOS PROPUESTOS a lo protegido: antes → después, motivo, impacto y la decisión de Antonio. */
export function proposals(m, decide) {
  if (!m.propuestas?.length) return null;
  return h('div', { class: 'props' }, lbl(`CAMBIOS PROPUESTOS (${m.propuestas.length})`),
    m.propuestas.map((p) => h('article', { class: 'prop' },
      h('p', { class: 'prop-field' }, '🔒 ', p.campo),
      h('div', { class: 'prop-diff' },
        h('div', {}, h('small', {}, 'AHORA'), h('p', {}, p.antes)),
        h('div', {}, h('small', {}, 'PROPUESTO'), h('p', {}, p.despues))),
      p.motivo ? h('p', { class: 'ln' }, h('b', {}, 'MOTIVO'), ' ', p.motivo) : null,
      p.impacto ? h('p', { class: 'ln' }, h('b', {}, 'IMPACTO'), ' ', p.impacto) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', type: 'button', onclick: (e) => decide(p.id, 'aprobar', e.currentTarget) }, 'APROBAR'),
        h('button', { class: 'btn small', type: 'button', onclick: (e) => decide(p.id, 'rechazar', e.currentTarget) }, 'RECHAZAR')))));
}

/** Vista de 20 segundos: qué queremos, dónde estamos, qué sigue y qué no se toca. */
export function mapPanel(m, { open, decide }) {
  if (!m) return null;
  if (m.error) return h('section', { class: 'panel map' }, h('h4', {}, 'MAPA DEL PROYECTO'), h('p', { class: 'note' }, m.error));
  const e = m.estado;
  return h('section', { class: 'panel map', 'aria-label': 'Mapa del proyecto' },
    h('header', { class: 'map-head' }, h('h4', {}, 'MAPA DEL PROYECTO'), h('small', { class: 'muted' }, `canon v${m.revision}`),
      h('button', { class: 'link', type: 'button', onclick: open }, 'Ver mapa completo')),
    lbl('MISIÓN DEL PROYECTO'),
    m.mision ? h('p', { class: 'mission' }, m.mision) : [h('p', { class: 'mission muted' }, 'Necesita revisión: la misión aún no está definida.'),
      m.preguntas.length ? h('p', { class: 'note' }, '? ', m.preguntas[0]) : null],
    h('div', { class: 'map-cols' }, COLS.map(([k, t]) => h('div', { class: 'map-col' },
      h('p', { class: 'lbl' }, `${t} ${e[k].length}`),
      e[k].length ? h('ul', { class: 'mlist st' }, e[k].slice(0, 3).map((it) => statusItem(k, it, false)), e[k].length > 3 ? h('li', { class: 'more' }, `+${e[k].length - 3} más`) : null)
        : h('p', { class: 'muted small' }, '—')))),
    e.bloqueado.length ? h('p', { class: 'note' }, '⛔ ', e.bloqueado[0].text) : null,
    m.reglas.length ? [lbl('REGLAS CLAVE'), h('ul', { class: 'mlist rules' }, m.reglas.slice(0, 3).map((r) => h('li', {}, '🔒 ', r)))] : null,
    proposals(m, decide));
}

/** Flujo del sistema: cajas en vertical con flechas; las bifurcaciones, debajo de su paso. Sin librerías. */
function flow(steps) {
  return h('ol', { class: 'flow' }, steps.map((s) => h('li', {},
    h('span', { class: 'flow-step' }, s.step),
    s.branches.length ? h('ul', { class: 'flow-br' }, s.branches.map((b) => h('li', {}, h('b', {}, b.if), ' → ', b.then))) : null)));
}

const sec = (title, ...kids) => h('section', { class: 'msec' }, h('h3', {}, title), ...kids);

/** Mapa completo (dentro del diálogo): todo el canon legible, en el orden de prioridad de Antonio. */
export function mapBody(m, decide) {
  if (!m || m.error) return [h('p', { class: 'note' }, m?.error || 'Sin canon.')];
  const e = m.estado;
  const stat = (k, t) => sec(`${t} (${e[k].length})`, e[k].length ? h('ul', { class: 'mlist st' }, e[k].map((it) => statusItem(k, it, true))) : h('p', { class: 'muted' }, '—'));
  return [
    proposals(m, decide),
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
