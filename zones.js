// La oficina: en qué zona va cada proyecto y en qué orden. Sólo interfaz, determinista, a partir de los estados que
// ya existen (no cambia ningún estado interno ni se envía a ningún CEO). Sin DOM: se prueba en Node.

// Te necesita (decisión o algo que arreglar) · trabajando · esperando a un proveedor o en cola.
const NEEDS = ['ESPERANDO_DECISION', 'BLOQUEADO', 'ERROR', 'SIN_ACTIVIDAD'];
const WORKING = ['TRABAJANDO'];
const WAITING = ['ESPERANDO_CLAUDE', 'ESPERANDO_CEO', 'EN_COLA'];

/** 'marcha' | 'espera'. SIN OBJETIVO, PAUSADO, TERMINADO y CANCELADO esperan; el resto está en marcha. */
export const zone = (c) => ([...NEEDS, ...WORKING, ...WAITING].includes(c.estado) ? 'marcha' : 'espera');

/** 0 te necesita · 1 trabajando · 2 esperando proveedor/cola · 3 resto. */
export const priority = (c) => (NEEDS.includes(c.estado) ? 0 : WORKING.includes(c.estado) ? 1 : WAITING.includes(c.estado) ? 2 : 3);

/** Qué pinta el puesto: 'need' (ámbar/rojo), 'work' (verde), 'wait' (azul), 'idle'. */
export const mood = (c) => (c.estado === 'ERROR' || c.estado === 'BLOQUEADO' ? 'bad' : NEEDS.includes(c.estado) ? 'need'
  : WORKING.includes(c.estado) ? 'work' : WAITING.includes(c.estado) ? 'wait' : c.estado === 'TERMINADO' ? 'ok' : 'idle');

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
