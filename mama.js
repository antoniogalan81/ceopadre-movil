// MAMA (T9): la sección «Mama» de CEOPadre. Una sola conversación con la asistente personal, privada y cifrada en el PC, y
// lo que MAMA ha encargado a CEOPadre (lista cerrada) con su estado real. Sólo pinta lo que devuelven mama.ver / mama.enviar.
// En el móvil (PWA remota) no se lee ni se escribe: por Supabase viajaría legible. El móvil (FocoGravital) habla con MAMA por
// el canal cifrado de T10 (src/mama-canal.js), que se empareja AQUÍ con un código de un solo uso (tarjeta «Móvil»).
import { h } from './dom.js';
import { planDia } from './mama-plan.js';

// Enlace directo a la conversación en FocoGravital (app.json: scheme ingravitalapp, paquete com.agalansevilla.Ingravitalapp).
export const INTENT_MAMA = 'intent://mama#Intent;scheme=ingravitalapp;package=com.agalansevilla.Ingravitalapp;end';
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const ESTADO = { HECHA: ['Hecha', 'ok'], DENEGADA: ['Denegada', 'bad'], TOPE: ['Tope diario', 'ask'], ERROR: ['Falló', 'bad'], PROPUESTA: ['Propuesta', 'ask'] };
// Fase REAL del encargo (src/mama.js faseOrden): «Hecha» ya no existe; «Terminado» sólo cuando el trabajo terminó.
// T26: estado del encargo (src/mama.js estadoEncargo) en palabras de Antonio.
const ESTADO_ENCARGO = { RECIBIDO: 'recibido (propuesta)', DELEGADO: 'delegado a CEOPadre', EN_EJECUCION: 'en ejecución', RESULTADO_RECIBIDO: 'resultado recibido', VERIFICADO: 'borrador verificado', ESPERANDO_AUTORIZACION: 'esperando tu autorización (sin enviar)', CERRADO: 'cerrado', RECHAZADO: 'rechazado', DETENIDO: 'detenido por CEOPadre', CANCELADO: 'cancelado' };
const FASE_TONO = { RESULTADO: 'ok', TERMINADO: 'ok', EN_MARCHA: 'work', ESPERANDO: 'wait', TE_NECESITA: 'ask', PAUSADO: 'idle', CANCELADO: 'idle', ENTREGADA: 'work', ENCARGADA: 'work', DENEGADA: 'bad', TOPE: 'ask', ERROR: 'bad', PROPUESTA: 'ask', DETENIDO: 'bad' };
// T31: adjuntos (src/mama-adjuntos.js). Mismo tope que el servidor; el tipo y la firma los comprueba el servidor.
export const ADJ_MAX = 5 * 1024 * 1024;
const kb = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);
// T20: qué hizo MAMA con el mensaje o la nota (src/mama.js salidasDe). «Sólo conversación» = no creó nada.
const SALIDA = { MEMORIA: ['Memoria', 'ok'], FICHA: ['Ficha de proyecto', 'ok'], TAREA: ['Tarea propuesta', 'ask'], SEGUIMIENTO: ['Seguimiento', 'work'], DELEGAR: ['Delegación', 'work'], CONVERSACION: ['Sólo conversación', 'idle'], ERROR: ['No interpretada', 'bad'] };
const interpretacion = (m) => {
  const i = m.interpretacion;
  if (!i?.salidas?.length) return null;
  return h('div', { class: 'mama-interp', role: 'group', 'aria-label': 'Qué ha hecho Mama' },
    h('p', { class: 'msg-who' }, ...i.salidas.map((s) => { const [t, tone] = SALIDA[s.tipo] || [s.tipo, 'idle']; return [chip(`${t}${s.n > 1 ? ` ×${s.n}` : ''}`, tone), ' ']; }).flat()),
    i.fuente?.texto ? h('p', { class: 'muted small' }, `Fuente: ${i.fuente.tipo === 'nota' ? 'nota de tu tarea' : 'tu mensaje'} (${i.fuente.texto})`) : null);
};

export function mamaUi({ api, toast, show, local }) {
  let abierta = false, timer = null, sig = '', v = null, enviando = false, canal = null, simulacion = null, ocupado = '';
  // T38: memoria privada (sólo en el PC). Se relee cuando cambia la conversación, no en cada sondeo.
  let mem = null, memDe = null;
  const memFichas = new Map(); // id → ficha abierta (vigente + historial), sólo en esta pestaña
  const body = () => document.getElementById('m-body');

  async function load() {
    if (!local) { v = null; paint(); return; }
    const [r, c] = await Promise.all([api.cmd('mama.ver', {}), api.cmd('mama.canal.ver', {})]);
    if (!r?.ok) { toast(r?.error || 'No se pudo abrir MAMA', 'bad'); return; }
    v = r.data; canal = c?.ok ? c.data : null;
    const ult = v.mensajes?.at(-1)?.id ?? 0;
    if (ult !== memDe) { memDe = ult; await cargarMemoria(); }
    paint();
  }
  async function cargarMemoria() {
    const [e, f] = await Promise.all([api.cmd('mama.memoria.estado', {}), api.cmd('mama.memoria.fichas', {})]);
    mem = e?.ok && f?.ok ? { estado: e.data, fichas: f.data.fichas } : { error: e?.error || f?.error || 'Memoria no disponible' };
    await Promise.all([...memFichas.keys()].map(async (id) => { // las abiertas se releen (puede haber un hecho nuevo)
      const r = await api.cmd('mama.memoria.ficha', { ficha: id });
      if (r?.ok) memFichas.set(id, r.data); else memFichas.delete(id);
    }));
  }
  async function verFicha(id, abrir) {
    if (!abrir) { memFichas.delete(id); sig = ''; paint(); return; }
    memFichas.set(id, null);
    const r = await api.cmd('mama.memoria.ficha', { ficha: id });
    if (!r?.ok) { memFichas.delete(id); toast(r?.error || 'No se pudo abrir la ficha', 'bad'); return; }
    memFichas.set(id, r.data); sig = ''; paint();
  }
  function programar() { clearTimeout(timer); if (abierta) timer = setTimeout(async () => { if (!document.hidden) await load(); programar(); }, v?.pensando ? 1500 : 8000); }
  function open() { abierta = true; sig = ''; show('p-mama'); window.scrollTo(0, 0); void load().then(programar); }
  function back() { abierta = false; clearTimeout(timer); show('p-list'); }

  // T31: abrir un adjunto = vale de un solo uso (mama.adjunto.enlace). La pestaña se abre YA (gesto del usuario) y luego se dirige.
  async function abrirAdjunto(a) {
    const w = a.ver ? window.open('about:blank', '_blank') : null;
    const r = await api.cmd('mama.adjunto.enlace', { id: a.id });
    if (!r?.ok) { w?.close(); toast(r?.error || 'No se pudo abrir el archivo', 'bad'); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; return; }
    const x = h('a', { href: r.data.url, download: r.data.nombre, hidden: true });
    document.body.append(x); x.click(); x.remove();
  }
  const adjunto = (m) => (m.adjunto?.id && !m.adjunto.fallido
    ? h('button', { class: 'btn mama-adj', type: 'button', 'data-adj': m.adjunto.id, onclick: () => abrirAdjunto(m.adjunto),
      'aria-label': `${m.adjunto.ver ? 'Abrir' : 'Descargar'} ${m.adjunto.nombre || 'archivo'}` }, `📎 ${m.adjunto.nombre || 'archivo'} · ${kb(m.adjunto.bytes || 0)} · ${m.adjunto.ver ? 'Abrir' : 'Descargar'}`)
    : null);
  const burbuja = (m) => {
    if (m.rol === 'antonio' && m.adjunto?.id) return h('div', { class: 'msg yo' }, adjunto(m), h('p', { class: 'msg-who m-at' }, `${fecha(m.at)}${m.via === 'movil' ? ' · desde el móvil' : ''}`));
    if (m.rol === 'antonio') return h('div', { class: 'msg yo' }, h('p', {}, m.texto), h('p', { class: 'msg-who m-at' }, `${fecha(m.at)}${m.via === 'movil' ? ' · desde el móvil' : ''}`));
    if (m.rol === 'sistema') return h('div', { class: 'msg sis' }, h('p', {}, m.texto));
    // Su cara identifica a MAMA (12-11): no se repite «MAMA» en cada respuesta; el nombre queda para los lectores de pantalla.
    return h('div', { class: 'msg ceo msg-mama' }, h('img', { class: 'mama-av', src: 'mama-avatar-64.png', srcset: 'mama-avatar-64.png 1x, mama-avatar-128.png 2x', alt: '', width: 32, height: 32 }),
      h('div', { class: 'msg-mama-cuerpo' }, h('p', { class: 'msg-who' }, h('span', { class: 'sr-only' }, 'MAMA · '), fecha(m.at)), h('p', { class: 'msg-r' }, m.texto), adjunto(m), interpretacion(m),
        m.inciertos?.length ? h('details', { class: 'msg-more' }, h('summary', {}, 'Lo que no sabe seguro'), h('ul', {}, m.inciertos.map((x) => h('li', {}, x)))) : null));
  };

  async function enviar(e) {
    e.preventDefault();
    const ta = document.getElementById('m-text');
    const texto = ta.value.trim();
    if (!texto || enviando) return;
    enviando = true;
    const r = await api.cmd('mama.enviar', { texto });
    enviando = false;
    if (!r?.ok) { toast(r?.error || 'No se pudo enviar', 'bad'); return; }
    ta.value = ''; sig = '';
    await load(); programar();
  }

  // T31: adjuntar desde el PC. Se lee en el navegador y viaja en base64 por /api/cmd (≤ 8 MB de cuerpo: 5 MiB caben).
  async function adjuntar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || enviando) return;
    if (f.size > ADJ_MAX) { toast(`«${f.name}» supera 5 MB`, 'bad'); return; }
    if (!f.size) { toast(`«${f.name}» está vacío`, 'bad'); return; }
    enviando = true; sig = ''; paint();
    try {
      const b64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko(r.error); r.readAsDataURL(f); });
      const r = await api.cmd('mama.adjuntar', { nombre: f.name, mime: f.type, b64 });
      if (!r?.ok) { toast(r?.error || 'No se pudo adjuntar', 'bad'); return; }
      toast(r.data.mensaje, 'ok');
    } catch { toast('No se pudo leer el archivo', 'bad'); }
    finally { enviando = false; sig = ''; await load(); programar(); }
  }

  function paint() {
    const b = body();
    if (!b) return;
    if (!local) {
      // T22: aquí aterriza el toque en un aviso de Mama (?v=mama). La conversación NO se lee por este canal (viajaría legible
      // en la nube): se abre en FocoGravital, que la tiene cifrada (ingravitalapp://mama, vía intent de Android).
      b.replaceChildren(h('section', { class: 'side-card mama-aviso' }, h('h2', {}, 'Mama'),
        h('p', {}, 'Tu conversación con Mama es privada y cifrada: en el móvil se abre en FocoGravital.'),
        h('a', { class: 'btn primary', href: INTENT_MAMA, id: 'm-abrir-foco' }, 'Abrir la conversación en FocoGravital'),
        h('p', { class: 'muted small' }, 'En el PC, en la sección Mama de CEOPadre.')));
      return;
    }
    const s = JSON.stringify([enviando, v?.mensajes?.length, v?.mensajes?.at(-1)?.id, v?.pensando, v?.ordenes?.map((o) => [o.id, o.trabajo_estado, o.estado_encargo]), v?.uso, v?.panel, canal, v?.plan, simulacion, ocupado, mem, [...memFichas]]);
    if (s === sig) return;
    sig = s;
    const ms = v?.mensajes || [];
    const u = v?.uso || {};
    const lista = h('div', { class: 'ceo-msgs mama-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación con Mama' },
      ms.length ? ms.map(burbuja) : h('p', { class: 'muted ceo-vacio' }, 'Cuéntale a Mama lo que quieras: una novedad, un compromiso o algo para CEOPadre.'),
      v?.pensando ? h('div', { class: 'msg ceo pensando', role: 'status' }, h('p', {}, h('span', { class: 'dots', 'aria-hidden': 'true' }, '• • •'), ' Mama está respondiendo…')) : null);
    const form = h('form', { class: 'ceo-form', onsubmit: enviar },
      h('textarea', { id: 'm-text', 'aria-label': 'Mensaje para Mama', rows: '2', maxlength: '4000', placeholder: 'Escribe a Mama…', onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(e); } }),
      h('input', { type: 'file', id: 'm-file', hidden: true, onchange: adjuntar,
        accept: '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.txt,.csv,.docx,.xlsx,.pptx,.doc,.xls' }),
      h('button', { class: 'btn', type: 'button', id: 'm-adjuntar', disabled: enviando, title: 'Adjuntar un archivo (hasta 5 MB)',
        onclick: () => document.getElementById('m-file')?.click() }, enviando ? 'Adjuntando…' : '📎 Adjuntar'),
      h('button', { class: 'btn primary', type: 'submit', id: 'm-send', disabled: v?.pensando || false }, 'Enviar'));
    const ords = v?.ordenes || [];
    const encargos = h('section', { class: 'side-card mama-encargos', 'aria-labelledby': 'm-h-enc' },
      h('h2', { id: 'm-h-enc' }, 'Encargos a CEOPadre'),
      h('p', { class: 'muted small' }, `Hoy: ${u.ordenes ?? 0}/${u.ordenes_max ?? '—'} órdenes · ${u.ia ?? 0}/${u.ia_max ?? '—'} respuestas. Mama sólo puede: ${(v?.lista_cerrada || []).map((t) => ({ ENCARGO: 'encargar un trabajo', INSTRUCCION: 'dar una instrucción a un trabajo abierto' }[t] || t)).join(' o ') || '—'}. Nunca aprueba, envía ni gasta.`),
      ords.length ? h('ul', { class: 'side-list' }, ords.map((o) => {
        const [t, tone] = o.fase ? [o.texto, FASE_TONO[o.fase] || 'idle'] : ESTADO[o.estado] || [o.estado, 'idle'];
        return h('li', { class: 'mama-orden' }, h('div', {}, chip(t, tone), ' ', h('strong', {}, `${o.tipo === 'ENCARGO' ? 'Encargo' : o.tipo === 'INSTRUCCION' ? 'Instrucción' : o.tipo}${o.proyecto ? ` · ${o.proyecto}` : ''}`)),
          h('p', { class: 'muted small' }, [fecha(o.at), o.estado_encargo ? `estado: ${ESTADO_ENCARGO[o.estado_encargo] || o.estado_encargo}` : '', o.trabajo_estado ? `trabajo: ${o.trabajo_estado}` : '', o.motivo || ''].filter(Boolean).join(' · ')));
      })) : h('p', { class: 'muted small' }, 'Todavía no ha encargado nada.'));
    const foco = document.activeElement?.id === 'm-text';
    const borrador = document.getElementById('m-text')?.value || '';
    const frases = ['m-frase', 'm-frase2'].map((id) => document.getElementById(id)?.value || ''); // una repintada no borra lo tecleado
    const copiaAbierta = document.getElementById('m-mem-copia')?.open || false;
    b.replaceChildren(h('div', { class: 'mama-grid' }, h('section', { class: 'mama-chat', 'aria-label': 'Conversación' }, lista, form),
      h('div', { class: 'mama-side' }, tarjetaPlan(), tarjetaReglas(), tarjetaMovil(), ...tarjetas(v?.panel), tarjetaMemoria(), encargos)));
    ['m-frase', 'm-frase2'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = frases[i]; });
    const dc = document.getElementById('m-mem-copia'); if (dc && copiaAbierta) dc.open = true;
    const ta = document.getElementById('m-text');
    ta.value = borrador;
    if (foco) ta.focus();
    lista.scrollTop = lista.scrollHeight;
  }

  // T29: plan del día (T24) y reglas de avisos (T23), BAJO DEMANDA. Nada se repite solo desde aquí.
  async function bajoDemanda(op, que) {
    if (ocupado) return;
    ocupado = op; sig = ''; paint();
    const r = await api.cmd(op, {});
    ocupado = ''; sig = '';
    if (!r?.ok) { toast(r?.error || `No se pudo ${que}`, 'bad'); paint(); return; }
    if (op === 'mama.plan.preparar') v = { ...v, plan: r.data.plan }; else simulacion = r.data;
    paint();
  }
  function tarjetaPlan() {
    const n = planDia(v?.plan);
    n.id = 'm-plan';
    n.append(h('div', { class: 'mama-movil-bot' }, h('button', { class: 'btn', type: 'button', id: 'm-plan-preparar', disabled: !!ocupado,
      onclick: () => bajoDemanda('mama.plan.preparar', 'preparar el plan') }, ocupado === 'mama.plan.preparar' ? 'Preparando…' : 'Preparar el plan ahora')),
    h('p', { class: 'muted small' }, 'Sólo con tus tareas, compromisos y decisiones reales; sin IA y sin tocar tus tareas.'));
    return n;
  }
  function tarjetaReglas() {
    const s = simulacion;
    const PR = { urgente: 'bad', alta: 'ask', normal: 'idle' };
    return h('section', { class: 'side-card mama-reglas', id: 'm-reglas', 'aria-labelledby': 'm-reglas-h' }, h('h2', { id: 'm-reglas-h' }, 'Avisos de Mama'),
      h('p', { class: 'small' }, v?.reglas?.recurrencia ? 'Revisión automática ACTIVA.' : 'Revisión automática apagada (pendiente de tu aprobación).'),
      h('button', { class: 'btn', type: 'button', id: 'm-reglas-revisar', disabled: !!ocupado, onclick: () => bajoDemanda('mama.reglas.revisar', 'revisar los avisos') },
        ocupado === 'mama.reglas.revisar' ? 'Revisando…' : 'Revisar ahora (simulación)'),
      s ? h('div', { role: 'status', id: 'm-reglas-res' }, h('p', { class: 'small' }, `${fecha(s.at)} · ${s.pendientes} aviso${s.pendientes === 1 ? '' : 's'} saldría${s.pendientes === 1 ? '' : 'n'}${s.silencio ? ' (ahora es horario de silencio: esperarían a las 8:00)' : ''}. Simulación: no se ha enviado nada.`),
        s.saldrian.length ? h('ul', { class: 'side-list' }, s.saldrian.map((x) => h('li', { 'data-tipo': x.tipo }, chip(x.prioridad, PR[x.prioridad] || 'idle'), ' ', h('span', { class: 'small' }, x.texto)))) : null) : null);
  }

  // T38: memoria privada de MAMA. Lo que cuentas en la conversación queda aquí con su tipo, fuente y fecha (cifrado en el PC).
  const TIPO_HECHO = { CONFIRMADO: ['Confirmado', 'ok'], ESTIMACION: ['Estimación', 'ask'], HISTORICO: ['Histórico', 'idle'], PENDIENTE: ['Por comprobar', 'wait'] };
  async function copia(conFrase) {
    if (ocupado) return;
    const [a, b] = ['m-frase', 'm-frase2'].map((id) => document.getElementById(id));
    const frase = conFrase ? a?.value || '' : '';
    if (conFrase && frase.length < 12) { toast('La frase necesita al menos 12 caracteres', 'bad'); return; }
    if (conFrase && frase !== b?.value) { toast('Las dos frases no coinciden', 'bad'); return; }
    ocupado = 'mama.memoria.copia'; sig = ''; paint();
    const r = await api.cmd('mama.memoria.copia', conFrase ? { frase } : {});
    ocupado = '';
    for (const el of [a, b, ...['m-frase', 'm-frase2'].map((id) => document.getElementById(id))]) if (el) el.value = '';
    if (!r?.ok) toast(r?.error || 'No se pudo hacer la copia', 'bad');
    else toast(r.data.restaurada ? `Copia hecha y comprobada (restaurada con ${r.data.restaurada_con})` : 'La copia no superó la comprobación', r.data.restaurada ? 'ok' : 'bad');
    await cargarMemoria(); sig = ''; paint();
  }
  function tarjetaMemoria() {
    const card = (...hijos) => h('section', { class: 'side-card mama-memoria', id: 'm-mem', 'aria-labelledby': 'm-mem-h' }, h('h2', { id: 'm-mem-h' }, 'Memoria'), ...hijos);
    if (!mem) return card(h('p', { class: 'muted small' }, 'Cargando…'));
    if (mem.error) return card(h('p', { class: 'bad small' }, mem.error));
    const e = mem.estado, c = e.ultima_copia;
    const fichas = mem.fichas || [];
    const ficha = (f) => {
      const d = memFichas.get(f.id);
      return h('li', { 'data-ficha': f.id }, h('details', { open: memFichas.has(f.id), ontoggle: (ev) => { if (ev.target.open !== memFichas.has(f.id)) void verFicha(f.id, ev.target.open); } },
        h('summary', {}, h('strong', {}, f.nombre), h('span', { class: 'muted small' }, ` · ${f.tipo === 'PROYECTO' ? 'proyecto' : 'personal'} · ${f.entradas}`)),
        !memFichas.has(f.id) ? null : !d ? h('p', { class: 'muted small' }, 'Abriendo…') : h('ul', { class: 'side-list' },
          ...d.hechos.map((x) => { const [t, tone] = TIPO_HECHO[x.tipo] || [x.tipo, 'idle']; return h('li', { 'data-hecho': x.id }, h('strong', {}, `${x.clave}: `), x.valor, ' ', chip(t, tone), h('p', { class: 'muted small' }, `${x.fuente} · ${x.fecha}`)); }),
          ...d.decisiones.map((x) => h('li', {}, h('strong', {}, 'Decisión: '), x.texto, h('p', { class: 'muted small' }, `${x.fuente} · ${x.fecha}`))),
          d.historial.length > d.hechos.length + d.decisiones.length ? h('li', { class: 'muted small' }, `${d.historial.length - d.hechos.length - d.decisiones.length} anotación(es) anterior(es) sustituida(s), conservadas en el historial`) : null)));
    };
    return card(
      h('p', { class: 'small', id: 'm-mem-estado' }, `${e.fichas} ficha${e.fichas === 1 ? '' : 's'} · ${e.entradas} anotaci${e.entradas === 1 ? 'ón' : 'ones'} · `,
        chip(e.ok ? 'Íntegra' : 'Revisar', e.ok ? 'ok' : 'bad'), ' ', chip(e.aces === 1 ? 'Sólo tu usuario' : `Acceso: ${e.aces} permisos`, e.aces === 1 ? 'ok' : 'bad')),
      fichas.length ? h('ul', { class: 'side-list', id: 'm-mem-fichas' }, fichas.map(ficha)) : h('p', { class: 'muted small' }, 'Vacía. Mama sólo anota lo que tú le cuentas y conviene recordar.'),
      h('details', { class: 'mama-copia', id: 'm-mem-copia' }, h('summary', {}, 'Copia de seguridad'),
        h('p', { class: 'small', id: 'm-mem-ultima' }, c ? `Última: ${fecha(c.creada)} · ${c.con_frase ? 'con frase de recuperación' : 'sin frase (sólo se recupera en este usuario de este PC)'}` : 'Aún no hay copias.'),
        h('p', { class: 'muted small' }, 'Frase de recuperación (12 caracteres o más): guárdala tú, fuera del PC. Mama no la guarda en ningún sitio; sin ella, la copia sólo se recupera aquí.'),
        h('label', { class: 'small', for: 'm-frase' }, 'Frase'), h('input', { type: 'password', id: 'm-frase', autocomplete: 'new-password', minlength: '12' }),
        h('label', { class: 'small', for: 'm-frase2' }, 'Repite la frase'), h('input', { type: 'password', id: 'm-frase2', autocomplete: 'new-password', minlength: '12' }),
        h('div', { class: 'mama-movil-bot' },
          h('button', { class: 'btn primary', type: 'button', id: 'm-copia-frase', disabled: !!ocupado, onclick: () => copia(true) }, ocupado === 'mama.memoria.copia' ? 'Copiando…' : 'Copia con frase'),
          h('button', { class: 'btn', type: 'button', id: 'm-copia', disabled: !!ocupado, onclick: () => copia(false) }, 'Copia sin frase'))));
  }

  // T10: emparejar el móvil (código de un solo uso, 10 min) y revocarlo. El código sólo vive en la memoria del PC.
  async function canalCmd(op, aviso) {
    const r = await api.cmd(op, {});
    if (!r?.ok) { toast(r?.error || 'No se pudo', 'bad'); return; }
    canal = r.data; sig = ''; paint();
    if (aviso && r.data?.mensaje) toast(r.data.mensaje, 'ok');
  }
  function tarjetaMovil() {
    const c = canal;
    const card = (...hijos) => h('section', { class: 'side-card mama-movil', 'aria-labelledby': 'm-mov-h' }, h('h2', { id: 'm-mov-h' }, 'Móvil'), ...hijos);
    if (!c) return card(h('p', { class: 'muted small' }, 'Estado del canal móvil no disponible.'));
    const estado = h('p', { class: 'small' }, c.conectado ? `Canal cifrado conectado${c.ultimo_ciclo ? ` · último ciclo ${fecha(c.ultimo_ciclo)}` : ''}` : c.configurado ? 'Canal configurado, sin conexión ahora' : 'Canal sin sesión en este PC (la crea CEOPadre: node tools/mama-sesion.mjs --autonomo)',
      c.error && c.configurado ? h('span', { class: 'muted' }, ` · ${c.error}`) : null);
    const par = c.par ? h('p', { class: 'small' }, chip(c.par.confirmado ? 'Emparejado' : 'Pendiente de confirmar', c.par.confirmado ? 'ok' : 'ask'), ' ',
      h('strong', {}, c.par.dispositivo || 'Móvil'), h('span', { class: 'muted small' }, ` · desde ${fecha(c.par.desde)}`)) : h('p', { class: 'muted small' }, 'Ningún móvil emparejado.');
    const codigo = c.codigo ? h('div', { class: 'mama-codigo', role: 'status' },
      h('p', { class: 'small' }, 'Escribe este código en Mama del móvil:'),
      h('p', { class: 'mama-codigo-v', 'aria-label': `Código ${c.codigo.valor.split('').join(' ')}` }, c.codigo.valor),
      h('p', { class: 'muted small' }, `Caduca a las ${new Date(c.codigo.expira).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · un solo uso${c.codigo.intentos ? ` · ${c.codigo.intentos} intento(s) fallido(s)` : ''}`),
      h('button', { class: 'btn', type: 'button', onclick: () => canalCmd('mama.canal.cancelar') }, 'Anular código')) : null;
    const botones = h('div', { class: 'mama-movil-bot' },
      c.codigo ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => canalCmd('mama.canal.codigo') }, c.par ? 'Emparejar otro móvil' : 'Emparejar móvil'),
      c.par ? h('button', { class: 'btn', type: 'button', onclick: () => { if (window.confirm('¿Desemparejar el móvil? Su clave se borra y tendrás que emparejarlo de nuevo.')) void canalCmd('mama.canal.revocar', true); } }, 'Desemparejar') : null);
    return card(estado, par, codigo, botones, h('p', { class: 'muted small' }, 'Sólo un móvil a la vez. La conversación viaja cifrada: la nube nunca la lee.'));
  }

  // §4: actividades y compromisos, decisiones pendientes y resumen del día. Sólo datos (sin IA): src/mama.js panel().
  function tarjetas(pn) {
    if (!pn) return [];
    const card = (id, titulo, ...hijos) => h('section', { class: 'side-card', id, 'aria-labelledby': `${id}-h` }, h('h2', { id: `${id}-h` }, titulo), ...hijos);
    const vacio = (t) => h('p', { class: 'muted small' }, t);
    const a = pn.actividades || {};
    const oh = a.ordenes_hoy || {};
    const nOrd = Object.values(oh).reduce((x, y) => x + y, 0);
    const act = card('m-act', 'Actividades y compromisos',
      h('p', { class: 'small' }, `Hoy: ${a.mensajes_hoy ?? 0} mensaje${a.mensajes_hoy === 1 ? '' : 's'} tuyo${a.mensajes_hoy === 1 ? '' : 's'} · ${a.respuestas_hoy ?? 0} respuesta${a.respuestas_hoy === 1 ? '' : 's'} de Mama · ${nOrd} ${nOrd === 1 ? "orden" : "órdenes"}${nOrd ? ` (${Object.entries(oh).map(([e, n]) => `${n} ${(ESTADO[e]?.[0] || e).toLowerCase()}`).join(', ')})` : ''} · ${a.encargos_abiertos ?? 0} encargo${a.encargos_abiertos === 1 ? '' : 's'} en curso`),
      a.compromisos?.length ? h('ul', { class: 'side-list mama-comp' }, a.compromisos.map((c) => h('li', {}, h('strong', {}, c.texto), c.cuando ? h('span', { class: 'muted small' }, ` · ${c.cuando}`) : null)))
        : vacio('Sin compromisos anotados. Mama sólo apunta los que tú le dices.'),
      a.tareas_propuestas?.length ? h('details', { class: 'mama-prop', open: true }, h('summary', {}, `Tareas propuestas (${a.tareas_propuestas.length}) · no creadas en FocoGravital`),
        h('ul', { class: 'side-list' }, a.tareas_propuestas.map((t) => h('li', {}, h('strong', {}, t.titulo), t.cuando ? h('span', { class: 'muted small' }, ` · ${t.cuando}`) : null,
          h('p', { class: 'muted small' }, [t.motivo, t.fuente].filter(Boolean).join(' · ')))))) : null);
    const dec = card('m-dec', `Decisiones pendientes (${pn.decisiones?.length || 0})`,
      pn.decisiones?.length ? h('ul', { class: 'side-list' }, pn.decisiones.map((d) => h('li', {}, h('strong', {}, `${d.proyecto}: ${d.que}`), d.detalle ? h('p', { class: 'muted small' }, d.detalle) : null)))
        : vacio('Nada espera tu decisión.'),
      h('p', { class: 'muted small' }, 'Se deciden en su tarjeta de CEOPadre: Mama nunca aprueba ni rechaza.'));
    const r = pn.resumen || {};
    const res = card('m-res', `Resumen del día · ${pn.dia || ''}`,
      h('p', { class: 'small' }, r.linea || '—'),
      r.objetivos?.length ? h('ul', { class: 'side-list' }, r.objetivos.map((o) => h('li', {}, h('strong', {}, o.titulo), h('span', { class: 'muted small' }, ` · ${o.estado.toLowerCase()}`),
        o.kpis?.length ? h('p', { class: 'muted small' }, o.kpis.map((k) => `${k.nombre}: ${k.valor ?? '—'}${k.unidad ? ` ${k.unidad}` : ''} / ${k.objetivo ?? '—'}`).join(' · ')) : null))) : null,
      r.trabajando?.length ? h('details', {}, h('summary', {}, `En marcha (${r.trabajando.length})`), h('ul', { class: 'side-list' }, r.trabajando.map((t) => h('li', {}, h('strong', {}, t.proyecto), h('p', { class: 'muted small' }, t.ahora || t.objetivo))))) : null,
      r.problemas?.length ? h('details', {}, h('summary', {}, `Problemas (${r.problemas.length})`), h('ul', { class: 'side-list' }, r.problemas.map((p) => h('li', {}, `${p.proyecto}: ${p.que}`)))) : null);
    return [act, dec, res];
  }

  document.getElementById('m-back')?.addEventListener('click', back);
  document.getElementById('b-mama')?.addEventListener('click', open);
  return { open, abierta: () => abierta };
}
