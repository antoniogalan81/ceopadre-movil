// La oficina: en qué zona va cada proyecto y en qué orden. Sólo interfaz, determinista, a partir de los estados que
// ya existen (no cambia ningún estado interno ni se envía a ningún CEO). Sin DOM: se prueba en Node.

// Te necesita (decisión o algo que arreglar) · trabajando · esperando a un proveedor o en cola.
const NEEDS = ['ESPERANDO_DECISION', 'BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'];
const WORKING = ['TRABAJANDO'];
const WAITING = ['ESPERANDO_CLAUDE', 'ESPERANDO_CEO', 'EN_COLA'];

/** 'marcha' | 'espera'. SIN OBJETIVO, PAUSADO, LISTO (tu turno), TERMINADO y CANCELADO esperan; el resto está en marcha. */
export const zone = (c) => ([...NEEDS, ...WORKING, ...WAITING].includes(c.estado) ? 'marcha' : 'espera');

/** 0 te necesita · 1 trabajando · 2 esperando proveedor/cola · 3 resto. */
export const priority = (c) => (NEEDS.includes(c.estado) ? 0 : WORKING.includes(c.estado) ? 1 : WAITING.includes(c.estado) ? 2 : 3);

/** Qué pinta el puesto: 'need' (ámbar/rojo), 'work' (verde), 'wait' (azul), 'idle'. */
export const mood = (c) => (c.estado === 'ERROR' || c.estado === 'BLOQUEADO' ? 'bad' : NEEDS.includes(c.estado) ? 'need'
  : WORKING.includes(c.estado) ? 'work' : WAITING.includes(c.estado) ? 'wait' : ['TERMINADO', 'LISTO'].includes(c.estado) ? 'ok' : 'idle');

const recent = (c) => String(c.ultima_actividad || c.updated_at || c.usado || '');
const used = (c) => String(c.usado || '');

/** EN MARCHA: por prioridad y, dentro, la actividad más reciente primero. */
export const sortMarcha = (list) => [...list].sort((a, b) => priority(a) - priority(b) || recent(b).localeCompare(recent(a)));
/** EN ESPERA (y dentro de GESTIONES): último uso primero. */
export const sortEspera = (list) => [...list].sort((a, b) => used(b).localeCompare(used(a)));

/** Reparte las tarjetas en la oficina. Las gestiones viven dentro de GESTIONES, nunca sueltas. */
export function office(cards) {
  const projects = cards.filter((c) => c.tipo !== 'GESTION');
  const gestiones = sortEspera(cards.filter((c) => c.tipo === 'GESTION'));
  return {
    marcha: sortMarcha(projects.filter((c) => zone(c) === 'marcha')),
    espera: sortEspera(projects.filter((c) => zone(c) === 'espera')),
    gestiones,
    resumen: {
      total: gestiones.length,
      trabajando: gestiones.filter((c) => WORKING.includes(c.estado)).length,
      necesita: gestiones.filter((c) => NEEDS.includes(c.estado)).length,
      esperando: gestiones.filter((c) => WAITING.includes(c.estado)).length,
    },
  };
}

/** «4 gestiones · 2 trabajando · 1 te necesita». */
export function gestText(r) {
  const n = (k, one, many) => (r[k] ? `${r[k]} ${r[k] === 1 ? one : many}` : '');
  return [`${r.total} ${r.total === 1 ? 'gestión' : 'gestiones'}`, n('trabajando', 'trabajando', 'trabajando'),
    n('necesita', 'te necesita', 'te necesitan'), n('esperando', 'esperando', 'esperando')].filter(Boolean).join(' · ');
}

/**
 * Indicador de conexión. En el PC: la API local responde o no. En el móvil: sin red en el navegador o sin respuesta de
 * Supabase → «Sin internet»; con red pero sin latido reciente del PC → «PC desconectado»; si no, «Operativo».
 */
export function netStatus({ local, browserOnline, reachable, pcOnline }) {
  if (local) return reachable ? ['ok', 'Operativo'] : ['bad', 'CEOPadre no responde'];
  if (!browserOnline || !reachable) return ['bad', 'Sin internet'];
  return pcOnline ? ['ok', 'Operativo'] : ['need', 'PC desconectado'];
}

// Reinicio en hora local: «15:36» si es hoy, «jue 12:27» si no. Sin dato → '—'.
export function resetText(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t), hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} ${hm}`;
}

/**
 * Cuota (filas de src/usage.js quotaRows: provider, used_percent, available_percent, reset_at, updated_at) lista para
 * pintar al pulsar el icono. `max` = el % usado más alto (lo único que se ve sin abrir). Sin datos → null.
 */
export function quotaView(rows, now = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Number.isFinite(r?.used_percent));
  if (!list.length) return null;
  const times = list.map((r) => Date.parse(r.updated_at || '')).filter(Number.isFinite);
  return {
    max: Math.max(...list.map((r) => r.used_percent)),
    filas: list.map((r) => ({ nombre: r.provider, usado: `${r.used_percent} %`, disponible: `${r.available_percent} %`, reinicio: resetText(r.reset_at, now) })),
    leida: times.length ? new Date(Math.min(...times)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '',
  };
}

// Límite PRÁCTICO de un prompt para Claude (no uno de interfaz): lo aplican el PC y el editor. Nunca se recorta.
// ponytail: fijo (~200k tokens de texto); si Claude admite más contexto, se sube aquí y vale para todo.
export const PROMPT_LIMIT = 800_000;
export const PROMPT_WARN = 400_000;
