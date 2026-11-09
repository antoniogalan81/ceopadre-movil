// La oficina: en qué zona va cada proyecto y en qué orden. Sólo interfaz, determinista, a partir de los estados que
// ya existen (no cambia ningún estado interno ni se envía a ningún CEO). Sin DOM: se prueba en Node.

// Te necesita (decisión o algo que arreglar) · trabajando · esperando a un proveedor o en cola.
// SIN_ACTIVIDAD es trabajo en curso: si el proceso sigue callado, CEOPadre lo corta y lo reintenta solo.
// ESPERANDO_ANTONIO = espera una acción que sólo puede hacer Antonio (renovar un permiso, escuchar…): le necesita.
const NEEDS = ['ESPERANDO_DECISION', 'ESPERANDO_ANTONIO', 'BLOQUEADO', 'ERROR'];
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
// También: guardar un procedimiento de automatización (texto que ejecutará Claude) y aprobar envíos a terceros (bandeja).
export const HIGH_RISK = new Set(['objetivo.iniciar', 'objetivo.anadir', 'trabajo.instruccion', 'pendiente.editar', 'automatizacion.guardar', 'bandeja.aprobar',
  // Ponen a trabajar a Claude en el PC sin pulsar ▶ (horario, revisión, objetivos de negocio): las mismas garantías.
  'automatizacion.programar', 'proyecto.revisar', 'negocio.crear', 'negocio.aprobar', 'negocio.responder', 'negocio.reanudar',
  // V3.5: también dan trabajo a Claude (instrucción en caliente, necesidad resuelta, reanudar un proyecto) o amplían lo que el
  // CEO puede hacer solo (autorización delimitada).
  'negocio.instruccion', 'negocio.necesidad', 'proyecto.reanudar', 'autorizacion.crear',
  // V3.6: aplicar un cambio pedido en la conversación con el CEO (da trabajo a Claude).
  'ceo.aplicar',
  // V3.7: elegir la alternativa del CEO en una decisión (da trabajo nuevo a Claude). Aprobar/rechazar siguen como en la tarjeta.
  'decision.alternativa',
  // V3.10: unificar o cerrar lo pendiente de Antonio (cierra preguntas y entrega respuestas a trabajos).
  'negocio.conciliar']);
// V3.11: qué pasa con cada botón de una NECESIDAD de objetivo (lo que hace negocio.necesidad). La usan el CEO
// (src/conversacion.js) y la ventana de detalles (web/negocio.js): las dos dicen lo mismo.
export const EFECTOS_NEC = {
  CAPACIDAD: { boton: 'Incorporar al catálogo', si_apruebo: 'Se añade al catálogo del HUB como conocimiento: no se instala, contrata ni transmite nada.', si_rechazo: 'No se añade; el director sigue sin ella.' },
  AUTOMATIZACION: { boton: 'Activar la automatización', si_apruebo: 'Se activa la automatización con su horario (visible y pausable en Agentes).', si_rechazo: 'Queda desactivada; el director replanifica sin ella.' },
  KPI: { boton: 'Aprobar este comando', si_apruebo: 'CEOPadre empieza a medir ese indicador con ese comando.', si_rechazo: 'No se ejecuta ese comando; el indicador queda sin medir.' },
  CONEXION: { boton: 'Ya la he conectado', si_apruebo: 'Se comprueba que la cuenta está conectada (conéctala antes en Conexiones, en el PC).', si_rechazo: 'El director replanifica sin esa cuenta.' },
  ACCION: { boton: 'Ya lo he hecho', si_apruebo: 'Le dices que ya está hecho y el director sigue con lo que dependía de ello.', si_rechazo: 'No lo harás: el director replanifica sin ello.' },
  DATO: { boton: 'Responder', si_apruebo: null, si_rechazo: 'No lo darás: el director replanifica sin ese dato.' },
  DECISION: { boton: 'Responder', si_apruebo: null, si_rechazo: 'No decides eso: el director replanifica sin ello.' },
};
/** V3.11: potente por la orden o por lo que decide: aprobar/rechazar una NECESIDAD de un objetivo desde la conversación o la
 *  tarjeta (decision.resolver con ref necesidad:…) da trabajo al director igual que negocio.necesidad. */
export const esPotente = (op, params) => HIGH_RISK.has(op) || (op === 'decision.resolver' && /^necesidad:/.test(String(params?.ref || '')));
export const REAUTH_MS = 30 * 60_000;
/** Hora (ms) de la última vez que esta sesión se abrió CON CONTRASEÑA, leída del token (amr). 0 si no consta. */
export function passwordAt(accessToken) {
  try {
    const b64 = String(accessToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8'));
    return Math.max(0, ...(c.amr || []).filter((a) => a.method === 'password').map((a) => Number(a.timestamp) * 1000));
  } catch { return 0; }
}


// ------------------------------------------------------------------ CENTRO DE DIRECCIÓN (pantalla principal, V3.3)
// Cada trabajo tiene UN estado principal y sale en UNA sección (los contadores no se inflan):
//   necesita tu intervención · con problemas · trabajando · esperando algo externo · próximos · terminado y comprobado.
// Sólo estados reales del motor (nada estimado). Sin DOM: se prueba en Node (test/v32 y v33).
// Te necesitan aunque no sea una pregunta: una acción tuya, tu turno, o la cuota agotada (nunca se reanuda solo: CONTINUAR).
const TU_TURNO = ['ESPERANDO_ANTONIO', 'LISTO', 'ESPERANDO_CLAUDE', 'ESPERANDO_CEO'];
const PROBLEMA = ['ERROR', 'BLOQUEADO'];
const DIA = 86_400_000;
const tms = (c) => Date.parse(c.updated_at || c.ultima_actividad || c.usado || '') || 0;
export function seccion(c) {
  if (needsDecision(c) || TU_TURNO.includes(c.estado)) return 'necesita';
  if (PROBLEMA.includes(c.estado)) return 'problema';
  if (WORKING.includes(c.estado)) return 'trabajando';
  if (c.estado === 'ESPERANDO_CONDICION') return 'esperando';
  if (c.estado === 'EN_COLA') return 'proximo';
  if (c.estado === 'TERMINADO') return 'terminado';
  return 'reposo'; // LIBRE, PAUSADO, CANCELADO
}
export function direccion(cards, now = Date.now()) {
  const by = (s) => sortMarcha(cards.filter((c) => seccion(c) === s));
  const necesita = by('necesita'), problemas = by('problema'), trabajando = by('trabajando');
  // Esperando algo externo: el objetivo que enseña la tarjeta y los OTROS objetivos del proyecto que esperan (sin repetir tarjeta).
  const esperando = [...by('esperando').map((c) => ({ c, trabajo: c.trabajo, objetivo: c.objetivo, esperas: c.esperas_info || [], condicion: c.condicion })),
    ...cards.flatMap((c) => (c.esperando || []).filter((x) => !x.te_necesita).map((x) => ({ c, trabajo: x.trabajo, objetivo: x.objetivo, esperas: [], condicion: x.condicion, otro: true })))];
  // Otro objetivo del proyecto que espera algo que SÓLO puede hacer Antonio: le necesita (no es «externo»).
  const tuyas = cards.flatMap((c) => (c.esperando || []).filter((x) => x.te_necesita).map((x) => ({ c, trabajo: x.trabajo, objetivo: x.objetivo, condicion: x.condicion })));
  const terminados = cards.filter((c) => c.estado === 'TERMINADO').sort((a, b) => tms(b) - tms(a));
  const autos = cards.flatMap((c) => (c.automatizaciones || []).map((a) => ({ ...a, proyectoNombre: c.nombre, proyectoId: c.id })));
  const programadas = autos.filter((a) => a.programa?.proxima).sort((a, b) => a.programa.proxima.localeCompare(b.programa.proxima));
  const pausadas = autos.filter((a) => a.programa && !a.programa.proxima); // con horario, pero en pausa (se dice, no se esconde)
  const autosHechas = autos.filter((a) => a.ultima?.estado === 'COMPLETADA' && a.ultima.fin && now - Date.parse(a.ultima.fin) < 7 * DIA)
    .sort((a, b) => b.ultima.fin.localeCompare(a.ultima.fin));
  // Próximos = SÓLO lo programado o preparado para empezar (nunca una espera: ésa tiene su sección).
  const proximos = [
    ...programadas.map((a) => ({ tipo: 'auto', cuando: a.programa.proxima, titulo: a.nombre, para: a.descripcion, proyecto: a.proyectoNombre, id: a.proyectoId })),
    ...by('proximo').map((c) => ({ tipo: 'cola', titulo: c.objetivo, para: 'Empieza en cuanto termine lo que está en marcha en el proyecto', proyecto: c.nombre, id: c.id })),
    ...cards.filter((c) => c.cola > 0 && c.estado !== 'EN_COLA').map((c) => ({ tipo: 'cola', titulo: `${c.cola} objetivo${c.cola === 1 ? '' : 's'} más en cola`, para: 'Empiezan uno detrás de otro', proyecto: c.nombre, id: c.id })),
  ];
  const activo = (c) => (c.automatizaciones || []).length > 0 || seccion(c) !== 'reposo' && (c.estado !== 'TERMINADO' || now - tms(c) < 30 * DIA);
  const proyectos = cards.filter((c) => c.tipo !== 'GESTION');
  const decisiones = cards.reduce((a, c) => a + decisionCount(c), 0);
  const aprobaciones = cards.reduce((a, c) => a + (c.aprobaciones || 0), 0);
  return {
    necesita, tuyas, problemas, trabajando, esperando, terminados: terminados.slice(0, 5), autosHechas: autosHechas.slice(0, 4), programadas, pausadas, autos, proximos,
    // Compatibles con V3.2 (pantalla de proyectos): los que tienen historia y los que están en reposo.
    conHistoria: sortEspera(proyectos.filter(activo)), sinActividad: sortEspera(proyectos.filter((c) => !activo(c))),
    kpis: {
      decisiones, aprobaciones, necesita: necesita.length, problemas: problemas.length, trabajando: trabajando.length,
      claude: trabajando.filter((c) => c.estado === 'TRABAJANDO' && c.actividad).length, esperando: esperando.length,
      terminados7: terminados.filter((c) => now - tms(c) < 7 * DIA).length, programadas: programadas.length, proxima: programadas[0] || null,
      proyectos: proyectos.length, inactivos: proyectos.filter((c) => !activo(c)).length, agentes: autos.length,
    },
  };
}

// «GOAL — COMPLETAR SALDOS…» → «Completar saldos…»: el objetivo en lenguaje normal (el texto original sigue en la ficha).
export function cleanGoal(t) {
  const s = String(t || '').replace(/^\s*#*\s*(GOAL|OBJETIVO)\s*[—:–-]+\s*/i, '').split('\n')[0].trim();
  return s && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{4}/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

// Una espera en lenguaje normal: título corto, qué se espera y qué pasará al cumplirse. Sin nombres de scripts ni rutas.
// El texto técnico original sigue en la ficha del proyecto.
const TECH = /\s*\(([^)]*\b(I-\d|A-\d|\.md|\.py|\.json|\.log)[^)]*)\)/gi;
const SCRIPT = /\b[\w./\\-]+\.(?:py|mjs|js|ps1|cmd|bat|sh)\b(?:\s+--?[\w-]+)*/gi;
export function esperaHumana(descripcion = '') {
  const d = String(descripcion || '');
  const [antes, despues = ''] = d.split(/\s*Al cumplirse\s*:?\s*/i);
  const que = antes.replace(TECH, '').replace(SCRIPT, 'el proceso del proyecto').replace(/'([^']+)'/g, '«$1»').replace(/\s+/g, ' ').trim();
  const low = d.toLowerCase();
  const titulo = /document|extracto|certificad|justificante|factura|pdf/.test(low) ? `Esperando documentos${/banc/.test(low) ? ' bancarios' : ''}`
    : /respuesta|conteste|contesta|responda/.test(low) ? 'Esperando una respuesta'
      : /permiso|token|autoriz|credencial|contraseña/.test(low) ? 'Esperando un permiso'
        : /commit|versi[oó]n|reinici|despleg/.test(low) ? 'Esperando una actualización'
          : /objetivo|dependencia|termine el/.test(low) ? 'Esperando otro trabajo'
            : /\b(hora|fecha|d[ií]a|lunes|martes|mi[eé]rcoles|jueves|viernes|mes)\b/.test(low) ? 'Esperando la fecha prevista' : 'Esperando algo externo';
  const luego = despues.replace(SCRIPT, '').replace(/\s+y\s+/i, ' y ').replace(/^[\s,;y]+|[\s,;.]+$/g, '').trim();
  return { titulo, que: que.replace(/^([^:]{3,60}):\s*/, ''), asunto: /^([^:]{3,60}):/.exec(que)?.[1] || '',
    luego: luego ? `El CEO procesa lo recibido, se encarga de ${luego.charAt(0).toLowerCase() + luego.slice(1)} y comprueba el resultado.` : 'El CEO revisa lo que haya llegado, sigue con el trabajo y comprueba el resultado.' };
}

// «Revisa todos los días a las 10 de la mañana las facturas nuevas de Galán Contable» → proyecto, horario y texto.
// Sin IA: sólo lo que la frase dice con claridad; lo que falta se pregunta en el editor (nunca se inventa).
const DIAS_N = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const sinTilde = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function fraseAutomatizacion(texto, proyectos = []) {
  const t = String(texto || '').trim();
  const n = sinTilde(t), compact = n.replace(/[^a-z0-9]/g, '');
  const proyecto = [...proyectos].sort((a, b) => b.nombre.length - a.nombre.length)
    .find((p) => { const k = sinTilde(p.nombre).replace(/[^a-z0-9]/g, ''); return k.length >= 3 && compact.includes(k); }) || null;
  let programa = null;
  const hm = /\ba las (\d{1,2})(?:[:.h](\d{2}))?(?:\s*(?:h|horas)\b)?(?:\s+de la (manana|tarde|noche))?/.exec(n);
  let hora = null;
  if (hm) {
    let hh = Number(hm[1]);
    if ((hm[3] === 'tarde' || hm[3] === 'noche') && hh < 12) hh += 12;
    if (hh <= 23) hora = `${String(hh).padStart(2, '0')}:${hm[2] || '00'}`;
  }
  const dias = Object.entries(DIAS_N).filter(([d]) => new RegExp(`\\b${d}s?\\b`).test(n)).map(([, v]) => v);
  const cadaH = /\bcada (\d{1,2}) horas?\b/.exec(n), cadaM = /\bcada (\d{2,3}) minutos\b/.exec(n);
  if (cadaH || cadaM) programa = { tipo: 'cada', cada_min: cadaH ? Number(cadaH[1]) * 60 : Number(cadaM[1]), desde: '08:00', hasta: '20:00', reintentos: 1, recuperar: true };
  else if (dias.length && hora) programa = { tipo: 'semanal', hora, dias, reintentos: 1, recuperar: true };
  else if (/\b(todos los dias|cada dia|diariamente|a diario)\b/.test(n) && hora) programa = { tipo: 'diaria', hora, reintentos: 1, recuperar: true };
  else if (/\b(laborables|entre semana|de lunes a viernes)\b/.test(n) && hora) programa = { tipo: 'semanal', hora, dias: [1, 2, 3, 4, 5], reintentos: 1, recuperar: true };
  // Nombre del botón = la frase sin el horario ni el proyecto («Revisa las facturas nuevas»).
  let words = t.replace(/^\s*(quiero que|me gustar[ií]a que|necesito que)\s+/i, '')
    .replace(/\b(todos los d[ií]as|cada d[ií]a|diariamente|a diario|de lunes a viernes|entre semana|los laborables|cada \d+ (horas?|minutos))\b/gi, ' ')
    .replace(/\ba las \d{1,2}([:.h]\d{2})?(\s*h\b|\s+horas)?(\s+de la (ma[ñn]ana|tarde|noche))?/gi, ' ')
    .replace(/\b(los |cada )?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b(\s+y\b)?/gi, ' ').split(/\s+/).filter(Boolean);
  if (proyecto) {
    const key = sinTilde(proyecto.nombre).replace(/[^a-z0-9]/g, '');
    for (let size = 4; size >= 1; size--) {
      const i = words.findIndex((_, k) => sinTilde(words.slice(k, k + size).join('')).replace(/[^a-z0-9]/g, '') === key);
      if (i >= 0) { const from = i > 0 && /^(de|del|en|para)$/i.test(words[i - 1]) ? i - 1 : i; words = [...words.slice(0, from), ...words.slice(i + size)]; break; }
    }
  }
  const frase = words.join(' ').replace(/[.,;:]+$/, '');
  const nombre = (frase || t).slice(0, 60).toUpperCase();
  const faltan = [!proyecto && 'proyecto', !programa && /\b(cada|todos|diari|semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n) && 'hora'].filter(Boolean);
  return { proyecto: proyecto?.id || null, proyectoNombre: proyecto?.nombre || null, nombre, descripcion: t.slice(0, 600), procedimiento: t, programa, faltan };
}

/** Proyectos que una frase nombra («clientes para GEST7», «Galán Contable» → GalanContable), del nombre más largo al más corto. */
export function proyectosEn(texto, proyectos = []) {
  const compact = sinTilde(texto).replace(/[^a-z0-9]/g, '');
  return [...proyectos].sort((a, b) => b.nombre.length - a.nombre.length)
    .filter((p) => { const k = sinTilde(p.nombre).replace(/[^a-z0-9]/g, ''); return k.length >= 3 && compact.includes(k); }).map((p) => p.id);
}
