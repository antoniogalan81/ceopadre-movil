// MAMA (T9): la sección «Mama» de CEOPadre. Una sola conversación con la asistente personal, privada y cifrada en el PC, y
// lo que MAMA ha encargado a CEOPadre (lista cerrada) con su estado real. Sólo pinta lo que devuelven mama.ver / mama.enviar.
// En el móvil (PWA remota) la conversación NO va por ceo_orden (viajaría legible): va por el canal cifrado de T10
// (src/mama-canal.js) con el cliente de FocoGravital APP (web/mama-movil.js), emparejado AQUÍ con un código de un solo uso.
import { h } from './dom.js';
import { planDia } from './mama-plan.js';
import { mamaMovil } from './mama-movil.js';
import { tareasUi } from './mama-tareas.js';
import { describir, leer } from './mama-contexto.js';
import { seguimientoUi } from './tarjeta.js';

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const ESTADO = { HECHA: ['Hecha', 'ok'], DENEGADA: ['Denegada', 'bad'], TOPE: ['Tope diario', 'ask'], ERROR: ['Falló', 'bad'], PROPUESTA: ['Propuesta', 'ask'] };
// Fase REAL del encargo (src/mama.js faseOrden): «Hecha» ya no existe; «Terminado» sólo cuando el trabajo terminó.
// T26: estado del encargo (src/mama.js estadoEncargo) en palabras de Antonio.
const ESTADO_ENCARGO = { RECIBIDO: 'recibido (propuesta)', DELEGADO: 'delegado a CEOPadre', EN_EJECUCION: 'en ejecución', RESULTADO_RECIBIDO: 'resultado recibido', VERIFICADO: 'borrador verificado', ESPERANDO_AUTORIZACION: 'esperando tu autorización (sin enviar)', CERRADO: 'cerrado', RECHAZADO: 'rechazado', DETENIDO: 'detenido por CEOPadre', CANCELADO: 'cancelado' };
const FASE_TONO = { RESULTADO: 'ok', TERMINADO: 'ok', EN_MARCHA: 'work', ESPERANDO: 'wait', TE_NECESITA: 'ask', PAUSADO: 'idle', CANCELADO: 'idle', ENTREGADA: 'work', ENCARGADA: 'work', DENEGADA: 'bad', TOPE: 'ask', ERROR: 'bad', PROPUESTA: 'ask', DETENIDO: 'bad' };
// T31: adjuntos (src/mama-adjuntos.js). Mismo tope que el servidor; el tipo y la firma los comprueba el servidor.
export const ADJ_MAX = 5 * 1024 * 1024;
const kb = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`); // T36: «1 KB» no se parte
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);
// T20: qué hizo MAMA con el mensaje o la nota (src/mama.js salidasDe). «Sólo conversación» = no creó nada.
const SALIDA = { MEMORIA: ['Memoria', 'ok'], FICHA: ['Ficha de proyecto', 'ok'], TAREA: ['Tarea propuesta', 'ask'], SEGUIMIENTO: ['Seguimiento', 'work'], DELEGAR: ['Delegación', 'work'], ACCION: ['Acción sobre lo que tienes delante', 'work'], GYM: ['GYM', 'work'], ENTRENADOR: ['Especialista consultado', 'ok'], CONVERSACION: ['Sólo conversación', 'idle'], ERROR: ['No interpretada', 'bad'] };
// MEMORIA/FICHA cuentan DATOS anotados (salidasDe cuenta propuestas de memoria), no fichas: «Ficha de proyecto ×2» con dos datos en
// UNA ficha parecía una ficha duplicada (T38 r11, conv. real #124). El resto cuenta elementos (×n).
export const etiquetaSalida = (s) => {
  const [t, tone] = SALIDA[s.tipo] || [s.tipo, 'idle'];
  const datos = s.tipo === 'MEMORIA' || s.tipo === 'FICHA';
  return [s.n > 1 ? `${t}${datos ? ` · ${s.n} datos` : ` ×${s.n}`}` : t, tone];
};
const interpretacion = (m) => {
  const i = m.interpretacion;
  if (!i?.salidas?.length) return null;
  return h('div', { class: 'mama-interp', role: 'group', 'aria-label': 'Qué ha hecho Mama' },
    h('p', { class: 'msg-who' }, ...i.salidas.map((s) => [chip(...etiquetaSalida(s)), ' ']).flat()),
    i.fuente?.texto ? h('p', { class: 'muted small' }, `Fuente: ${i.fuente.tipo === 'nota' ? 'nota de tu tarea' : 'tu mensaje'} (${i.fuente.texto})`) : null);
};

export function mamaUi({ api, toast, show, local }) {
  let abierta = false, timer = null, sig = '', v = null, enviando = false, canal = null, simulacion = null, ocupado = '';
  let enPanel = false, ctxActual = null; // T-A: panel contextual (misma conversación) y el elemento del que se habla
  // §7.3: conversación abierta (undefined = la última; 'nuevo' = aún sin primer mensaje), búsqueda y mensaje hallado a resaltar.
  let hilo, busq = null, buscando = null, hallado = null;
  let enCurso = null; // T36: el mensaje que se está enviando (se ve ya y sobrevive a un repintado del sondeo)
  // T38: memoria privada (sólo en el PC). Se relee cuando cambia la conversación, no en cada sondeo.
  let mem = null, memDe = null;
  const memFichas = new Map(); // id → ficha abierta (vigente + historial), sólo en esta pestaña
  const body = () => document.getElementById('m-body');
  let movil = null, movilVivo = false;
  const panelTareas = local ? tareasUi({ api, toast }) : null; // nodo único: se recoloca en cada repintado, no se recrea // MAMA en la PWA (web/mama-movil.js): el mismo canal cifrado que FocoGravital APP

  async function load() {
    if (!local) { v = null; paint(); return; }
    const [r, c] = await Promise.all([api.cmd('mama.ver', Number.isInteger(hilo) ? { hilo } : {}), api.cmd('mama.canal.ver', {})]);
    if (!r?.ok) { toast(r?.error || 'No se pudo abrir MAMA', 'bad'); return; }
    v = r.data; canal = c?.ok ? c.data : null;
    if (hilo !== 'nuevo') hilo = v.hilo;
    void panelTareas?.cargar();
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
  function open() { if (enPanel) cerrarPanel(); abierta = true; sig = ''; show('p-mama'); window.scrollTo(0, 0); void load().then(programar); }
  function back() { abierta = false; clearTimeout(timer); movil?.parar(); movilVivo = false; show('p-list'); }

  // T-A · PANEL CONTEXTUAL: la MISMA conversación (el mismo #m-body, que se traslada) en un panel encima de la pantalla actual,
  // con el elemento que Antonio tenía delante (contrato de web/mama-contexto.js). Cerrar = volver exactamente donde estaba.
  const dlg = () => document.getElementById('mama-panel');
  function pintarCtx() {
    const t = document.getElementById('mp-ctx');
    if (t) t.textContent = ctxActual ? `Sobre: ${describir(ctxActual)}` : 'Conversación general';
    const sin = document.getElementById('mp-sin'); if (sin) sin.hidden = !ctxActual;
    if (dlg()) { if (ctxActual) Object.assign(dlg().dataset, { ctxTipo: ctxActual.tipo, ctxId: ctxActual.id || '' }); else { delete dlg().dataset.ctxTipo; delete dlg().dataset.ctxId; } }
  }
  function panel(ctx = null) {
    const d = dlg(), b = body();
    if (!d || !b) return;
    if (!document.getElementById('p-mama').hidden) { open(); return; } // ya está en Mama: nada que superponer
    ctxActual = ctx;
    pintarCtx();
    if (!enPanel) { document.getElementById('mp-host').append(b); enPanel = true; sig = ''; movilVivo = false; }
    if (!d.open) d.showModal();
    abierta = true;
    void load().then(programar).then(() => document.getElementById('m-text')?.focus() || document.getElementById('mm-text')?.focus());
  }
  function cerrarPanel() {
    const d = dlg();
    if (d?.open) d.close();
    if (!enPanel) return;
    enPanel = false; ctxActual = null; abierta = false; clearTimeout(timer); movil?.parar(); movilVivo = false; sig = '';
    document.getElementById('p-mama').append(body());
  }

  // T31: abrir un adjunto = vale de un solo uso (mama.adjunto.enlace). La pestaña se abre YA (gesto del usuario) y luego se dirige.
  async function abrirAdjunto(a) {
    const w = a.ver ? window.open('about:blank', '_blank') : null;
    const r = await api.cmd('mama.adjunto.enlace', { id: a.id });
    if (!r?.ok) { w?.close(); toast(r?.error || 'No se pudo abrir el archivo', 'bad'); return; }
    if (w) { w.opener = null; w.location.href = r.data.url; return; }
    const x = h('a', { href: r.data.url, download: r.data.nombre, hidden: true });
    document.body.append(x); x.click(); x.remove();
  }
  // `abrir`: en el PC, el vale del servidor; en la PWA, el archivo cifrado que guarda el propio móvil (web/mama-movil.js).
  const adjunto = (m, abrir = abrirAdjunto) => (m.adjunto?.id && !m.adjunto.fallido
    ? h('button', { class: 'btn mama-adj', type: 'button', 'data-adj': m.adjunto.id, onclick: () => abrir(m.adjunto),
      'aria-label': `${m.adjunto.ver ? 'Abrir' : 'Descargar'} ${m.adjunto.nombre || 'archivo'}` }, `📎 ${m.adjunto.nombre || 'archivo'} · ${kb(m.adjunto.bytes || 0)} · ${m.adjunto.ver ? 'Abrir' : 'Descargar'}`)
    : null);
  const burbuja = (m, abrir) => {
    if (m.rol === 'antonio' && m.adjunto?.id) return h('div', { class: 'msg yo' }, adjunto(m, abrir), h('p', { class: 'msg-who m-at' }, `${fecha(m.at)}${m.via === 'movil' ? ' · desde el móvil' : ''}`));
    if (m.rol === 'antonio') return h('div', { class: 'msg yo' }, h('p', {}, m.texto), h('p', { class: 'msg-who m-at' }, `${fecha(m.at)}${m.via === 'movil' ? ' · desde el móvil' : ''}`),
      m.contexto ? h('p', { class: 'msg-who m-ctx', 'data-ctx-tipo': m.contexto.tipo }, `Sobre: ${describir(m.contexto)}`) : null);
    if (m.rol === 'sistema') return h('div', { class: 'msg sis' }, h('p', {}, m.texto));
    // Su cara identifica a MAMA (12-11): no se repite «MAMA» en cada respuesta; el nombre queda para los lectores de pantalla.
    return h('div', { class: 'msg ceo msg-mama' }, h('img', { class: 'mama-av', src: 'mama-avatar-64.png', srcset: 'mama-avatar-64.png 1x, mama-avatar-128.png 2x', alt: '', width: 32, height: 32 }),
      h('div', { class: 'msg-mama-cuerpo' }, h('p', { class: 'msg-who' }, h('span', { class: 'sr-only' }, 'MAMA · '), fecha(m.at)), h('p', { class: 'msg-r' }, m.texto), adjunto(m, abrir), interpretacion(m),
        ...(v?.ordenes || []).filter((o) => o.mensaje_id === m.id).map((o) => seguimientoUi(o.seguimiento) || h('p', { class: 'msg-who' }, chip(o.texto || o.estado, FASE_TONO[o.fase] || 'idle'))), // 19-11: cada encargo bajo la respuesta que lo originó
        m.inciertos?.length ? h('details', { class: 'msg-more' }, h('summary', {}, 'Lo que no sabe seguro'), h('ul', {}, m.inciertos.map((x) => h('li', {}, x)))) : null));
  };

  const enviandoBurbuja = () => { const b = burbuja({ rol: 'antonio', ...enCurso }); b.classList.add('m-pend'); b.append(h('p', { class: 'msg-who m-envio' }, 'enviando…')); return b; };
  async function enviar(e) {
    e.preventDefault();
    const ta = document.getElementById('m-text');
    const texto = ta.value.trim();
    if (!texto || enviando) return;
    // T36: lo enviado se ve YA en la conversación («enviando…») y la caja queda libre; si falla, se quita y el texto vuelve.
    enCurso = { texto, at: new Date().toISOString() };
    const l = body()?.querySelector('.mama-msgs');
    l?.querySelector('.ceo-vacio')?.remove(); l?.append(enviandoBurbuja()); if (l) l.scrollTop = l.scrollHeight;
    bajar = true; // lo suyo y la respuesta se ven aunque estuviera leyendo arriba
    ta.value = '';
    enviando = true;
    const r = await api.cmd('mama.enviar', { texto, ...(enPanel && ctxActual ? { contexto: ctxActual } : {}), ...(hilo !== undefined ? { hilo } : {}) });
    enviando = false; enCurso = null;
    if (r?.ok && r.data?.hilo !== undefined) hilo = r.data.hilo; // la conversación nueva ya tiene id: lo siguiente va a ella
    if (!r?.ok) {
      body()?.querySelectorAll('.m-pend').forEach((x) => x.remove());
      const t2 = document.getElementById('m-text'); if (t2 && !t2.value) t2.value = texto;
      toast(r?.error || 'No se pudo enviar', 'bad'); return;
    }
    sig = '';
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
      // Misión 16-11: MAMA vive en CEOPadre también en el móvil. La conversación viaja por el canal cifrado de extremo a extremo
      // (no por ceo_orden, que sería legible en la nube). T22: aquí aterriza también el toque en un aviso de Mama (?v=mama).
      if (movilVivo) return;
      movilVivo = true;
      // T31: los archivos de la conversación se adjuntan, reciben y abren también aquí (web/mama-movil.js, misma burbuja).
      movil ??= mamaMovil({ toast, burbuja, ADJ_MAX, contexto: () => (enPanel ? ctxActual : null) });
      void movil.iniciar(b);
      return;
    }
    const s = JSON.stringify([hilo, v?.hilos, busq, hallado, enviando, v?.mensajes?.length, v?.mensajes?.at(-1)?.id, v?.pensando, v?.ordenes?.map((o) => [o.id, o.trabajo_estado, o.estado_encargo, o.seguimiento?.actualizado]), v?.uso, v?.panel, canal, v?.plan, simulacion, ocupado, mem, [...memFichas]]);
    if (s === sig) return;
    sig = s;
    const ms = hilo === 'nuevo' ? [] : v?.mensajes || [];
    const u = v?.uso || {};
    const lista = h('div', { class: 'ceo-msgs mama-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación con Mama' },
      ms.length || enCurso ? ms.map((m) => { const x = burbuja(m); x.dataset.mid = m.id; if (m.id === hallado) x.classList.add('m-hallado'); return x; })
        : h('p', { class: 'muted ceo-vacio' }, hilo === 'nuevo' ? 'Conversación nueva: escribe el primer mensaje (su título saldrá de él). Mama recuerda lo de siempre.' : 'Cuéntale a Mama lo que quieras: una novedad, un compromiso o algo para CEOPadre.'),
      enCurso ? enviandoBurbuja() : null,
      v?.pensando ? h('div', { class: 'msg ceo pensando', role: 'status' }, h('p', {}, h('span', { class: 'dots', 'aria-hidden': 'true' }, '• • •'), ' Mama está respondiendo…')) : null);
    const form = h('form', { class: 'ceo-form', onsubmit: enviar },
      h('textarea', { id: 'm-text', 'aria-label': 'Mensaje para Mama', rows: '2', maxlength: '4000', placeholder: 'Escribe a Mama…', onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(e); } }),
      h('input', { type: 'file', id: 'm-file', hidden: true, onchange: adjuntar,
        accept: '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.txt,.csv,.docx,.xlsx,.pptx,.doc,.xls' }),
      h('button', { class: 'btn', type: 'button', id: 'm-adjuntar', disabled: enviando, title: 'Adjuntar un archivo (hasta 5 MB)',
        onclick: () => document.getElementById('m-file')?.click() }, enviando ? 'Adjuntando…' : '📎 Adjuntar'),
      h('button', { class: 'btn primary', type: 'submit', id: 'm-send', disabled: v?.pensando || false }, 'Enviar'));
    const ords = v?.ordenes || [];
    const encargos = h('section', { class: 'side-card mama-encargos', id: 'm-enc', 'aria-labelledby': 'm-h-enc' },
      h('h2', { id: 'm-h-enc' }, 'Encargos a CEOPadre'),
      h('p', { class: 'muted small' }, `Hoy: ${u.ordenes ?? 0}/${u.ordenes_max ?? '—'} órdenes · ${u.ia ?? 0}/${u.ia_max ?? '—'} respuestas. Mama sólo puede: ${(v?.lista_cerrada || []).map((t) => ({ ENCARGO: 'encargar un trabajo', INSTRUCCION: 'dar una instrucción a un trabajo abierto' }[t] || t)).join(' o ') || '—'}. Nunca aprueba, envía ni gasta.`),
      ords.length ? h('ul', { class: 'side-list' }, ords.map((o) => {
        const [t, tone] = o.fase ? [o.texto, FASE_TONO[o.fase] || 'idle'] : ESTADO[o.estado] || [o.estado, 'idle'];
        return h('li', { class: 'mama-orden' }, h('div', {}, chip(t, tone), ' ', h('strong', {}, `${o.tipo === 'ENCARGO' ? 'Encargo' : o.tipo === 'INSTRUCCION' ? 'Instrucción' : o.tipo}${o.proyecto ? ` · ${o.proyecto}` : ''}`)),
          h('p', { class: 'muted small' }, [fecha(o.at), o.estado_encargo ? `estado: ${ESTADO_ENCARGO[o.estado_encargo] || o.estado_encargo}` : '', o.trabajo_estado ? `trabajo: ${o.trabajo_estado}` : '', o.motivo || ''].filter(Boolean).join(' · ')));
      })) : h('p', { class: 'muted small' }, 'Todavía no ha encargado nada.'));
    // POSICIÓN DE LECTURA (GOAL 18-11 §7.2): antes cada repintado (un encargo que avanza, el uso, una respuesta) bajaba al final y
    // sacaba a Antonio de lo que leía. Ahora sólo se baja si ya estaba abajo o acaba de escribir; si no, se conserva y se avisa.
    const vieja = b.querySelector('.mama-msgs');
    const abajo = bajar || !vieja || vieja.scrollHeight - vieja.scrollTop - vieja.clientHeight < 80;
    const y = vieja?.scrollTop || 0, nuevos = vieja ? ms.length - nVistos : 0;
    nVistos = ms.length; bajar = false;
    const foco = document.activeElement?.id === 'm-text';
    const borrador = document.getElementById('m-text')?.value || '';
    const frases = ['m-frase', 'm-frase2'].map((id) => document.getElementById(id)?.value || ''); // una repintada no borra lo tecleado
    const copiaAbierta = document.getElementById('m-mem-copia')?.open || false;
    const hilosAbierto = document.getElementById('m-hilos')?.open || false;
    const qBusca = document.getElementById('m-buscar')?.value || '', focoBusca = document.activeElement?.id === 'm-buscar';
    b.replaceChildren(h('div', { class: 'mama-grid' }, h('section', { class: 'mama-chat', 'aria-label': 'Conversación' }, barraHilos(), pendientes(v?.panel), lista, form),
      h('div', { class: 'mama-side' }, panelTareas.el, tarjetaPlan(), tarjetaReglas(), tarjetaMovil(), ...tarjetas(v?.panel), tarjetaMemoria(), encargos)));
    ['m-frase', 'm-frase2'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = frases[i]; });
    const dc = document.getElementById('m-mem-copia'); if (dc && copiaAbierta) dc.open = true;
    const dh = document.getElementById('m-hilos'); if (dh && hilosAbierto) dh.open = true;
    const ib = document.getElementById('m-buscar'); if (ib) { ib.value = qBusca; if (focoBusca) ib.focus({ preventScroll: true }); }
    const ta = document.getElementById('m-text');
    ta.value = borrador;
    if (foco) ta.focus({ preventScroll: true });
    const hx = hallado && lista.querySelector(`[data-mid="${hallado}"]`);
    if (hx) { lista.scrollTop = Math.max(0, hx.offsetTop - lista.offsetTop - 20); hallado = null; }
    else if (abajo) lista.scrollTop = lista.scrollHeight;
    else { lista.scrollTop = y; if (nuevos > 0) avisoNuevos(lista); }
  }
  let bajar = false, nVistos = 0;

  // §7.3 · CONVERSACIONES: abrir una antigua, empezar otra y buscar en todas. Títulos y temas los pone el PC (sin clasificar a mano).
  function barraHilos() {
    const hs = v?.hilos || [];
    const titulo = hilo === 'nuevo' ? 'Conversación nueva' : hs.find((x) => x.id === hilo)?.titulo || 'Conversación principal';
    const grupos = new Map();
    for (const x of hs) { const g = x.tema || 'General'; grupos.set(g, [...(grupos.get(g) || []), x]); }
    const fila = (x) => h('li', {}, h('button', { class: `btn small${x.id === hilo ? ' primary' : ''}`, type: 'button', 'data-hilo': x.id,
      'aria-current': x.id === hilo ? 'true' : null, onclick: () => abrirHilo(x.id) }, x.titulo), ' ', h('span', { class: 'muted small' }, `${x.n} mensajes · ${fecha(x.ultimo)}`));
    return h('div', { class: 'mama-hilos' },
      h('details', { id: 'm-hilos' }, h('summary', {}, h('strong', { id: 'm-hilo-titulo' }, titulo), h('span', { class: 'muted small' }, ` · ${hs.length} conversaci${hs.length === 1 ? 'ón' : 'ones'}`)),
        h('input', { type: 'search', id: 'm-buscar', placeholder: 'Buscar en todas las conversaciones…', 'aria-label': 'Buscar en las conversaciones con Mama', maxlength: '120', oninput: buscarLuego }),
        busq ? h('div', { id: 'm-resultados', role: 'status' }, busq.resultados.length
          ? h('ul', { class: 'side-list' }, busq.resultados.map((r) => h('li', {}, h('button', { class: 'btn small', type: 'button', 'data-hallado': r.id, onclick: () => abrirHilo(r.hilo, r.id) },
            r.titulo || 'Conversación'), h('p', { class: 'muted small' }, `${fecha(r.at)} · ${r.fragmento}`))))
          : h('p', { class: 'muted small' }, `Nada con «${busq.q}».`)) : null,
        ...[...grupos].map(([g, xs]) => h('section', { 'aria-label': g }, grupos.size > 1 ? h('h3', { class: 'small' }, g) : null, h('ul', { class: 'side-list m-hilos-lista' }, xs.map(fila))))),
      h('button', { class: 'btn small', type: 'button', id: 'm-nueva', disabled: hilo === 'nuevo', onclick: nuevaConversacion }, '+ Nueva'));
  }
  async function abrirHilo(id, msg = null) { document.getElementById('m-hilos')?.removeAttribute('open'); hilo = id; hallado = msg; bajar = !msg; sig = ''; await load(); }
  function nuevaConversacion() { hilo = 'nuevo'; sig = ''; paint(); document.getElementById('m-text')?.focus(); }
  function buscarLuego(e) {
    clearTimeout(buscando);
    const q = e.target.value.trim();
    if (q.length < 2) { if (busq) { busq = null; sig = ''; paint(); } return; }
    buscando = setTimeout(async () => {
      const r = await api.cmd('mama.buscar', { q });
      if (!r?.ok) { toast(r?.error || 'No se pudo buscar', 'bad'); return; }
      busq = r.data; sig = ''; paint();
    }, 250);
  }
  /** «Mensajes nuevos ↓»: discreto; bajar es decisión de Antonio. Se quita solo al llegar abajo. */
  function avisoNuevos(lista) {
    const b = h('button', { class: 'btn primary small ceo-nuevo', type: 'button', onclick: () => { lista.scrollTo({ top: lista.scrollHeight, behavior: 'smooth' }); b.remove(); } }, 'Mensajes nuevos ↓');
    lista.after(b);
    lista.addEventListener('scroll', () => { if (lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80) b.remove(); }, { passive: true });
  }

  // T36: lo que te espera, DENTRO de la conversación (decisiones, tareas propuestas, compromisos, encargos en curso). Un toque
  // lleva a su tarjeta (que queda enfocada para el teclado y el lector de pantalla). Sin nada pendiente no se pinta nada.
  function pendientes(pn) {
    const a = pn?.actividades || {};
    const xs = [[pn?.decisiones?.length, 'm-dec', 'decisión', 'decisiones'], [a.tareas_propuestas?.length, 'm-act', 'tarea propuesta', 'tareas propuestas'],
      [a.compromisos?.length, 'm-act', 'compromiso', 'compromisos'], [a.encargos_abiertos, 'm-enc', 'encargo en curso', 'encargos en curso']].filter(([n]) => n > 0);
    if (!xs.length) return null;
    return h('nav', { class: 'mama-pend', 'aria-label': 'Lo que te espera' }, h('span', { class: 'muted small' }, 'Te espera:'),
      ...xs.map(([n, id, uno, varios]) => h('button', { class: 'btn small', type: 'button', 'data-ir': id, onclick: () => irA(id) }, `${n} ${n === 1 ? uno : varios}`)));
  }
  function irA(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.setAttribute('tabindex', '-1');
    c.scrollIntoView({ block: 'start' });
    c.focus({ preventScroll: true });
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
  // T22 r3: estado visible de la revisión automática y su pausa (persistente; efecto en la siguiente pasada, sin reinicio).
  async function pausar(pausa) {
    if (ocupado) return;
    ocupado = 'mama.reglas.pausar'; sig = ''; paint();
    const r = await api.cmd('mama.reglas.pausar', { pausa });
    ocupado = ''; sig = '';
    if (!r?.ok) toast(r?.error || 'No se pudo cambiar', 'bad');
    else { v = { ...v, reglas: r.data }; toast(pausa ? 'Avisos automáticos en pausa' : 'Avisos automáticos reanudados', 'ok'); }
    paint();
  }
  function interruptor(g) {
    const u = g?.ultima;
    const pasada = u ? ` · última pasada ${fecha(u.at)}${u.error ? ` (falló: ${u.error})` : `: ${u.avisos} aviso${u.avisos === 1 ? '' : 's'} nuevo${u.avisos === 1 ? '' : 's'}${u.silencio ? ', horario de silencio' : ''}`}` : '';
    const texto = g?.recurrencia ? `Revisión automática ACTIVA cada ${g.cada_s} s${pasada}.`
      : g?.pausada && g?.armada && g?.aprobada ? 'Revisión automática EN PAUSA (la pausaste tú).'
        : 'Revisión automática apagada (pendiente de tu aprobación).';
    const boton = g?.armada && g?.aprobada ? h('button', { class: 'btn', type: 'button', id: 'm-reglas-pausa', disabled: !!ocupado, 'aria-pressed': String(!!g.pausada),
      onclick: () => pausar(!g.pausada) }, ocupado === 'mama.reglas.pausar' ? 'Cambiando…' : g.pausada ? 'Reanudar avisos automáticos' : 'Pausar avisos automáticos') : null;
    return [h('p', { class: 'small', id: 'm-reglas-estado' }, texto), boton];
  }
  function tarjetaReglas() {
    const s = simulacion;
    const PR = { urgente: 'bad', alta: 'ask', normal: 'idle' };
    return h('section', { class: 'side-card mama-reglas', id: 'm-reglas', 'aria-labelledby': 'm-reglas-h' }, h('h2', { id: 'm-reglas-h' }, 'Avisos de Mama'),
      ...interruptor(v?.reglas),
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
  // T38: comprobar la ÚLTIMA copia sólo con la frase (como en otro PC); queda anotada la fecha, nunca la frase.
  async function comprobar() {
    if (ocupado) return;
    const a = document.getElementById('m-frase');
    const frase = a?.value || '';
    if (frase.length < 12) { toast('Escribe tu frase (12 caracteres o más) en «Frase»', 'bad'); return; }
    ocupado = 'mama.memoria.comprobar'; sig = ''; paint();
    const r = await api.cmd('mama.memoria.comprobar', { frase });
    ocupado = '';
    for (const id of ['m-frase', 'm-frase2']) { const el = document.getElementById(id); if (el) el.value = ''; }
    if (a) a.value = '';
    toast(r?.ok ? 'Copia comprobada: se recupera con tu frase' : r?.error || 'No se pudo comprobar', r?.ok ? 'ok' : 'bad');
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
        h('p', { class: 'small', id: 'm-mem-ultima' }, c ? `Última: ${fecha(c.creada)} · ${c.con_frase ? `con frase de recuperación · ${c.comprobada ? `comprobada con tu frase el ${fecha(c.comprobada)}` : 'sin comprobar con tu frase'}` : 'sin frase (sólo se recupera en este usuario de este PC)'}` : 'Aún no hay copias.'),
        e.ultima_con_frase && e.ultima_con_frase.copia !== c?.copia ? h('p', { class: 'small', id: 'm-mem-ultima-frase' }, `Última con frase: ${fecha(e.ultima_con_frase.creada)} · ${e.ultima_con_frase.comprobada ? `comprobada con tu frase el ${fecha(e.ultima_con_frase.comprobada)}` : 'sin comprobar con tu frase'}`) : null,
        h('p', { class: 'muted small' }, 'Frase de recuperación (12 caracteres o más): guárdala tú, fuera del PC. Mama no la guarda en ningún sitio; sin ella, la copia sólo se recupera aquí.'),
        h('label', { class: 'small', for: 'm-frase' }, 'Frase'), h('input', { type: 'password', id: 'm-frase', autocomplete: 'new-password', minlength: '12' }),
        h('label', { class: 'small', for: 'm-frase2' }, 'Repite la frase'), h('input', { type: 'password', id: 'm-frase2', autocomplete: 'new-password', minlength: '12' }),
        h('div', { class: 'mama-movil-bot' },
          h('button', { class: 'btn primary', type: 'button', id: 'm-copia-frase', disabled: !!ocupado, onclick: () => copia(true) }, ocupado === 'mama.memoria.copia' ? 'Copiando…' : 'Copia con frase'),
          h('button', { class: 'btn', type: 'button', id: 'm-copia', disabled: !!ocupado, onclick: () => copia(false) }, 'Copia sin frase'),
          e.ultima_con_frase ? h('button', { class: 'btn', type: 'button', id: 'm-comprobar', disabled: !!ocupado, title: 'Restaura de prueba la última copia CON FRASE sólo con tu frase (escríbela en «Frase»), sin la clave de este PC', onclick: () => void comprobar() }, ocupado === 'mama.memoria.comprobar' ? 'Comprobando…' : 'Comprobar con mi frase') : null)));
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
    // 16-11: con qué correo entrar en MAMA del móvil (el de la cuenta de FocoGravital; con otro, «no tiene cuenta»).
    const cuenta = c.cuenta ? h('p', { class: 'small', id: 'm-mov-cuenta' }, 'En el móvil, entra con el correo ', h('strong', {}, c.cuenta), ' (tu cuenta de FocoGravital).') : null;
    return card(estado, cuenta, par, codigo, botones, h('p', { class: 'muted small' }, 'Sólo un móvil a la vez. La conversación viaja cifrada: la nube nunca la lee.'));
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
    const res = card('m-res', ['Resumen del día · ', h('span', { class: 'nw' }, pn.dia || '')], // T36: la fecha no se parte
      h('p', { class: 'small' }, r.linea || '—'),
      r.objetivos?.length ? h('ul', { class: 'side-list' }, r.objetivos.map((o) => h('li', {}, h('strong', {}, o.titulo), h('span', { class: 'muted small' }, ` · ${o.estado.toLowerCase()}`),
        o.kpis?.length ? h('p', { class: 'muted small' }, o.kpis.map((k) => `${k.nombre}: ${k.valor ?? '—'}${k.unidad ? ` ${k.unidad}` : ''} / ${k.objetivo ?? '—'}`).join(' · ')) : null))) : null,
      r.trabajando?.length ? h('details', {}, h('summary', {}, `En marcha (${r.trabajando.length})`), h('ul', { class: 'side-list' }, r.trabajando.map((t) => h('li', {}, h('strong', {}, t.proyecto), h('p', { class: 'muted small' }, t.ahora || t.objetivo))))) : null,
      r.problemas?.length ? h('details', {}, h('summary', {}, `Problemas (${r.problemas.length})`), h('ul', { class: 'side-list' }, r.problemas.map((p) => h('li', {}, `${p.proyecto}: ${p.que}`)))) : null);
    return [act, dec, res];
  }

  document.getElementById('m-back')?.addEventListener('click', back);
  document.getElementById('mp-cerrar')?.addEventListener('click', cerrarPanel);
  document.getElementById('mp-todo')?.addEventListener('click', () => { cerrarPanel(); document.getElementById('b-mama')?.click(); });
  document.getElementById('mp-sin')?.addEventListener('click', () => { ctxActual = null; pintarCtx(); document.getElementById('m-text')?.focus(); });
  dlg()?.addEventListener('cancel', (e) => { e.preventDefault(); cerrarPanel(); });
  dlg()?.addEventListener('click', (e) => { if (e.target === dlg()) cerrarPanel(); }); // clic fuera = cerrar (como el resto de paneles)
  // El ELEMENTO con el que Antonio estaba: el último marcado que tocó o enfocó (en la pantalla visible y hace < 10 min).
  let ultimo = null, ultimoAt = 0;
  const anotar = (e) => { if (e.target.closest?.('#mama-panel, #b-mama-fab')) return; const n = e.target.closest?.('[data-mama-tipo]'); if (n) { ultimo = n; ultimoAt = Date.now(); } };
  document.addEventListener('pointerdown', anotar, true);
  document.addEventListener('focusin', anotar, true);
  // Un panel modal abierto (Alquileres, una ficha, un editor) deja inerte el resto de la página: el botón se muda DENTRO del de más
  // arriba mientras esté abierto, para que MAMA siga a mano también ahí, y vuelve al cuerpo al cerrarse.
  // El de ARRIBA es el último ABIERTO, no el último del documento (18-11 en vivo: el editor #dlg abierto sobre la ficha de
  // Alquileres va antes en el DOM; el botón se metía en la ficha, quedaba tapado por el editor y MAMA no se podía abrir).
  const abiertoEn = new WeakMap(); let orden = 0;
  const modal = () => {
    const ds = [...document.querySelectorAll('dialog[open]')].filter((d) => d.id !== 'mama-panel' && d.matches(':modal'));
    for (const d of ds) if (!abiertoEn.has(d)) abiertoEn.set(d, ++orden);
    return ds.sort((a, b) => abiertoEn.get(a) - abiertoEn.get(b)).at(-1) || null;
  };
  /** Contexto actual: dentro de un panel modal, lo tocado en él, el propio panel o lo que lo abrió; si no, lo último tocado a la vista
   *  y, si nada, la pantalla visible. */
  function contextoActual() {
    const pant = [...document.querySelectorAll('.screen')].find((x) => !x.hidden);
    // Repintado entre el toque y el botón (18-11 en vivo, al cerrar un editor): el nodo es otro, el elemento es el mismo.
    if (ultimo && !ultimo.isConnected && ultimo.dataset.mamaTipo) ultimo = document.querySelector(`[data-mama-tipo="${CSS.escape(ultimo.dataset.mamaTipo)}"][data-mama-id="${CSS.escape(ultimo.dataset.mamaId || '')}"]`) || ultimo;
    const reciente = ultimo?.isConnected && Date.now() - ultimoAt < 600_000;
    const m = modal();
    if (m) return (reciente && m.contains(ultimo) ? leer(ultimo) : null) || leer(m) || (reciente ? leer(ultimo) : null) || (pant ? leer(pant) : null);
    if (reciente && pant?.contains(ultimo)) return leer(ultimo);
    return pant ? leer(pant) : null;
  }
  const fab = document.getElementById('b-mama-fab');
  fab?.addEventListener('click', () => panel(contextoActual()));
  if (fab) {
    // Consulta contextual (ampliación 18-11): el panel «Consultar» ya ofrece MAMA (selector Automático · MAMA · CEO); el flotante,
    // acceso secundario, no se duplica dentro de él (además tapaba su botón Enviar).
    const recolocar = () => { const destino = modal() || document.body; fab.hidden = destino.id === 'ceo'; if (fab.parentNode !== destino) destino.append(fab); };
    new MutationObserver(recolocar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] }); // childList: un panel quitado abierto
    document.addEventListener('close', (e) => { abiertoEn.delete(e.target); recolocar(); }, true); // un dialog cerrado y quitado del DOM no deja mutación de «open» que ver
  }
  document.getElementById('b-mama')?.addEventListener('click', open);
  // T38: acceso directo a «Memoria → Copia de seguridad» (sólo en el PC: la frase nunca viaja por el canal remoto).
  async function abrirCopia() {
    const mas = document.getElementById('more'); if (mas) mas.open = false;
    abierta = true; sig = ''; show('p-mama');
    await load(); programar();
    const d = document.getElementById('m-mem-copia');
    if (!d) { toast('La memoria de Mama no está disponible ahora', 'bad'); return; }
    d.open = true; d.scrollIntoView({ block: 'center' }); document.getElementById('m-frase')?.focus();
  }
  const bc = document.getElementById('b-mama-copia');
  if (bc) { bc.hidden = !local; bc.addEventListener('click', () => void abrirCopia()); }
  /** Añadido #9 (19-11): en la PWA, la conversación de «Consultar» trae de MAMA sólo la referencia (el canal de CEOPadre no lleva su
   *  texto). Se completa como conMama del PC, pero con el historial cifrado de este móvil (canal de extremo a extremo emparejado).
   *  Devuelve la conversación y cuántas respuestas aún no han llegado al móvil (para reintentar). En el PC no hace nada. */
  async function conMamaMovil(conv) {
    const ids = local || !conv ? [] : conv.mensajes.flatMap((m) => (m.datos?.via === 'MAMA' ? m.datos.mama || [] : []));
    if (!ids.length) return { conv, faltan: 0 };
    movil ??= mamaMovil({ toast, burbuja, ADJ_MAX, contexto: () => (enPanel ? ctxActual : null) });
    const tx = await movil.textosPc(ids);
    const mensajes = conv.mensajes.map((m) => (m.datos?.via === 'MAMA' && m.datos.mama?.length && m.datos.mama.every((i) => tx[i])
      ? { ...m, texto: [m.rol === 'ceo' ? null : m.texto, ...m.datos.mama.map((i) => tx[i])].filter(Boolean).join('\n\n') } : m));
    return { conv: { ...conv, mensajes }, faltan: ids.filter((i) => !tx[i]).length };
  }
  return { open, panel, cerrarPanel, contextoActual, abierta: () => abierta, conMamaMovil };
}
