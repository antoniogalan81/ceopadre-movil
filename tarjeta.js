// TARJETA COMPACTA (V3.9.1): la ÚNICA presentación de una tarjeta de catálogo (agentes, alquileres, objetivos). Nombre,
// línea de proyecto/categoría, qué hace en 2 líneas, estado real y UNA acción principal. Pulsar el resto de la tarjeta (o
// Enter/Espacio con el foco en ella) abre su ficha. Cada tipo pone su lógica; el formato es siempre éste, así no vuelven a
// aparecer tarjetas grandes o distintas. Estilos: .ag-mini en web/style.css.
import { h } from './dom.js';

/**
 * @param {{ id: string, titulo: string, sub?: string, desc?: string, estado: [string, string], accion?: { txt: string, on: (b: HTMLButtonElement) => void, cls?: string, disabled?: boolean },
 *   abrir: () => void, extra?: Node | null, clase?: string }} o
 */
export function miniTarjeta({ id, titulo, sub = '', desc = '', estado, accion = null, abrir, extra = null, clase = '' }) {
  const [label, tone] = estado;
  const el = h('article', { class: `ag-mini ${clase} t-${tone}`.replace(/\s+/g, ' '), 'data-id': id, tabindex: '0', role: 'button', 'aria-label': `${titulo}${sub ? ` · ${sub}` : ''} · ${label}. Abrir ficha` },
    h('div', { class: 'ag-mini-top' }, h('h3', { title: titulo }, titulo), h('span', { class: `a-chip t-${tone}` }, label)),
    h('p', { class: 'ag-mini-proj muted' }, sub),
    h('p', { class: 'ag-mini-desc' }, desc || 'Sin descripción'),
    extra,
    accion ? h('div', { class: 'ag-mini-act' }, h('button', { class: `btn ${accion.cls || 'ghost'} small`, type: 'button', disabled: !!accion.disabled,
      onclick: (e) => { e.stopPropagation(); accion.on(e.currentTarget); } }, accion.txt)) : null);
  el.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, summary')) abrir(); });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); abrir(); } });
  return el;
}
