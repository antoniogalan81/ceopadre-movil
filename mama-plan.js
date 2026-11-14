// MAMA · «Plan del día» (T24) para la sección Mama. Pinta SÓLO el resumen de src/mama-plan.js resumenPlan() (contrato en
// knowledge/mama/PLAN-DIARIO-T24.md §3): cruciales (máx. 2), lista por consecuencias A/B/C, atrasadas y olvidadas. Sin estilos
// propios (reutiliza a-card/a-chip de style.css) y sin innerHTML. La integración en web/mama.js está PENDIENTE (archivo de T15).
import { h } from './dom.js';

const CLASE = { A: ['A · consecuencias graves', 'bad'], B: ['B · importante', 'ask'], C: ['C · próximos días', 'idle'] };
const AHORA = { HECHA: ['Hecha', 'ok'], RETIRADA: ['Retirada', 'idle'] };
const IA = { OK: 'Redactado por MAMA', FALLO: 'Sin redacción de MAMA hoy', TOPE: 'Sin redacción: tope diario de MAMA' };
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);
const dia = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

function fila(x) {
  const [c, tone] = CLASE[x.clase] || [x.clase, 'idle'];
  const estado = AHORA[x.ahora];
  return h('li', { class: `mama-plan-item${estado ? ' hecho' : ''}`, 'data-ref': x.ref, 'data-clase': x.clase },
    chip(c, tone), ' ', estado ? [chip(estado[0], estado[1]), ' '] : null,
    h('strong', {}, x.titulo), x.cuando ? h('span', { class: 'muted small' }, ` · ${x.cuando}`) : null,
    h('p', { class: 'muted small' }, x.consecuencia), x.porque ? h('p', { class: 'small' }, x.porque) : null);
}

/** Tarjeta del plan. `r` = resumenPlan(). Devuelve un nodo. */
export function planDia(r) {
  const titulo = h('h3', {}, `Plan del ${r?.dia ? dia(r.dia) : 'día'}`, r?.vispera ? h('span', { class: 'muted small' }, ' · preparado la víspera') : null);
  if (!r || r.estado === 'SIN_PLAN') return h('section', { class: 'a-card mama-plan', 'aria-label': 'Plan del día', 'data-estado': 'SIN_PLAN' }, titulo, h('p', { class: 'muted' }, 'Aún no hay plan para este día.'));
  if (r.estado === 'SIN_DATOS') return h('section', { class: 'a-card mama-plan', 'aria-label': 'Plan del día', 'data-estado': 'SIN_DATOS' }, titulo,
    h('p', { class: 'muted' }, 'No hay obligaciones, compromisos ni decisiones pendientes para este día. No me invento ninguna.'));
  const otras = r.lista.filter((x) => !r.cruciales.some((c) => c.ref === x.ref));
  const c = r.cuentas || {};
  return h('section', { class: `a-card mama-plan t-${r.cruciales.some((x) => x.clase === 'A') ? 'bad' : 'ask'}`, 'aria-label': 'Plan del día', 'data-estado': r.estado },
    titulo, r.nota ? h('p', {}, r.nota) : null,
    h('h4', {}, `Lo crucial (${r.cruciales.length})`), r.cruciales.length ? h('ol', { class: 'mama-plan-cruciales' }, r.cruciales.map(fila)) : h('p', { class: 'muted' }, 'Nada crucial: no hay obligaciones A ni B.'),
    otras.length ? [h('h4', {}, 'Después'), h('ul', { class: 'mama-plan-lista' }, otras.map(fila))] : null,
    r.resto ? h('p', { class: 'muted small' }, `y ${r.resto} más`) : null,
    r.olvidadas?.length ? [h('h4', {}, `Atrasadas hace tiempo (${c.olvidadas})`), h('ul', { class: 'mama-plan-olvidadas' }, r.olvidadas.map(fila)),
      h('p', { class: 'muted small' }, 'Dime si siguen en pie, las pospongo o las retiro.')] : null,
    h('p', { class: 'muted small' }, `A ${c.A ?? 0} · B ${c.B ?? 0} · C ${c.C ?? 0} · atrasadas ${c.atrasadas ?? 0}${IA[r.ia?.estado] ? ` · ${IA[r.ia.estado]}` : ''}`));
}
