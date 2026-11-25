// OBJETIVOS DE NEGOCIO en el PC y en el móvil (la misma pantalla). Pinta lo que devuelven las órdenes negocio.* y deja
// órdenes de la lista cerrada; no decide nada. Separa siempre lo HECHO (trabajos) de lo CONSEGUIDO (indicadores medidos).
// Sin porcentajes ni estimaciones: sólo valores medidos, con su fecha, y su objetivo.
// V3.9: crear = «qué quieres conseguir» + proyectos (los identifica el CEO o los eliges); después el CEO trabaja solo.
// Un objetivo abierto enseña primero lo esencial (hecho · ahora · después · te necesito) y la HOJA DE RUTA VIVA, que se
// edita aquí mismo (añadir, modificar, quitar, reordenar tareas y fases) sin rehacer el objetivo.
import { claro, h } from './dom.js';
import { marca } from './mama-contexto.js'; // T-A: contrato único de contexto para MAMA
import { EFECTOS_NEC, esPreguntaSimple, proyectosEn, sinConexion } from './zones.js';
import { advice, comunes, decideRow, explica } from './map.js';
import { miniTarjeta } from './tarjeta.js';

// Estado VERIFICABLE de un trabajo (GOAL maestro 12-11): sale del proceso y de su última señal real, no de lo que diga.
const hace = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'hace menos de 1 min' : m < 120 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const QUIEN = { claude: 'Claude', codex: 'Codex', CEO: 'el CEO', ceo: 'el CEO' };
function senal(t) {
  if (t.estado === 'EN_COLA') return ' · en cola: su proyecto está ocupado por otro trabajo';
  if (sinConexion(t)) return ' · SIN CONEXIÓN con su equipo (puede seguir trabajando; no se repite ni se reencola solo)';
  if (t.estado === 'SIN_ACTIVIDAD') return ' · SIN ACTIVIDAD VERIFICABLE (CEOPadre lo vigila y lo retoma solo)';
  if (t.estado === 'ESPERANDO_CONDICION') return ' · esperando una condición';
  if (t.estado !== 'TRABAJANDO') return '';
  if (!t.ultima_actividad) return t.con_proceso ? ' · arrancando' : ' · sin proceso ni señales todavía';
  const viejo = Date.now() - Date.parse(t.ultima_actividad) > 15 * 60_000;
  return ` · ${QUIEN[t.ejecutor] || t.ejecutor || 'ejecutor'}${viejo ? `, sin señales desde ${hace(t.ultima_actividad)}` : `, última señal ${hace(t.ultima_actividad)}`}`;
}

const TONE = { DEFINIENDO: 'work', ESPERANDO_APROBACION: 'ask', ACTIVA: 'work', ESPERANDO_ANTONIO: 'ask', PAUSADA: 'idle', ALCANZADA: 'ok', BLOQUEADA: 'bad', CANCELADA: 'idle',
  EN_SEGUIMIENTO: 'wait', CERRADA: 'idle', ACEPTADA: 'ok' };
const CLOSED = ['ALCANZADA', 'CANCELADA', 'CERRADA', 'ACEPTADA'];
// PROGRESO REAL (sin IA, sin tokens): tareas HECHAS de la hoja de ruta frente a las del alcance actual (las quitadas,
// descartadas o agrupadas en otra no cuentan). Sin hoja no se inventa un porcentaje. El % es SÓLO lo verificado; lo entregado
// que falta cargar o acreditar se ve aparte (tramo claro), y los resultados de fase acreditados también: actividad ≠ progreso.
export function progreso(hj, compacto = false) {
  const c = hj?.cuenta;
  const total = c ? c.hechas + c.en_curso + c.pendientes : 0;
  if (!total) return null;
  const pct = Math.round((100 * c.hechas) / total);
  const espera = c.hechas_espera || 0;
  const pctEspera = Math.round((100 * espera) / total);
  const enMarcha = c.en_curso - espera;
  return h('div', { class: `prog${compacto ? ' compacto' : ''}`, title: 'Verde: tareas terminadas y verificadas. Tramo claro: entregadas con pruebas, falta cargarlas o acreditarlas en uso real. No mide esfuerzo ni el resultado de negocio.' },
    h('div', { class: 'prog-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(c.hechas), 'aria-label': `${c.hechas} de ${total} tareas verificadas${espera ? `, ${espera} entregadas sin cerrar` : ''}` },
      h('span', { style: `width:${pct}%` }), espera ? h('span', { class: 'espera', style: `width:${pctEspera}%` }) : null),
    h('small', {}, `${c.hechas} de ${total} verificadas · ${pct} %${espera ? ` · ${espera} entregada${espera > 1 ? 's' : ''}, falta cargar o acreditar` : ''}${enMarcha > 0 ? ` · ${enMarcha} en marcha` : ''}${compacto ? '' : ` · ${c.pendientes} por hacer`}${!compacto && c.fases ? ` · resultado acreditado en ${c.fases_verificadas || 0} de ${c.fases} fases` : ''}`));
}
// ORGANIZAR vs EJECUTAR (medido en el PC, sólo en la ficha): avisa si el objetivo gasta más en planificar que en resolver.
function coste(c) {
  if (!c || !(c.organizar_min + c.ejecutar_min)) return null;
  return h('small', { class: `muted${c.exceso ? ' t-ask' : ''}`, title: 'Minutos de rondas del CEO supervisor y del diagnóstico frente a minutos de ejecución de Claude, revisiones del director y trabajos terminados' },
    `Organizar ${c.organizar_min} min · ejecutar ${c.ejecutar_min} min · ${c.revisiones} revisiones del director · ${c.terminados} trabajos terminados${c.exceso ? ' · ⚠ más organización que ejecución' : ''}`);
}
const TIPO_NEC = { CONEXION: 'Conectar una cuenta', DATO: 'Un dato', ACCION: 'Algo que sólo puedes hacer tú', DECISION: 'Una decisión', CAPACIDAD: 'Herramienta nueva para el catálogo', AUTOMATIZACION: 'Activar una automatización',
  KPI: 'Revisar un comando de medición', MENSAJES: 'Incluir contactos en Mensajes' };
// Estado de una tarea de la hoja tal como lo ve Antonio.
const TAREA = { PENDIENTE: ['Pendiente', 'idle'], EN_CURSO: ['Ahora', 'work'], BLOQUEADA: ['Te necesita', 'ask'], PAUSADA: ['En pausa', 'idle'], HECHA: ['Hecho', 'ok'],
  HECHA_ESPERA: ['Entregado · falta cargar o acreditar', 'wait'],
  ELIMINADA: ['Quitada', 'idle'], DESCARTADA: ['Descartada por el CEO', 'idle'], NO_NECESARIA: ['No necesaria tras el cierre', 'idle'] };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);
// Resúmenes de la vista principal en lenguaje claro (web/dom.js claro: sin comandos, rutas ni hashes; nada inventado).
const corto = (s, n = 140) => { const t = claro(String(s || '').split('\n')[0]); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function negocioUi({ api, ask, toast, show, data, run, viewText, onChange = () => {}, consultar = null }) {
  let mode = null, list = [], viewing = null, sig = '', timer = null, huella = null;
  const projects = () => data().proyectos || [];
  const online = () => data().pc?.online !== false;
  const cmd = (op, params, okMsg, btn) => run(op, params, okMsg, btn);

  async function load() {
    // Con la huella de la última lista, el PC sólo responde «igual» si nada cambió (no vuelven ~300 KB cada 8 s).
    const r = await api.cmd('negocio.lista', huella ? { huella } : {});
    if (r?.ok && !r.data.igual) { list = r.data.objetivos; huella = r.data.huella || null; }
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
  // onChange: Dirección también repinta sus intervenciones (T37: se resuelven allí sin abrir el objetivo).
  const after = async (ok) => { if (ok) { onChange(); if (mode) await load(); } return ok; };
  // T37 · UNA ORDEN POR DECISIÓN A LA VEZ: mientras una acción de esa tarjeta va al PC, sus demás botones quedan inactivos
  // (doble clic, «Aprobar» y luego «Rechazar»). El PC además rechaza la segunda (la necesidad ya no está PENDIENTE).
  const enVuelo = new Set();
  const una = (ref, fn) => async (x) => {
    const b = x?.currentTarget || x;
    if (enVuelo.has(ref)) return;
    enVuelo.add(ref);
    const card = b?.closest?.('.need-card');
    const bs = card ? [...card.querySelectorAll('button')].filter((y) => !y.disabled) : [];
    for (const y of bs) y.disabled = true;
    card?.setAttribute('aria-busy', 'true');
    try { await fn(b); } finally { enVuelo.delete(ref); for (const y of bs) y.disabled = false; card?.removeAttribute('aria-busy'); }
  };
  const B = (txt, on, cls = 'ghost', extra = {}) => h('button', { class: `btn ${cls} small`, type: 'button', onclick: (e) => on(e.currentTarget), ...extra }, txt);

  // ------------------------------------------------------------ crear / editar (una sola ventana sencilla)
  // Qué quieres conseguir · proyectos (el CEO los identifica, por defecto, o los eliges con búsqueda) · Crear. Lo escrito
  // se conserva si la ventana se cierra sin crear (fuera, Escape o Volver).
  let borradorCrear = null;
  function ventanaObjetivo({ titulo, ok, texto = '', modo = 'AUTO', elegidos = [] }) {
    return new Promise((resolve) => {
      const ps = [...projects()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      const sel = new Set(elegidos);
      const dlg = h('dialog', { class: 'sheet obj-new', 'aria-labelledby': 'obj-new-t' });
      const ta = h('textarea', { rows: 4, placeholder: 'Quiero conseguir clientes para GEST7 mediante redes sociales', 'aria-label': 'Qué quieres conseguir' });
      ta.value = texto;
      const radio = (v, label, help) => { const r = h('input', { type: 'radio', name: 'obj-modo', value: v, checked: modo === v }); r.addEventListener('change', () => { modo = v; pintar(); });
        return h('label', { class: 'obj-modo' }, r, h('span', {}, h('b', {}, label), h('small', { class: 'muted' }, help))); };
      const buscar = h('input', { type: 'search', placeholder: 'Buscar proyecto', 'aria-label': 'Buscar proyecto' });
      const lista = h('div', { class: 'obj-proys', role: 'group', 'aria-label': 'Proyectos' });
      const cuenta = h('p', { class: 'muted small', 'aria-live': 'polite' });
      const zona = h('div', { class: 'obj-manual' }, buscar, lista, cuenta);
      const crearB = h('button', { class: 'btn primary', type: 'button' }, ok);
      const pintar = () => {
        zona.hidden = modo !== 'MANUAL';
        const q = buscar.value.trim().toLowerCase();
        // Al escribir el objetivo se marcan solos los proyectos que nombra (sólo si aún no has elegido ninguno).
        lista.replaceChildren(...ps.filter((p) => !q || p.nombre.toLowerCase().includes(q) || sel.has(p.id)).map((p) => {
          const c = h('input', { type: 'checkbox', checked: sel.has(p.id) });
          c.addEventListener('change', () => { if (c.checked) sel.add(p.id); else sel.delete(p.id); pintar(); });
          return h('label', { class: 'check obj-proy' }, c, ' ', p.nombre);
        }));
        cuenta.textContent = sel.size ? `${sel.size} elegido${sel.size === 1 ? '' : 's'}: dan contexto inicial; el CEO puede sumar otros si los necesita.` : 'Elige uno o varios.';
        crearB.disabled = ta.value.trim().length < 10 || (modo === 'MANUAL' && !sel.size);
      };
      ta.addEventListener('input', () => { if (modo === 'MANUAL' && !sel.size) for (const id of proyectosEn(ta.value, ps)) sel.add(id); pintar(); });
      buscar.addEventListener('input', pintar);
      let hecho = false;
      const fin = (v) => { hecho = true; if (dlg.open) dlg.close(); dlg.remove(); resolve(v); };
      crearB.addEventListener('click', () => fin({ texto: ta.value.trim(), modo, proyectos: [...sel] }));
      dlg.addEventListener('close', () => { if (!hecho) { borradorCrear = { texto: ta.value, modo, elegidos: [...sel] }; dlg.remove(); resolve(null); } });
      dlg.append(h('h2', { id: 'obj-new-t' }, titulo),
        h('label', { class: 'field' }, h('span', { class: 'obj-q' }, 'QUÉ QUIERES CONSEGUIR'), ta,
          h('small', { class: 'muted' }, 'El resultado, no la tarea. No hace falta decir qué agentes ni programas usar.')),
        h('fieldset', { class: 'obj-modos' }, h('legend', { class: 'obj-q' }, 'PROYECTOS IMPLICADOS'),
          radio('AUTO', 'Que el CEO los identifique', 'Recomendado: mira el mapa de tus proyectos y el HUB y elige lo necesario.'),
          radio('MANUAL', 'Elegirlos yo', 'Le dan contexto inicial y ahorran investigación; no le limitan.'), zona),
        h('p', { class: 'muted small' }, 'Al crearlo, el CEO investiga, prepara la hoja de ruta y empieza a trabajar solo. Sólo te pregunta lo imprescindible. Gasto 0 € y nada sale a terceros sin ti.'),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Volver'), crearB));
      document.body.append(dlg);
      pintar();
      dlg.showModal();
      ta.focus();
    });
  }
  async function crear(btn) {
    if (!projects().length) { toast('Primero vincula algún proyecto', 'bad'); return; }
    const r = await ventanaObjetivo({ titulo: 'Nuevo objetivo', ok: 'Crear objetivo', ...(borradorCrear || {}) });
    if (!r) return;
    // 20-11: una pregunta no crea un objetivo: la contesta el CEO en «Consultar» (sin diagnóstico ni trabajo).
    if (consultar && esPreguntaSimple(r.texto)) { borradorCrear = null; toast('Es una pregunta: te contesta el CEO directamente, sin crear un objetivo', 'ok'); consultar(r.texto); return; }
    if (await after(cmd('negocio.crear', { texto: r.texto, modo: r.modo, proyectos: r.modo === 'MANUAL' ? r.proyectos : [] }, 'Creado: el CEO se organiza', btn))) borradorCrear = null;
  }
  async function editarObjetivo(o, btn) {
    const r = await ventanaObjetivo({ titulo: 'Modificar el objetivo', ok: 'Guardar', texto: o.texto, modo: o.seleccion?.modo || 'MANUAL', elegidos: (o.seleccion?.elegidos || []).map((x) => x.id) });
    if (r) await after(cmd('negocio.editar', { id: o.id, texto: r.texto, modo: r.modo, proyectos: r.proyectos }, 'Guardado', btn));
  }

  // ------------------------------------------------------------ piezas
  function kpiRow(k) {
    const val = !k.disponible ? 'no medible todavía' : k.error ? `sin medir · ${k.error}` : k.valor == null ? 'aún sin medir' : `${k.valor}${k.unidad ? ` ${k.unidad}` : ''}`;
    const tone = !k.disponible || k.error || k.valor == null ? 'idle' : k.cumple ? 'ok' : 'warn';
    return h('li', { class: `kpi t-${tone}` }, h('b', {}, k.nombre), ` · ${val}`, h('small', { class: 'muted' },
      ` · ${k.tipo === 'intermedio' ? 'umbral sugerido' : 'objetivo'} ${k.sentido} ${k.objetivo}${k.anterior != null && k.valor != null ? ` · antes ${k.anterior}` : ''}${k.tipo === 'intermedio' ? ` · ${k.datos_at ? `datos del ${fecha(k.datos_at)}` : 'fecha de los datos: no consta'}` : ''}${k.medido_at ? ` · medido ${fecha(k.medido_at)}` : ''}${!k.disponible && k.nota ? ` · ${k.nota}` : ''}`),
      // Intermedio (c2a957fa #5.2): se ve que NO acredita ni es ahorro, y sus limitaciones quedan plegadas debajo.
      k.tipo === 'intermedio' ? h('small', { class: 'muted' }, ' · INTERMEDIO: no acredita el objetivo ni es ahorro demostrado') : null,
      k.tipo === 'intermedio' && k.disponible && k.nota ? h('details', { class: 'prop-more', 'data-k': `kpi-nota-${k.id}` }, h('summary', {}, 'Limitaciones y fecha de los datos'), h('p', { class: 'small muted' }, k.nota)) : null);
  }
  const resultados = (o) => h('section', { class: 'panel' }, h('h4', {}, 'Resultados'),
    h('p', { class: 'muted small' }, 'Medidos por CEOPadre sin IA. Un trabajo terminado no es un resultado conseguido.'),
    o.kpis.length ? h('ul', { class: 'a-pend kpis' }, o.kpis.map(kpiRow)) : h('p', { class: 'muted' }, 'Sin indicadores todavía.'),
    o.vista?.resultado ? h('p', { class: `q4-res ${o.vista.resultado === 'acreditado' ? 'ok' : 'warn'}` }, o.vista.resultado === 'acreditado' ? 'Resultado ACREDITADO por sus indicadores.' : `Resultado: ${o.vista.resultado}.`) : null);

  // LO ESENCIAL: qué ha hecho · qué está haciendo · qué hará después · qué necesita de mí (resumido; detalle debajo).
  function cuatro(o) {
    const v = o.vista || {};
    const hj = o.hoja || { tareas: [] };
    const linea = (t, cls, body) => h('div', { class: `q4 ${cls}` }, h('p', { class: 'lbl' }, t), body);
    const lista = (xs, f, empty) => (xs?.length ? h('ul', { class: 'mlist' }, xs.slice(0, 3).map((x) => h('li', {}, f(x))), xs.length > 3 ? h('li', { class: 'more' }, `+${xs.length - 3} más`) : null) : h('p', { class: 'muted small' }, empty));
    const hechas = hj.tareas.filter((t) => t.estado === 'HECHA');
    // Objetivo externo: lo que está en marcha son sus tareas EN_CURSO sin trabajo de CEOPadre detrás.
    const ahora = [...(v.ahora || []), ...hj.tareas.filter((t) => t.estado === 'EN_CURSO' && !t.trabajo).map((t) => ({ proyecto: t.proyecto, ahora: t.nota && t.nota !== 'en marcha' ? t.nota : t.texto }))];
    const despues = hj.tareas.filter((t) => t.estado === 'PENDIENTE');
    // Objetivo externo: lo que espera a Antonio son sus tareas pendientes marcadas «falta tu autorización/decisión».
    const externas = o.seleccion?.modo === 'EXTERNO' ? hj.tareas.filter((t) => t.estado === 'PENDIENTE' && /falta tu (autorizaci[oó]n|decisi[oó]n)/i.test(t.texto)).map((t) => t.texto) : [];
    const necesito = [...externas, ...(v.te_necesito || []).map((n) => n.que),...(o.pregunta && ['ESPERANDO_ANTONIO', 'BLOQUEADA'].includes(o.estado) ? [o.pregunta] : []),
      ...ahora.filter((t) => t.te_necesita).map((t) => `${t.proyecto}: un trabajo espera algo tuyo`)];
    // 14-11 (GOAL 2.0): con criterios de aceptación propios (MAMA), primero QUÉ FUNCIONA y QUÉ FALTA, tal cual su matriz vigente.
    const cr = o.criterios;
    const ESTADO_CR = { ACEPTADO: '✓ aceptado', TECNICO_OK: 'técnico OK · falta tu prueba', PARCIAL: 'parcial', PENDIENTE: 'pendiente' };
    const criterios = cr?.total ? [
      linea('QUÉ FUNCIONA', cr.aceptados ? 'ok' : 'need', h('p', { class: 'small' }, `${cr.aceptados}/${cr.total} criterios aceptados con prueba real`,
        cr.tecnico_ok ? ` · ${cr.tecnico_ok} funcionan técnicamente y sólo esperan tu prueba` : '', '.')),
      linea('QUÉ FALTA', 'next', h('div', {},
        cr.desbloquea.length ? h('p', { class: 'small' }, cr.desbloquea.slice(0, 3).map((d) => `${d.ref} desbloquea ${d.criterios.length} criterio${d.criterios.length === 1 ? '' : 's'}`).join(' · ')) : null,
        h('details', { class: 'small' }, h('summary', {}, `Los ${cr.total} criterios, uno a uno`),
          h('ol', { class: 'mlist' }, cr.filas.map((f) => h('li', { value: f.n }, h('b', {}, f.criterio), ` · ${ESTADO_CR[f.estado] || f.estado}`,
            f.estado !== 'ACEPTADO' && f.bloqueo ? h('small', { class: 'muted' }, ` · ${corto(f.bloqueo, 160)}`) : null))),
          h('p', { class: 'muted small' }, `Fuente: ${cr.fuente} (${corto(cr.titulo, 80)})`)))),
    ] : [];
    return h('div', { class: 'q4-grid' },
      ...criterios,
      linea('QUÉ HA HECHO', 'ok', lista(hechas.length ? [...hechas].reverse() : v.hecho, (t) => `${t.texto ? corto(t.texto) : `${t.proyecto}: ${corto(t.objetivo)}`} ✓`, 'Nada terminado todavía.')),
      linea('QUÉ ESTÁ HACIENDO', 'work', lista(ahora, (t) => `${t.proyecto}: ${t.pausado ? 'en pausa' : t.te_necesita ? 'esperando algo tuyo' : corto(t.ahora && t.ahora !== 'Aún no se ha hecho nada' ? t.ahora : t.objetivo)}${senal(t)}`,
        o.estado === 'PAUSADA' ? 'En pausa.' : o.estado === 'DEFINIENDO' ? 'Investigando y preparando la hoja de ruta.' : 'Nada en marcha ahora.')),
      linea('QUÉ HARÁ DESPUÉS', 'next', despues.length ? lista(despues, (t) => corto(t.texto), '') : h('p', { class: 'small' }, CLOSED.includes(o.estado) ? 'Nada: el objetivo está cerrado y no vuelve a ejecutarse.' : v.despues || (o.estado === 'EN_SEGUIMIENTO' ? `Medir el resultado ${o.proxima_revision ? `el ${fecha(o.proxima_revision)}` : 'periódicamente'} (sin IA).` : 'El CEO decide al terminar lo que hay en marcha.'))),
      linea('QUÉ NECESITA DE TI', necesito.length ? 'need' : 'ok', necesito.length ? lista(necesito, (x) => corto(x, 160), '') : h('p', { class: 'muted small' }, 'Nada ahora.')),
      v.entendido ? h('p', { class: 'q4-entendido' }, h('b', {}, 'ÚLTIMO CAMBIO ENTENDIDO: '), v.entendido) : null);
  }
  // Lo que el CEO pidió a Antonio: qué, por qué, qué bloquea, qué sigue haciendo y cómo decirle que está hecho.
  // V3.11: es una DECISIÓN COMÚN (misma explicación del CEO, ✓ ✕ ↺ ? y fila común que en Dirección y Proyectos).
  const ceoAbrir = (ref, pregunta = '¿Qué recomiendas, por qué, qué alternativas hay y qué consecuencias tiene cada una?') => window.dispatchEvent(new CustomEvent('ceo:abrir', { detail: { ref, pregunta } }));
  const copiarRef = (ref, btn) => window.dispatchEvent(new CustomEvent('ceo:copiar', { detail: { ref, btn } }));
  function necesidades(o) {
    const todas = (o.necesidades || []).filter((n) => n.estado === 'PENDIENTE');
    const xs = todas.filter((n) => !n.pospuesta);
    const aparcadas = todas.filter((n) => n.pospuesta);
    if (!todas.length) return null;
    return h('section', { class: 'panel need-panel' }, h('h4', {}, xs.length ? `Necesito tu intervención (${xs.length})` : 'Necesito tu intervención'),
      xs.length > 1 ? h('div', { class: 'lote-bar' }, B(`Responder en bloque (${xs.length})`, (b) => enBloque(o, xs, b)),
        h('small', { class: 'muted' }, 'Una sola acción; cada respuesta queda registrada por separado.')) : null,
      xs.length ? xs.map((n) => needCard(o, n)) : h('p', { class: 'muted small' }, 'Nada urgente: sólo lo que pospusiste.'),
      aparcadas.length ? h('details', { class: 'prop-more', 'data-k': `pospuestas-${o.id}` }, h('summary', {}, `Pospuestas (${aparcadas.length})`),
        aparcadas.map((n) => h('article', { class: 'need-card pospuesta' }, h('p', { class: 'need-t' }, h('b', {}, TIPO_NEC[n.tipo] || 'Necesito'), ` — ${n.que}`),
          h('p', { class: 'muted small' }, `Pospuesta hasta el ${fecha(n.pospuesta_hasta)}. El objetivo sigue con lo demás.`),
          h('div', { class: 'a-acts' }, B('Traerla ahora', (b) => after(cmd('negocio.posponer', { id: n.id, dias: 0 }, 'Vuelve a estar a la vista', b))))))) : null);
  }
  // V3.12 · RESPONDER EN BLOQUE: aprobar lo compatible de una vez, rechazar o contestar cada una, o una instrucción global.
  // Lo que exige aprobación individual (gasto, precio, contrato, credenciales, irreversible) no se ofrece para aprobar aquí.
  async function enBloque(o, xs, btn) {
    const fields = [];
    for (const n of xs) {
      const individual = !!n.individual || ['CONEXION', 'KPI'].includes(n.tipo);
      const aprobable = !individual && (!n.abierta || !!n.recomendacion || ['CAPACIDAD', 'AUTOMATIZACION'].includes(n.tipo));
      fields.push({ name: `a${n.id}`, type: 'choice', required: false, label: `#${n.id} · ${n.que}${n.recomendacion ? ` — Recomiendo: ${n.recomendacion}` : ''}${individual ? ' (exige tu decisión individual)' : ''}`,
        options: [...(aprobable ? [{ value: 'APROBAR', label: n.recomendacion ? 'Aprobar lo recomendado' : 'Aprobar' }] : []),
          { value: 'RESPONDER', label: 'Responder con mi texto' }, ...(individual ? [] : [{ value: 'GLOBAL', label: 'Aplicar la instrucción global' }]),
          { value: 'RECHAZAR', label: 'Rechazar' }, { value: 'POSPONER', label: 'Posponer 7 días' }] });
      fields.push({ name: `t${n.id}`, type: 'textarea', required: false, label: `Tu respuesta a #${n.id} (si eliges «Responder»)` });
    }
    fields.push({ name: 'global', type: 'textarea', required: false, label: 'Instrucción global (para las marcadas «Aplicar la instrucción global»)' });
    const r = await ask({ title: `Responder ${xs.length} decisiones de «${o.titulo}»`, help: 'Cada decisión se registra por separado, con su respuesta. Lo que no marques sigue pendiente.', ok: 'Enviar', fields });
    if (!r) return;
    const items = xs.filter((n) => r[`a${n.id}`]).map((n) => ({ id: n.id, accion: r[`a${n.id}`], texto: r[`t${n.id}`] || '' }));
    if (!items.length) { toast('No has marcado ninguna', 'bad'); return; }
    await after(cmd('negocio.lote', { items, global: r.global || '' }, 'Respuestas registradas', btn));
  }
  function needCard(o, n, compacto = false) {
    const c = n.consejo || null;
    const k = c ? { ...c, aprobar: n.abierta ? (EFECTOS_NEC[n.tipo] || {}).boton : c.acciones?.aprobar, rechazar: c.acciones?.rechazar, alternativa: c.acciones?.alternativa || null } : null;
    const ef = EFECTOS_NEC[n.tipo] || {};
    const ex = k && explica(k, 'necesidad');
    // CONEXION = actuación PROTEGIDA: se abre explícitamente su panel (en el PC); nunca se marca hecha desde aquí sin comprobarla.
    const si = n.tipo === 'CONEXION' ? () => window.dispatchEvent(new CustomEvent('ceo:conexiones', { detail: { servicio: n.conexion } }))
      : n.tipo === 'MENSAJES' ? (b) => incluirNec(n, b)
      : n.abierta || n.tipo === 'ACCION' ? (b) => resolverNec(o, n, b)
        : (b) => after(cmd('negocio.necesidad', { id: n.id, respuesta: 'Aprobada' }, ef.boton || 'Aprobado', b));
    const contexto = ex || h('dl', { class: 'wait-dl' },
        n.recomendacion ? [h('dt', {}, 'Recomiendo'), h('dd', {}, n.recomendacion)] : null,
        n.si_aceptas ? [h('dt', {}, 'Si aceptas'), h('dd', {}, n.si_aceptas)] : null,
        n.si_rechazas ? [h('dt', {}, 'Si rechazas'), h('dd', {}, n.si_rechazas)] : null,
        n.por_que ? [h('dt', {}, 'Por qué'), h('dd', {}, n.por_que)] : null,
        n.bloquea ? [h('dt', {}, 'Queda en espera'), h('dd', {}, n.bloquea)] : null,
        n.mientras ? [h('dt', {}, 'Mientras, sigo con'), h('dd', {}, n.mientras)] : null,
        n.como ? [h('dt', {}, n.tipo === 'KPI' ? 'Comando' : 'Cómo'), h('dd', {}, n.tipo === 'KPI' ? h('code', {}, n.como) : n.como)] : null);
    // Compacta (Dirección): QUÉ se pide, POR QUÉ, QUÉ RECOMIENDA el CEO y las acciones a la vista; contexto, consecuencias y
    // riesgos plegados en la misma tarjeta (sin salir de Dirección).
    const porque = n.motivo_nivel || n.por_que;
    const recom = k?.veredicto ? advice(k) : n.recomendacion ? h('p', { class: 'advice v-ans' }, h('b', {}, 'EL CEO RECOMIENDA'), ` · ${n.recomendacion}`) : null;
    return h('article', { class: `need-card${compacto ? ' compacta' : ''}`, 'data-ref': n.ref, ...marca({ tipo: 'decision', id: n.ref, proyecto: n.proyecto, objetivo: n.objetivo, version: n.version, titulo: n.que, acciones: ['decision.resolver'] }) },
      h('p', { class: 'need-t' }, h('b', {}, TIPO_NEC[n.tipo] || 'Necesito'), ` — ${n.que}`),
      n.tipo === 'MENSAJES' ? listaMensajes(n) : null,
      compacto ? [
        h('p', { class: 'need-nivel' }, porque ? `Por qué: ${corto(porque, 220)}` : 'Por qué: no consta (pulsa «Consultar»).', h('small', { class: 'muted' }, ` · objetivo «${corto(o.titulo, 60)}»${n.origen ? ` · lo pide: ${n.origen}` : ''}`)),
        recom,
        h('details', { class: 'prop-more need-ctx', 'data-k': `ctx-${n.ref}` }, h('summary', {}, 'Contexto, consecuencias y riesgos'), contexto, ex ? null : advice(k)),
      ] : [n.motivo_nivel ? h('p', { class: 'need-nivel' }, `Por qué te lo pregunto: ${n.motivo_nivel}${n.origen ? ` · lo pide: ${n.origen}` : ''}`) : null, contexto, ex ? null : advice(k)],
      decideRow({ yes: una(n.ref, (b) => si(b)), yesLabel: n.tipo === 'CONEXION' ? `Conectar ${n.conexion || 'la cuenta'}` : n.abierta ? (propuestaDe(n) ? 'Aceptar recomendación' : ef.boton) : k?.aprobar || ef.boton || 'Aprobar',
        no: una(n.ref, (b) => descartarNec(o, n, b)), noLabel: k?.rechazar || 'No lo voy a hacer',
        alt: k?.alternativa ? una(n.ref, (b) => after(cmd('decision.alternativa', { proyecto: n.proyecto, ref: `necesidad:${n.id}`, version: n.version }, 'Alternativa registrada', b))) : null,
        altLabel: k?.alternativa?.etiqueta, rec: k?.veredicto, ask: () => ceoAbrir(n.ref) }),
      comunes({ copy: (b) => copiarRef(n.ref, b), detalles: () => detallesNec(o, n, k), instruir: n.abierta ? null : una(n.ref, (b) => instruirNec(o, n, b)), posponer: una(n.ref, (b) => after(cmd('negocio.posponer', { id: n.id, dias: 7 }, 'Pospuesta 7 días', b))) }));
  }
  // T37 · RESPONDIDA HACE POCO: qué contestaste y su estado REAL (en cola · recibida · ejecutada), sin abrir el objetivo.
  const ENTREGA = { EN_COLA: ['En cola', 'wait'], RECIBIDA: ['Recibida', 'work'], EJECUTADA: ['Ejecutada', 'ok'] };
  function respondida(o, n) {
    const [t, tone] = ENTREGA[n.entrega?.estado] || ['Registrada', 'idle'];
    return h('li', { class: 'need-done', 'data-ref': n.ref }, chip(t, tone), ' ', h('b', {}, corto(n.que, 90)),
      h('small', { class: 'muted' }, ` → ${n.estado === 'DESCARTADA' ? 'rechazada' : corto(n.respuesta, 80)} · ${fecha(n.resuelta_at)} · ${n.entrega?.detalle || 'guardada'}`));
  }
  function detallesNec(o, n, k) {
    const ef = EFECTOS_NEC[n.tipo] || {};
    const e = k?.explicacion || {};
    const d = n.detalle || {};
    const rec = k?.veredicto ? `${{ APROBAR: k.aprobar || ef.boton || 'Aprobar', RECHAZAR: k.rechazar || 'No hacerlo', ALTERNATIVA: k.alternativa?.etiqueta, RESPONDER: k.respuesta, POSPONER: 'Esperar', INVESTIGAR: 'Comprobar antes un dato' }[k.veredicto] || k.veredicto}${k.motivo ? ` — ${k.motivo}` : ''}` : 'Aún sin recomendación: pulsa «Consultar».';
    const filas = [['OBJETIVO', o.titulo], ['QUÉ SE PIDE', n.que], ['QUÉ PASA', e.que_pasa], ['POR QUÉ (justificación)', n.por_que], ['QUÉ QUEDA EN ESPERA', n.bloquea], ['MIENTRAS, EL OBJETIVO SIGUE CON', n.mientras],
      ['CÓMO / DATOS', n.como], ['FUENTE', d.fuente], ['LICENCIA', d.licencia], ['INSTALACIÓN (por proyecto y con tu autorización)', d.instalacion],
      ['ALTERNATIVAS', [d.alternativas, k?.alternativa ? `Del CEO — ${k.alternativa.etiqueta}: ${k.alternativa.texto || ''}` : ''].filter(Boolean).join('\n')],
      ['EL CEO RECOMIENDA', rec], [`SI ELIGES «${k?.aprobar || ef.boton || 'Aprobar'}»`, e.si_apruebo || n.si_aceptas || ef.si_apruebo], [`SI ELIGES «${k?.rechazar || 'No lo voy a hacer'}»`, e.si_rechazo || n.si_rechazas || ef.si_rechazo],
      ['SI DAS OTRA INSTRUCCIÓN', 'No se hace lo propuesto: el director sigue con lo que tú digas.'], ['SI LA POSPONES', 'Sigue pendiente 7 días sin avisos; el resto del objetivo sigue trabajando.'],
      ['RIESGO', [k?.riesgo, d.seguridad].filter(Boolean).join('\n')], ['PEDIDA', fecha(n.created_at)]];
    viewText(`Detalles · ${TIPO_NEC[n.tipo] || 'petición'}`, filas.filter(([, v]) => v && String(v).trim()).map(([t, v]) => `${t}\n${v}`).join('\n\n'));
  }
  async function instruirNec(o, n, btn) {
    const r = await ask({ title: 'Otra instrucción en lugar de la propuesta', help: n.que, ok: 'Enviar', fields: [{ name: 't', label: 'Qué quieres que se haga', type: 'textarea' }] });
    if (r?.t) await after(cmd('negocio.necesidad', { id: n.id, instruccion: r.t }, 'Instrucción registrada', btn));
  }
  // 20-11 · RESOLVER CON LA RECOMENDACIÓN: si el CEO ya preparó la respuesta (la operativa del asesor o su recomendación), el
  // cuadro la trae ESCRITA: «Enviar» la manda tal cual (una sola confirmación) y se puede editar antes. Nada se envía solo.
  const propuestaDe = (n) => (n.tipo === 'ACCION' ? '' : String(n.consejo?.acciones?.responder?.texto || n.recomendacion || '').trim());
  async function resolverNec(o, n, btn) {
    const propuesta = propuestaDe(n);
    const help = [propuesta ? `EL CEO RECOMIENDA: ${n.recomendacion || propuesta}\nYa está escrita abajo: si estás de acuerdo, pulsa «Enviar»; si no, cámbiala.` : '', n.como || ''].filter(Boolean).join('\n\n');
    const r = await ask({ title: n.que, help, ok: 'Enviar', fields: [{ name: 'respuesta', label: n.tipo === 'ACCION' ? 'Qué has hecho (opcional)' : 'Tu respuesta', type: 'textarea', required: n.tipo !== 'ACCION', value: propuesta }] });
    if (r) await after(cmd('negocio.necesidad', { id: n.id, respuesta: r.respuesta || 'Hecho' }, 'Recibido: el CEO continúa', btn));
  }
  // T28 · inclusión en bloque en Mensajes: cada contacto con su motivo y fuente a la vista; al aprobar se puede desmarcar cualquiera.
  const etiquetaMsg = (c) => `[${c.nivel === 'BORRADORES' ? 'BORRADORES' : 'SÓLO LECTURA'}] ${c.nombre || c.id} · ${c.id.split(':')[0]} — ${c.motivo} (fuente: ${c.fuente})`;
  function listaMensajes(n) {
    const d = n.detalle || {};
    return h('div', { class: 'need-msg' }, h('ul', { class: 'small' }, (d.contactos || []).map((c) => h('li', {}, etiquetaMsg(c)))),
      d.excluidos?.length ? h('details', { class: 'prop-more', 'data-k': `excl-${n.ref}` }, h('summary', {}, `No propuestos (${d.excluidos.length})`),
        h('ul', { class: 'small muted' }, d.excluidos.map((x) => h('li', {}, `${x.quien}: ${x.motivo}`)))) : null);
  }
  async function incluirNec(n, btn) {
    const cs = n.detalle?.contactos || [];
    // Servidor anterior a T28 (sin `detalle`): la lista está en «Cómo»; aprobar espera a que CEOPadre cargue la versión nueva.
    if (!cs.length) { toast('Para aprobar esta propuesta CEOPadre tiene que cargar su versión nueva (reinicio seguro pendiente). Nada se ha incluido.', 'bad'); return; }
    const r = await ask({ title: 'Incluir en Mensajes', help: 'Desmarca los que no quieras. Hasta ahora no se ha leído ningún mensaje suyo: sólo al aprobar se lee su historia. No se envía nada.',
      ok: 'Aprobar los marcados', fields: cs.map((c, i) => ({ name: `c${i}`, type: 'checkbox', value: true, label: etiquetaMsg(c) })) });
    if (!r) return;
    const quitar = cs.filter((c, i) => !r[`c${i}`]).map((c) => c.id);
    if (quitar.length === cs.length) { toast('No has marcado ninguno: usa «No lo voy a hacer» para rechazar', 'bad'); return; }
    await after(cmd('negocio.necesidad', { id: n.id, quitar }, 'Incluidos en Mensajes', btn));
  }
  async function descartarNec(o, n, btn) {
    const r = await ask({ title: `¿Descartar «${n.que}»?`, help: 'El CEO replanifica sin ello.', ok: 'Descartar', fields: [{ name: 'motivo', label: 'Motivo (opcional)', required: false }] });
    if (r) await after(cmd('negocio.necesidad', { id: n.id, descartar: true, respuesta: r.motivo }, 'Descartada', btn));
  }
  function needBox(o) {
    if (o.estado === 'ESPERANDO_APROBACION') return h('div', { class: 'decision' }, h('p', { class: 'ln' }, h('b', {}, 'TU APROBACIÓN'), ' Este objetivo se creó pidiendo revisar el plan: revísalo y apruébalo.'),
      h('div', { class: 'row' }, B('REVISAR EL PLAN', () => openOne(o.id), 'primary')));
    if (o.estado === 'ESPERANDO_ANTONIO' && o.categoria === 'CUOTA') return h('div', { class: 'decision' }, h('p', { class: 'ln' }, h('b', {}, 'ESPERANDO CUOTA'), ` ${o.pregunta || ''}`),
      h('div', { class: 'row' }, B('REANUDAR ya', (b) => after(cmd('negocio.reanudar', { id: o.id }, 'Reanudado', b)))));
    if (o.estado === 'ESPERANDO_ANTONIO' || o.estado === 'BLOQUEADA') return h('div', { class: 'decision' }, h('p', { class: 'ln' }, h('b', {}, o.estado === 'BLOQUEADA' ? 'BLOQUEADO' : 'TE NECESITA'), ` ${o.pregunta || o.evaluacion || ''}`),
      h('div', { class: 'row' }, o.estado === 'ESPERANDO_ANTONIO' ? B('RESPONDER', (b) => responder(o, b), 'primary') : null,
        o.categoria === 'CIERRE' ? B('Sí, darlo por alcanzado', (b) => cerrar(o, b)) : null,
        B('REANUDAR', (b) => after(cmd('negocio.reanudar', { id: o.id }, 'Reanudado', b))),
        B('💬 Consultar', () => ceoAbrir(`meta:${o.id}`, `${o.estado === 'BLOQUEADA' ? 'Está bloqueado' : 'Me preguntas'}: «${corto(o.pregunta || o.evaluacion || '', 300)}». ¿Qué recomiendas, por qué, qué alternativas hay y qué pasa con cada una?`))),
      // RESPONDER ya es «dar otra instrucción»; posponer no tiene sentido: el objetivo entero está esperando esto.
      comunes({ copy: (b) => copiarRef(`meta:${o.id}`, b) }));
    return null;
  }
  // Acciones del objetivo: una principal a la vista; el resto, en «Más».
  function actions(o) {
    const closed = CLOSED.includes(o.estado);
    // EXTERNO: lo ejecuta otra sesión; aquí no hay director que reciba instrucciones ni pausas (no se ofrece lo que no actúa).
    if (o.seleccion?.modo === 'EXTERNO') return h('div', { class: 'a-acts obj-acts' },
      !closed ? B('✓ Dar por cumplido y cerrar', (b) => aceptarRes(o, b), 'ghost', { title: 'Das el objetivo por cumplido: se cierra y no vuelve a pedirte nada' }) : null,
      B('💬 Consultar', () => window.dispatchEvent(new CustomEvent('ceo:abrir', { detail: { ref: `meta:${o.id}` } }))));
    return h('div', { class: 'a-acts obj-acts' },
      // Visible (no escondido en «Más»): cerrar un objetivo cumplido es una decisión habitual de Antonio.
      ['EN_SEGUIMIENTO', 'ACTIVA', 'ESPERANDO_ANTONIO', 'PAUSADA', 'BLOQUEADA'].includes(o.estado) && !o.trabajos?.en_curso ? B('✓ Dar por cumplido y cerrar', (b) => aceptarRes(o, b), o.estado === 'EN_SEGUIMIENTO' ? 'primary' : 'ghost', { title: 'Das el objetivo por cumplido: se cierra, deja de trabajar y no vuelve a pedirte nada' }) : null,
      !closed ? B('Nueva instrucción', (b) => instruir(o, b), o.estado === 'EN_SEGUIMIENTO' ? 'ghost' : 'primary') : null,
      o.estado === 'PAUSADA' ? B('▶ Continuar', (b) => after(cmd('negocio.reanudar', { id: o.id }, 'Continúa', b)), 'primary')
        : !closed && o.estado !== 'BLOQUEADA' ? B('⏸ Pausar', (b) => after(cmd('negocio.pausar', { id: o.id }, 'Objetivo en pausa', b)), 'ghost', { title: 'Pausa TODO el objetivo: no empieza nada nuevo y lo que está en marcha se detiene sin perder lo hecho' }) : null,
      B('💬 Consultar', () => window.dispatchEvent(new CustomEvent('ceo:abrir', { detail: { ref: `meta:${o.id}` } }))),
      h('details', { class: 'a-more' }, h('summary', { class: 'btn ghost small' }, 'Más'), h('div', { class: 'a-menu' },
        !closed ? B('Modificar el objetivo o los proyectos', (b) => editarObjetivo(o, b)) : null,
        ['ACTIVA', 'ESPERANDO_ANTONIO', 'PAUSADA', 'EN_SEGUIMIENTO'].includes(o.estado) ? B('Medir ahora', (b) => after(cmd('negocio.medir', { id: o.id }, 'Medido', b))) : null,
        ['ACTIVA', 'ESPERANDO_ANTONIO', 'PAUSADA', 'BLOQUEADA', 'EN_SEGUIMIENTO'].includes(o.estado) ? B('Terminar y seguir midiendo el resultado', (b) => cerrar(o, b)) : null,
        !closed ? B('Cancelar el objetivo', (b) => cancelar(o, b), 'ghost-danger') : null)));
  }
  // PRIORIDAD (24-11): el puesto REAL (el mismo orden que usa la programación) y ↑ ↓ ★. Lo fijado se mantiene hasta «Auto».
  function prioridadFila(o) {
    const p = o.prioridad;
    if (!p || CLOSED.includes(o.estado)) return null;
    const P = (txt, accion, title) => B(txt, (b) => after(cmd('negocio.prioridad', { id: o.id, accion }, 'Prioridad cambiada', b)), 'ghost', { title, 'aria-label': title, disabled: !online() });
    return h('div', { class: 'prio-fila' }, h('small', {}, `Prioridad ${p.puesto}${p.importante ? ' · ★ importante' : ''} · ${p.manual ? 'fijada por ti' : `automática${p.por ? ` · ${p.por}` : ''}`}`),
      P('↑', 'subir', 'Subir la prioridad'), P('↓', 'bajar', 'Bajar la prioridad'),
      P(p.importante ? '☆' : '★', p.importante ? 'normal' : 'importante', p.importante ? 'Quitar la marca de importante' : 'Marcar como importante: va delante de los no marcados'),
      p.manual || p.importante ? P('Auto', 'auto', 'Volver a la prioridad automática') : null);
  }
  // TARJETA COMPACTA de la lista: título, estado, lo que hace ahora, cuánto lleva y la acción principal.
  function card(o) {
    const hj = o.hoja?.cuenta;
    const ahora = o.vista?.ahora?.[0];
    const necesita = o.te_necesita;
    const abrir = () => openOne(o.id);
    return miniTarjeta({ id: `meta-${o.id}`, ctx: { tipo: 'objetivo', id: o.id, titulo: o.titulo, acciones: ['negocio.instruccion'] }, titulo: o.titulo, clase: 'obj-mini', abrir,
      estado: [necesita && !['ESPERANDO_ANTONIO', 'BLOQUEADA', 'ESPERANDO_APROBACION'].includes(o.estado) ? 'Te necesita' : o.estado_texto, necesita ? 'ask' : TONE[o.estado] || 'idle'],
      sub: o.proyectos.map((p) => p.nombre).join(' · ') || (o.seleccion?.modo === 'AUTO' ? 'El CEO elige los proyectos' : ''),
      desc: ahora ? `Ahora · ${ahora.proyecto}: ${corto(ahora.ahora && ahora.ahora !== 'Aún no se ha hecho nada' ? ahora.ahora : ahora.objetivo, 120)}` : o.evaluacion || corto(o.texto, 160),
      // Una sola línea de avance (antes la barra y «N hecho · N ahora · N pendientes» repetían lo mismo); lo bloqueado, aparte.
      extra: h('div', {}, hj ? progreso(o.hoja, true) : null,
        hj?.bloqueadas ? h('p', { class: 'obj-cuenta' }, h('span', { class: 't-ask' }, `${hj.bloqueadas} tarea${hj.bloqueadas === 1 ? '' : 's'} esperando algo tuyo`)) : null, prioridadFila(o)),
      accion: { txt: necesita ? 'Resolver' : 'Ver', on: abrir, cls: necesita ? 'primary' : 'ghost' } });
  }

  // ------------------------------------------------------------ acciones
  async function responder(o, btn) {
    const r = await ask({ title: 'Responder', help: o.pregunta || '', ok: 'Enviar respuesta', fields: [{ name: 'respuesta', label: 'Tu respuesta', type: 'textarea' }] });
    if (r) await after(cmd('negocio.responder', { id: o.id, respuesta: r.respuesta }, 'Respuesta enviada', btn));
  }
  async function instruir(o, btn) {
    const r = await ask({ title: 'Nueva instrucción o cambio de estrategia', help: 'Llega YA a los trabajos en marcha (la incorporan sin empezar de cero) y el CEO replanifica: verás qué ha entendido en «Último cambio entendido». Si algo en marcha queda contradicho, lo para sin perder lo hecho.', ok: 'Enviar', fields: [{ name: 'texto', label: 'Instrucción', type: 'textarea' }] });
    if (r) await after(cmd('negocio.instruccion', { id: o.id, texto: r.texto }, 'Recibida: el CEO revisa el plan', btn));
  }
  async function aceptarRes(o, btn) {
    const r = await ask({ title: `¿Dar por cumplido y cerrar «${o.titulo}»?`, ok: 'Dar por cumplido y cerrar',
      help: `Quedará «Cerrado por Antonio» con fecha y motivo. Se conservan todos los trabajos y resultados; ${o.hoja?.cuenta?.pendientes ? `las ${o.hoja.cuenta.pendientes} tarea(s) sin hacer quedan como «No necesaria tras el cierre» (no se marcan como hechas)` : 'no queda ninguna tarea por hacer'}, se retiran sus preguntas y no se vuelve a ejecutar ni a pedirte nada. Lo que los indicadores no hayan comprobado se anota como «comprobación técnica pendiente»: no se inventa.`,
      fields: [{ name: 'motivo', label: 'Motivo (opcional; p. ej. «ya lo envié yo»)', type: 'textarea', required: false }] });
    if (r) await after(cmd('negocio.aceptar', { id: o.id, motivo: r.motivo || 'Dado por cumplido desde el detalle' }, 'Objetivo cerrado', btn));
  }
  async function cancelar(o, btn) {
    const r = await ask({ title: `¿Cancelar «${o.titulo}»?`, ok: 'Sí, cancelar', danger: true, help: 'El director deja de lanzar trabajos. No se revierte nada de lo hecho.',
      fields: o.trabajos.en_curso ? [{ name: 'trabajo', label: `Cancelar también el trabajo en marcha (${o.trabajos.en_curso.proyecto})`, type: 'checkbox' }] : [] });
    if (r) await after(cmd('negocio.cancelar', { id: o.id, confirmado: true, cancelar_trabajo: !!r.trabajo }, 'Cancelado', btn));
  }
  async function cerrar(o, btn) {
    const r = await ask({ title: `¿Dar por terminado «${o.titulo}»?`, ok: 'Terminar',
      help: 'Sólo cuenta como ALCANZADO si los indicadores de resultado lo acreditan. Si no, queda EN SEGUIMIENTO (se sigue midiendo solo) salvo que marques cerrarlo sin acreditar.',
      fields: [{ name: 'motivo', label: 'Motivo (opcional)', required: false }, { name: 'sin_acreditar', label: 'Cerrarlo aunque el resultado no esté acreditado (no contará como alcanzado)', type: 'checkbox' }] });
    if (r) await after(cmd('negocio.cerrar', { id: o.id, confirmado: true, motivo: r.motivo, sin_acreditar: !!r.sin_acreditar }, 'Hecho', btn));
  }
  async function aprobar(o, btn) {
    const qs = o.plan?.preguntas || [];
    const r = await ask({ title: 'Aprobar el plan', ok: 'Aprobar y empezar',
      help: 'Al aprobar, CEOPadre ejecutará los comandos de medición del plan (sólo lectura) y el CEO empezará a trabajar solo.',
      fields: qs.map((q) => ({ name: q.id, label: `${q.id} · ${q.pregunta}${q.por_que ? ` (${q.por_que})` : ''}`, type: 'textarea' })) });
    if (!r) return;
    if (await cmd('negocio.aprobar', { id: o.id, plan_hash: o.plan_hash, respuestas: r }, 'Plan aprobado', btn)) { await openOne(o.id); }
  }
  async function corregir(o, btn) {
    const r = await ask({ title: 'Corregir el plan', help: 'Se rehace el diagnóstico con tu corrección.', ok: 'Rehacer el plan', fields: [{ name: 'motivo', label: 'Qué hay que cambiar', type: 'textarea' }] });
    if (r && await cmd('negocio.corregir_plan', { id: o.id, motivo: r.motivo }, 'Rehaciendo el plan', btn)) await openOne(o.id);
  }

  // ------------------------------------------------------------ HOJA DE RUTA VIVA (editable desde el PC o el móvil)
  const hojaCmd = async (o, p, okMsg, btn) => { if (await cmd('negocio.hoja', { id: o.id, ...p }, okMsg, btn)) await openOne(o.id); };
  const faseOpts = (o) => o.hoja.fases.map((f) => ({ value: f.id, label: f.nombre }));
  async function anadirTarea(o, fase, btn) {
    const r = await ask({ title: 'Añadir una tarea', ok: 'Añadir', help: 'El CEO la tiene en cuenta desde ya. Si la marcas como prioritaria, será lo siguiente que haga.',
      fields: [{ name: 'texto', label: 'Qué hay que hacer', type: 'textarea' }, ...(o.hoja.fases.length ? [{ name: 'fase', label: 'Fase', type: 'choice', value: fase || o.hoja.tareas.find((t) => t.id === o.hoja.siguiente)?.fase || o.hoja.fases.at(-1).id, options: faseOpts(o) }] : []),
        { name: 'primera', label: 'Prioritaria (lo siguiente)', type: 'checkbox' }] });
    if (r) await hojaCmd(o, { op: 'añadir', texto: r.texto, fase: r.fase, primera: r.primera }, 'Tarea añadida', btn);
  }
  // RESOLVER lo que una tarea necesita de Antonio, sin salir del objetivo (el trabajo puede estar en cola y no verse en la
  // ficha del proyecto): lo que pide, entero, y las tres respuestas posibles por sus órdenes de siempre.
  async function resolverTarea(o, t, btn) {
    const r = await ask({ title: `${t.id} · necesita tu intervención`, ok: 'Enviar',
      help: `${t.espera?.descripcion || t.necesita || 'Mira su ficha: espera una decisión tuya.'}

Elige qué hacer:`,
      fields: [{ name: 'accion', label: 'Qué haces', type: 'choice', value: t.espera ? '' : 'instruccion', options: [
        ...(t.espera ? [{ value: 'hecho', label: 'Ya lo he hecho: que siga' }] : []),
        { value: 'instruccion', label: 'Darle otra instrucción (sustituye lo que pedía)' },
        { value: 'consultar', label: 'Consultar antes de decidir' }] },
      { name: 'texto', label: 'Instrucción o comentario (obligatorio si das otra instrucción)', type: 'textarea', required: false }] });
    if (!r) return;
    if (r.accion === 'consultar') { window.dispatchEvent(new CustomEvent('ceo:abrir', { detail: { ref: `trabajo:${t.trabajo}` } })); return; }
    if (r.accion === 'hecho') { await after(cmd('espera.hecho', { id: t.espera.id }, 'Registrado: se verifica ahora', btn)); return; }
    if (!r.texto) { toast('Escribe la instrucción', 'bad'); return; }
    await after(cmd('objetivo.anadir', { trabajo: t.trabajo, texto: r.texto }, 'Instrucción enviada', btn));
  }
  async function editarTarea(o, t, btn) {
    // Guardar ≠ enviar: con trabajo vivo, el cambio es una INSTRUCCIÓN que se entrega a su ejecutor (y sustituye lo que te
    // estaba pidiendo); sin trabajo, sólo se guarda y se aplicará cuando la tarea empiece.
    const viva = t.estado === 'EN_CURSO';
    const r = await ask({ title: `Modificar ${t.id}`, ok: viva ? 'Guardar y enviar instrucción' : 'Guardar cambios',
      help: viva ? 'Está en marcha: tu cambio se envía a su ejecutor como instrucción. Si estaba esperando algo tuyo, eso deja de pedírsete. Verás si se entregó o si espera turno.'
        : t.estado === 'PENDIENTE' ? 'Aún no ha empezado: se guarda y se hará así cuando empiece.' : '',
      fields: [{ name: 'texto', label: 'Qué hay que hacer', type: 'textarea', value: t.texto }, ...(o.hoja.fases.length ? [{ name: 'fase', label: 'Fase', type: 'choice', value: t.fase || '', options: faseOpts(o) }] : [])] });
    if (r) await hojaCmd(o, { op: 'editar', tarea: t.id, texto: r.texto, fase: r.fase }, 'Tarea modificada', btn);
  }
  async function quitarTarea(o, t, btn) {
    const viva = t.estado === 'EN_CURSO';
    const r = await ask({ title: `¿Quitar «${corto(t.texto, 80)}»?`, ok: 'Quitar', danger: true,
      help: viva ? 'Está en marcha. Por defecto termina en un punto seguro, sin acciones externas nuevas, y no se repite. Lo hecho se conserva.' : 'No se lanzará. El CEO no la volverá a crear.',
      fields: viva ? [{ name: 'detener', label: 'Detenerla ya (en vez de dejarla terminar en un punto seguro)', type: 'checkbox' }] : [] });
    if (r) await hojaCmd(o, { op: 'eliminar', tarea: t.id, detener: !!r.detener }, 'Tarea quitada', btn);
  }
  async function editarFase(o, f, btn) {
    const r = await ask({ title: `Fase · ${f.nombre}`, ok: 'Guardar', fields: [{ name: 'nombre', label: 'Nombre', value: f.nombre }, { name: 'objetivo', label: 'Qué se consigue en esta fase', type: 'textarea', value: f.objetivo, required: false },
      { name: 'criterio', label: 'Cuándo está cumplida', value: f.criterio, required: false }, { name: 'quitar', label: 'Quitar esta fase (y sus tareas pendientes)', type: 'checkbox' }] });
    if (!r) return;
    if (r.quitar) await hojaCmd(o, { op: 'fase_eliminar', fase: f.id }, 'Fase quitada', btn);
    else await hojaCmd(o, { op: 'fase_editar', fase: f.id, nombre: r.nombre, objetivo: r.objetivo, criterio: r.criterio }, 'Fase modificada', btn);
  }
  async function anadirFase(o, btn) {
    const r = await ask({ title: 'Añadir una fase', ok: 'Añadir', fields: [{ name: 'nombre', label: 'Nombre' }, { name: 'objetivo', label: 'Qué se consigue', type: 'textarea', required: false }] });
    if (r) await hojaCmd(o, { op: 'fase_añadir', nombre: r.nombre, objetivo: r.objetivo }, 'Fase añadida', btn);
  }
  function tareaRow(o, t, editable) {
    const [label, tone] = (t.agrupada_en ? [`Dentro de ${t.agrupada_en}`, 'idle'] : null) || TAREA[t.visible] || TAREA[t.estado] || [t.estado, 'idle'];
    const abierta = ['PENDIENTE', 'EN_CURSO'].includes(t.estado);
    const ico = (txt, aria, on, cls = '') => h('button', { class: `btn ghost small t-ico ${cls}`, type: 'button', 'aria-label': aria, title: aria, onclick: (e) => on(e.currentTarget) }, txt);
    return h('li', { class: `road-t t-${tone}`, 'data-tarea': t.id },
      h('div', { class: 'road-t-main' }, chip(label, tone),
        h('span', { class: 'road-t-txt', title: 'Pulsa para ver entera', onclick: (e) => e.currentTarget.classList.toggle('abierta') }, t.texto),
        h('small', { class: 'muted' }, [t.quien ? `${t.quien}` : t.proyecto, t.origen !== 'CEO' ? 'tuya' : null, t.estado === 'EN_CURSO' && t.visible !== 'BLOQUEADA' && t.ahora && t.ahora !== 'Aún no se ha hecho nada' ? corto(t.ahora, 90) : null, t.nota && !abierta ? t.nota : null].filter(Boolean).join(' · ')),
        // «Te necesita»: UNA acción clara y «Resolver», que abre su ficha con la explicación completa y las opciones.
        t.visible === 'BLOQUEADA' ? h('div', { class: 'road-t-need' }, h('p', {}, h('b', {}, 'Necesita tu intervención: '), claro(t.necesita || 'mira qué espera en su ficha')),
          h('button', { class: 'btn primary small', type: 'button', onclick: (e) => resolverTarea(o, t, e.currentTarget) }, 'Resolver')) : null),
      editable && abierta ? h('div', { class: 'road-t-acts' },
        t.estado === 'PENDIENTE' ? ico('↑', `Subir prioridad de ${t.id}`, (b) => hojaCmd(o, { op: 'mover', tarea: t.id, a: 'arriba' }, 'Prioridad cambiada', b)) : null,
        t.estado === 'PENDIENTE' ? ico('↓', `Bajar prioridad de ${t.id}`, (b) => hojaCmd(o, { op: 'mover', tarea: t.id, a: 'abajo' }, 'Prioridad cambiada', b)) : null,
        ico('✎', `Modificar ${t.id}`, (b) => editarTarea(o, t, b)),
        ico('✕', `Quitar ${t.id}`, (b) => quitarTarea(o, t, b), 't-del')) : null);
  }
  const FASES_ABIERTAS = new Map(); // "objetivo:fase" → abierta (sólo lo que Antonio tocó; lo demás, por defecto)
  function hojaView(o) {
    const hj = o.hoja;
    if (!hj || (!hj.fases.length && !hj.tareas.length)) {
      return h('section', { class: 'panel' }, h('h4', {}, 'Hoja de ruta'), h('p', { class: 'muted' }, o.estado === 'DEFINIENDO' ? 'El CEO está investigando y la preparará en cuanto termine.' : 'Sin hoja de ruta todavía.'));
    }
    const editable = !CLOSED.includes(o.estado);
    const vivas = (t) => !['ELIMINADA', 'DESCARTADA', 'NO_NECESARIA'].includes(t.estado);
    const quitadas = hj.tareas.filter((t) => !vivas(t));
    const sinFase = hj.tareas.filter((t) => vivas(t) && !hj.fases.some((f) => f.id === t.fase));
    const fase = (f, i) => {
      const ts = hj.tareas.filter((t) => t.fase === f.id && vivas(t));
      const hechas = ts.filter((t) => t.estado === 'HECHA').length;
      const enMarcha = ts.some((t) => t.estado === 'EN_CURSO');
      // V3.12: «hecha» sólo con el RESULTADO verificado; con todas las tareas hechas pero sin acreditar, sigue abierta.
      const est = f.estado || null;
      // FASE COMPACTA (11-11): plegada por defecto salvo la que está en marcha; se recuerda lo que Antonio abre o cierra
      // (la vista se repinta con cada cambio de estado). Cabecera: número, nombre, estado, cuenta y siguiente acción.
      const clave = `${o.id}:${f.id}`;
      const abierta = FASES_ABIERTAS.has(clave) ? FASES_ABIERTAS.get(clave) : enMarcha;
      const sig = ts.find((t) => t.estado === 'EN_CURSO') || ts.find((t) => t.estado === 'PENDIENTE');
      const [fl, ft] = est?.cumplida ? ['Cumplida', 'ok'] : enMarcha ? ['En marcha', 'work'] : ts.length && hechas === ts.length ? (ts.every((t) => /^Hecha · (acreditada|aceptada por Antonio)/.test(t.nota || '')) ? ['Hecha', 'ok'] : ['Hecha · sin acreditar', 'warn']) : hechas ? ['Empezada', 'idle'] : ['Pendiente', 'idle'];
      return h('li', { class: `road-f${enMarcha ? ' now' : est?.cumplida ? ' done' : hechas ? ' some' : ''}` }, h('details', { class: 'road-fold', open: abierta },
        // Sólo un clic de Antonio cuenta (el «toggle» también salta al pintar la fase abierta por defecto).
        h('summary', { class: 'road-f-sum', onclick: (e) => FASES_ABIERTAS.set(clave, !e.currentTarget.parentElement.open) }, h('span', { class: 'road-n', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'road-f-sumt' }, h('b', {}, f.nombre), h('small', { class: 'muted' }, [ts.length ? `${hechas}/${ts.length} tareas` : 'sin tareas', sig ? `siguiente: ${corto(sig.texto, 90)}` : null].filter(Boolean).join(' · '))),
          chip(fl, ft)),
        h('div', { class: 'road-f-head' },
          h('div', { class: 'road-f-t' }, f.objetivo ? h('p', { class: 'small' }, f.objetivo) : null,
            h('small', { class: 'muted' }, [f.proyecto, f.criterio ? `cumplida cuando ${f.criterio}` : null, ts.length ? `${hechas} de ${ts.length} tareas hechas` : null].filter(Boolean).join(' · ')),
            est && (est.trabajo !== 'PENDIENTE' || est.resultado !== 'PENDIENTE') ? h('p', { class: `road-res r-${est.resultado.toLowerCase()}` }, h('b', {}, est.texto),
              est.trabajo === 'HECHO' && est.resultado === 'PENDIENTE' ? ` · prueba ${est.prueba === 'EJECUTADA' ? 'ejecutada' : 'sin ejecutar'}` : '', est.evidencia ? ` · ${est.evidencia}` : '') : null),
          editable ? h('button', { class: 'btn ghost small t-ico', type: 'button', 'aria-label': `Modificar la fase ${f.nombre}`, title: 'Modificar la fase', onclick: (e) => editarFase(o, f, e.currentTarget) }, '✎') : null),
        h('ol', { class: 'road-ts' }, ts.map((t) => tareaRow(o, t, editable))),
        editable ? h('button', { class: 'btn ghost small road-add', type: 'button', onclick: (e) => anadirTarea(o, f.id, e.currentTarget) }, '+ Tarea') : null));
    };
    return h('section', { class: 'panel road-panel' },
      h('div', { class: 'dir-head' }, h('h4', {}, 'Hoja de ruta'), h('small', { class: 'muted' }, 'El orden es la prioridad. El CEO la sigue y la ajusta; tus cambios mandan.')),
      o.plan?.resultado_buscado ? h('p', { class: 'road-goal' }, h('span', { class: 'lbl' }, 'OBJETIVO FINAL'), ' ', o.plan.resultado_buscado) : null,
      h('ol', { class: 'road' }, hj.fases.map(fase)),
      sinFase.length ? h('div', {}, h('p', { class: 'lbl' }, 'OTRAS TAREAS'), h('ol', { class: 'road-ts' }, sinFase.map((t) => tareaRow(o, t, editable)))) : null,
      editable ? h('div', { class: 'a-acts' }, B('+ Añadir tarea', (b) => anadirTarea(o, null, b)), B('+ Añadir fase', (b) => anadirFase(o, b))) : null,
      quitadas.length ? h('details', { class: 'fold' }, h('summary', {}, `Quitadas o descartadas (${quitadas.length})`), h('ol', { class: 'road-ts' }, quitadas.map((t) => tareaRow(o, t, false)))) : null);
  }

  // ------------------------------------------------------------ un objetivo entero
  function planView(o) {
    const p = o.plan;
    if (!p) return null;
    return h('details', { class: 'panel fold' }, h('summary', {}, 'Plan del diagnóstico (situación, cómo se mide, riesgos)'),
      p.estado_actual ? h('p', { class: 'a-desc' }, p.estado_actual) : null,
      p.kpis?.length ? [h('p', { class: 'lbl' }, 'CÓMO SE MIDE'), h('ul', { class: 'a-pend' }, p.kpis.map((k) => h('li', {}, h('b', {}, k.nombre), ` · objetivo ${k.sentido} ${k.objetivo}${k.unidad ? ` ${k.unidad}` : ''} · `,
        k.comprobar ? h('code', {}, k.comprobar.cmd) : h('i', {}, 'no medible todavía'), k.nota ? h('small', { class: 'muted' }, ` · ${k.nota}`) : null)))] : null,
      p.riesgos?.length ? [h('p', { class: 'lbl' }, 'RIESGOS'), h('ul', { class: 'a-pend' }, p.riesgos.map((x) => h('li', {}, x)))] : null);
  }
  function aprobacion(o) {
    if (o.estado !== 'ESPERANDO_APROBACION') return null;
    return h('section', { class: 'panel need-panel' }, h('h4', {}, 'Plan por aprobar'), h('p', {}, 'Este objetivo se creó pidiendo revisar el plan antes de empezar.'),
      h('div', { class: 'a-acts' }, h('button', { class: 'btn primary', type: 'button', disabled: !online(), onclick: (e) => aprobar(o, e.currentTarget) }, 'RESPONDER Y APROBAR'),
        B('Corregir el plan', (b) => corregir(o, b))));
  }
  function one() {
    const o = viewing;
    return [h('section', { class: 'panel dir' }, h('div', { class: 'dir-head' }, chip(o.estado_texto, TONE[o.estado] || 'idle'),
      h('p', { class: 'muted small obj-proys-line' }, o.seleccion?.modo === 'EXTERNO' ? `Lo ejecuta ${o.seleccion.responsable || 'otra sesión'}: CEOPadre sólo lo sigue (no lanza trabajos). Proyectos: ${o.proyectos.map((p) => p.nombre).join(', ') || '—'}` : `${o.seleccion?.modo === 'AUTO' ? 'Proyectos elegidos por el CEO' : 'Proyectos elegidos por ti (el CEO puede sumar otros)'}: ${o.proyectos.map((p) => p.nombre).join(', ') || '—'}`)),
      progreso(o.hoja), coste(o.coste), cuatro(o), actions(o), needBox(o)),
    aprobacion(o), necesidades(o), hojaView(o), resultados(o), planView(o),
    Object.keys(o.respuestas || {}).length ? h('details', { class: 'panel fold' }, h('summary', {}, 'Tus respuestas e instrucciones'), h('ul', { class: 'a-pend' }, Object.entries(o.respuestas).map(([k, v]) => h('li', {}, h('b', {}, k), ` · ${v}`)))) : null,
    h('details', { class: 'panel fold' }, h('summary', {}, `Trabajos realizados (${o.trabajos_lista.length})`), o.trabajos_lista.length ? o.trabajos_lista.map((t) => h('article', { class: `a-runrow t-${t.estado === 'TERMINADO' ? 'ok' : ['CANCELADO'].includes(t.estado) ? 'idle' : 'work'}` },
      h('header', {}, h('b', {}, `${fecha(t.inicio)} · ${t.proyecto}`), chip(t.verificado ? 'Terminado y comprobado' : t.estado === 'CANCELADO' ? 'Cancelado' : 'En marcha', t.verificado ? 'ok' : 'work')),
      h('p', { class: 'a-desc' }, t.objetivo), t.ahora ? h('p', { class: 'ln' }, h('b', {}, 'SITUACIÓN'), ` ${t.ahora}`) : null,
      t.comprobado?.length ? h('ul', { class: 'a-pend' }, t.comprobado.map((x) => h('li', {}, x))) : null,
      h('div', { class: 'a-acts' }, B('Informe completo', async (b) => {
        b.disabled = true;
        try { const x = await api.cmd('ronda.informe', { trabajo: t.trabajo }); if (x?.ok) viewText(`Informe · ${t.proyecto}`, x.data.texto); else toast(x?.error || 'Sin informe', 'bad'); } finally { b.disabled = false; }
      })))) : h('p', { class: 'muted' }, 'Ninguno todavía.')),
    h('details', { class: 'panel fold' }, h('summary', {}, 'Historial del CEO'), h('ul', { class: 'a-pend' }, o.eventos.map((e) => h('li', {}, h('small', { class: 'muted' }, `${fecha(e.at)} · ${e.tipo} · `), e.texto))))];
  }

  function paint(force = false) {
    paintTop();
    if (!mode) return;
    const s = JSON.stringify([mode, list, viewing]) + online();
    // No se repinta con una ventana o un menú abiertos (se perdería lo que escribes o miras).
    if (!force && (s === sig || document.querySelector('dialog[open]:not(#mama-panel), #p-negocio details.a-more[open]'))) return;
    sig = s;
    // Conserva qué desplegables estaban abiertos al repintar.
    const abiertos = new Set([...document.querySelectorAll('#n-body details[open] > summary')].map((x) => x.textContent));
    document.getElementById('n-title').textContent = mode === 'one' ? viewing.titulo : 'Objetivos';
    { const ds = document.getElementById('p-negocio').dataset; if (mode === 'one') Object.assign(ds, { mamaObjetivo: viewing.id, mamaTitulo: viewing.titulo }); else { delete ds.mamaObjetivo; delete ds.mamaTitulo; } } // T-A
    document.getElementById('n-sub').textContent = mode === 'list' ? `${list.filter((o) => !CLOSED.includes(o.estado)).length} abiertos · ${online() ? 'PC conectado' : 'PC desconectado'}` : '';
    const abiertosL = list.filter((o) => !CLOSED.includes(o.estado)), cerradosL = list.filter((o) => CLOSED.includes(o.estado));
    document.getElementById('n-body').replaceChildren(...(mode === 'one' ? one() : [
      h('div', { class: 'ag-bar' }, h('button', { class: 'btn primary', type: 'button', disabled: !online(), onclick: (e) => crear(e.currentTarget) }, '+ Nuevo objetivo')),
      abiertosL.length ? h('div', { class: 'ag-grid' }, abiertosL.map(card)) : h('p', { class: 'empty' }, 'Escribe el resultado que quieres conseguir («Quiero conseguir clientes para GEST7 mediante redes sociales») y el CEO se organiza y trabaja solo.'),
      cerradosL.length ? h('details', { class: 'fold' }, h('summary', {}, `Terminados o cancelados (${cerradosL.length})`), h('div', { class: 'ag-grid' }, cerradosL.map(card))) : null,
    ]).flat(Infinity).filter(Boolean));
    for (const d of document.querySelectorAll('#n-body details')) if (abiertos.has(d.querySelector(':scope > summary')?.textContent)) d.open = true;
  }
  function paintTop() {
    const b = document.getElementById('b-negocio');
    const n = data().negocio?.te_necesitan || 0;
    if (b) { b.textContent = n ? `Objetivos · ${n}` : 'Objetivos'; b.classList.toggle('need', !!n); }
  }

  document.getElementById('n-back').addEventListener('click', back);
  document.getElementById('b-negocio')?.addEventListener('click', open);
  // Desde el centro de dirección: abrir uno concreto o crear uno nuevo sin pasar por la lista.
  return { paint, open, openOne: (id) => { open(); void openOne(id); }, crear: (btn) => { open(); void crear(btn); },
    intervencion: (o, n) => needCard(o, n, true), respondida, prioridadFila };
}
