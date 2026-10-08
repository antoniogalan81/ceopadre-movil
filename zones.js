// La oficina: en qué zona va cada proyecto y en qué orden. Sólo interfaz, determinista, a partir de los estados que
// ya existen (no cambia ningún estado interno ni se envía a ningún CEO). Sin DOM: se prueba en Node.

// Te necesita (decisión o algo que arreglar) · trabajando · esperando a un proveedor o en cola.
// SIN_ACTIVIDAD es trabajo en curso: si el proceso sigue callado, CEOPadre lo corta y lo reintenta solo.
const NEEDS = ['ESPERANDO_DECISION', 'BLOQUEADO', 'ERROR'];
const WORKING = ['TRABAJANDO', 'SIN_ACTIVIDAD'];
const WAITING = ['ESPERANDO_CLAUDE', 'ESPERANDO_CEO', 'EN_COLA'];

/**
 * DECISIONES DE ANTONIO de una tarjeta: la del objetivo (ESPERANDO_DECISION), las preguntas del canon y los cambios
 * protegidos propuestos (APROBAR/RECHAZAR). Cualquiera de ellas manda sobre el estado del objetivo: la tarjeta dice
 * «ESPERANDO TU DECISIÓN» aunque el objetivo esté trabajando o esperando una condición.
 */
export const decisionCount = (c) => (c.estado === 'ESPERANDO_DECISION' ? 1 : 0) + (c.decisiones?.length || 0) + (c.propuestas?.length || 0);
export const needsDecision = (c) => decisionCount(c) > 0;
const needs = (c) => needsDecision(c) || NEEDS.includes(c.estado);

/** 'marcha' | 'espera'. SIN OBJETIVO, PAUSADO, LISTO (tu turno), TERMINADO y CANCELADO esperan; el resto está en marcha. */
export const zone = (c) => (needs(c) || [...WORKING, ...WAITING].includes(c.estado) ? 'marcha' : 'espera');

/** 0 te necesita · 1 trabajando · 2 esperando proveedor/cola · 3 resto. */
export const priority = (c) => (needs(c) ? 0 : WORKING.includes(c.estado) ? 1 : WAITING.includes(c.estado) ? 2 : 3);

/** Qué pinta el puesto: 'need' (ámbar/rojo), 'work' (verde), 'wait' (azul), 'idle'. ESPERANDO_CONDICION (monitorizado) es
 * azul pero va a EN ESPERA: no ocupa el hueco ni necesita a nadie. Una decisión pendiente siempre es 'need'. */
export const mood = (c) => (needsDecision(c) ? 'need' : c.estado === 'ERROR' || c.estado === 'BLOQUEADO' ? 'bad' : NEEDS.includes(c.estado) ? 'need'
  : WORKING.includes(c.estado) ? 'work' : WAITING.includes(c.estado) || c.estado === 'ESPERANDO_CONDICION' ? 'wait' : ['TERMINADO', 'LISTO'].includes(c.estado) ? 'ok' : 'idle');

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
      trabajando: gestiones.filter((c) => !needs(c) && WORKING.includes(c.estado)).length,
      necesita: gestiones.filter(needs).length,
      esperando: gestiones.filter((c) => !needs(c) && WAITING.includes(c.estado)).length,
      decisiones: cards.reduce((a, c) => a + decisionCount(c), 0), // aviso global: todas, proyectos y gestiones
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
 * Cuota (filas de src/usage.js quotaRows: provider, used_percent, available_percent, reset_at, updated_at, error) lista para
 * pintar al pulsar el icono. `max` = el % usado más alto (lo único que se ve sin abrir). Sin datos → null.
 */
export function quotaView(rows, now = Date.now()) {
  const all = Array.isArray(rows) ? rows : [];
  const list = all.filter((r) => Number.isFinite(r?.used_percent));
  if (!list.length) return null;
  // Hora de lectura POR proveedor (cada uno se lee por separado; «lun 21:39» si no es de hoy) y, si su último intento en
  // vivo falló, el aviso: ese dato es el anterior, nunca uno re-sellado.
  const prov = new Map();
  for (const r of list) {
    const k = r.provider.split(' ')[0], name = k[0] + k.slice(1).toLowerCase();
    if (!prov.has(k)) prov.set(k, { hora: `${name} ${resetText(r.updated_at, now)}`, aviso: r.error ? `${name} sin actualizar: ${r.error}` : '' });
  }
  return {
    max: Math.max(...list.map((r) => r.used_percent)),
    // Fila sin % (p. ej. «CODEX MES»: el proveedor no la informa) → se enseña como no disponible, sin inventar cifra.
    filas: all.filter((r) => r?.provider).map((r) => (Number.isFinite(r.used_percent)
      ? { nombre: r.provider, usado: `${r.used_percent} %`, disponible: `${r.available_percent} %`, reinicio: resetText(r.reset_at, now) }
      : { nombre: r.provider, usado: '—', disponible: 'No disponible', reinicio: '—' })),
    leida: [...prov.values()].map((p) => p.hora).join(' · '),
    avisos: [...prov.values()].map((p) => p.aviso).filter(Boolean),
  };
}

// Límite PRÁCTICO de un prompt para Claude (no uno de interfaz): lo aplican el PC y el editor. Nunca se recorta.
// ponytail: fijo (~200k tokens de texto); si Claude admite más contexto, se sube aquí y vale para todo.
export const PROMPT_LIMIT = 800_000;
export const PROMPT_WARN = 400_000;

// PC vivo = latido sellado por el reloj de Supabase hace menos de `tolerancia` (el PC late cada 20 s). Un sello
// «del futuro» por un desfase pequeño del reloj del teléfono cuenta como reciente; uno muy futuro o ilegible, no.
export const PC_ONLINE_MS = 60_000;
export function pcOnline(vistoEn, now = Date.now(), tolerancia = PC_ONLINE_MS) {
  const t = Date.parse(vistoEn || '');
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age < tolerancia && age > -5 * 60_000;
}

/**
 * CONDICIONES EN ESPERA de todas las tarjetas (proyectos y gestiones), de la misma fuente que la tarjeta: `condicion`
 * del objetivo mostrado (esperas ACTIVAS en SQLite, texto completo) y `esperando[]` (otros objetivos monitorizados).
 * Sin copia propia: si la espera se resuelve o cambia en el PC, la próxima tarjeta ya no la trae o la trae cambiada.
 */
export function waitingConditions(cards) {
  return (cards || []).flatMap((c) => [
    ...(c.estado === 'ESPERANDO_CONDICION' && c.condicion ? [{ trabajo: c.trabajo, principal: true, condicion: c.condicion }] : []),
    ...(c.esperando || []).filter((x) => x.condicion).map((x) => ({ trabajo: x.trabajo, principal: false, condicion: x.condicion, objetivo: x.objetivo })),
  ].map((x) => ({ ...x, id: c.id, proyecto: c.nombre, estado: c.estado, decide: needsDecision(c) })));
}

/** COPIAR TODAS: «NOMBRE\n<condición>» separadas por una línea en blanco. */
export const conditionsText = (list) => list.map((x) => `${String(x.proyecto).toUpperCase()}\n${x.condicion}`).join('\n\n');

/**
 * ⧉ COPIAR TODAS LAS DECISIONES: las que de verdad esperan a Antonio (las mismas que cuenta decisionCount), en texto
 * compacto para pegar en ChatGPT: proyecto, decisión, contexto mínimo y opciones. Sin ids, rutas ni estados internos.
 * Devuelve { n, texto }.
 */
const one = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const VER = { APROBAR: '✓ aprobar', RECHAZAR: '✕ rechazar', RESPONDER: 'responder' };
const codex = (c) => (c?.estado === 'OK' && c.motivo ? `Recomendación de Codex: ${VER[c.veredicto] || c.veredicto}${c.respuesta ? ` («${one(c.respuesta, 200)}»)` : ''} — ${one(c.motivo, 240)}` : '');
export function decisionsText(cards, fecha = new Date()) {
  const items = [];
  for (const c of cards || []) {
    const goal = c.objetivo ? `Objetivo actual: ${one(String(c.objetivo).split('\n')[0], 140)}` : '';
    if (c.estado === 'ESPERANDO_DECISION') {
      const [rec, opts] = String(c.recomendacion || '').split(/\n?OPCIONES:\n?/);
      items.push([c.nombre, `Decisión: ${one(c.propuesta, 300)}`, [goal, rec && `Recomendación del CEO: ${one(rec, 300)}`,
        opts ? `Opciones: ${opts.split('\n').map((x) => one(x, 160)).filter(Boolean).join(' | ')}` : 'Opciones: aprobar | rechazar', codex(c.consejo)]]);
    }
    for (const p of c.propuestas || []) {
      items.push([c.nombre, `Cambio de un campo protegido (${p.campo})`, [`Ahora: ${one(p.antes, 300)}`, `Propuesto: ${one(p.despues, 400)}`,
        p.motivo && `Motivo: ${one(p.motivo, 300)}`, p.impacto && `Impacto: ${one(p.impacto, 300)}`, 'Opciones: aprobar | rechazar', codex(p.consejo)]]);
    }
    for (const d of c.decisiones || []) items.push([c.nombre, `Pregunta: ${one(d.pregunta, 400)}`, [goal, codex(d.consejo)]]);
  }
  const day = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const texto = [`DECISIONES PENDIENTES DE ANTONIO (${items.length}) · CEOPadre · ${day}`,
    ...items.map(([p, t, ctx], i) => [`${i + 1}. [${p}] ${t}`, ...ctx.filter(Boolean).map((x) => `   ${x}`)].join('\n'))].join('\n\n');
  return { n: items.length, texto };
}

// ÓRDENES POTENTES: texto libre que llega a Claude (que puede ejecutar código en el PC). Desde el móvil exigen, además de
// ser el dueño (RLS), confirmación expresa y una contraseña escrita hace menos de REAUTH_MS (modo seguro): una sesión
// robada no basta. El resto de órdenes (aprobar, pausar, mando remoto cerrado…) siguen como siempre. Lista única: la usan
// el PC (src/sync.js, src/commands.js) y el móvil (web/app.js).
export const HIGH_RISK = new Set(['objetivo.iniciar', 'objetivo.anadir', 'trabajo.instruccion', 'pendiente.editar']);
export const REAUTH_MS = 30 * 60_000;
/** Hora (ms) de la última vez que esta sesión se abrió CON CONTRASEÑA, leída del token (amr). 0 si no consta. */
export function passwordAt(accessToken) {
  try {
    const b64 = String(accessToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8'));
    return Math.max(0, ...(c.amr || []).filter((a) => a.method === 'password').map((a) => Number(a.timestamp) * 1000));
  } catch { return 0; }
}
