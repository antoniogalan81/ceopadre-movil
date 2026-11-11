// MAMA (T9): la sección «Mama» de CEOPadre. Una sola conversación con la asistente personal, privada y cifrada en el PC, y
// lo que MAMA ha encargado a CEOPadre (lista cerrada) con su estado real. Sólo pinta lo que devuelven mama.ver / mama.enviar.
// En el móvil (PWA remota) no se lee ni se escribe: por Supabase viajaría legible. El móvil (FocoGravital) habla con MAMA por
// el canal cifrado de T10 (src/mama-canal.js), que se empareja AQUÍ con un código de un solo uso (tarjeta «Móvil»).
import { h } from './dom.js';

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const ESTADO = { HECHA: ['Hecha', 'ok'], DENEGADA: ['Denegada', 'bad'], TOPE: ['Tope diario', 'ask'], ERROR: ['Falló', 'bad'] };
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);

export function mamaUi({ api, toast, show, local }) {
  let abierta = false, timer = null, sig = '', v = null, enviando = false, canal = null;
  const body = () => document.getElementById('m-body');

  async function load() {
    if (!local) { v = null; paint(); return; }
    const [r, c] = await Promise.all([api.cmd('mama.ver', {}), api.cmd('mama.canal.ver', {})]);
    if (!r?.ok) { toast(r?.error || 'No se pudo abrir MAMA', 'bad'); return; }
    v = r.data; canal = c?.ok ? c.data : null; paint();
  }
  function programar() { clearTimeout(timer); if (abierta) timer = setTimeout(async () => { if (!document.hidden) await load(); programar(); }, v?.pensando ? 1500 : 8000); }
  function open() { abierta = true; sig = ''; show('p-mama'); window.scrollTo(0, 0); void load().then(programar); }
  function back() { abierta = false; clearTimeout(timer); show('p-list'); }

  const burbuja = (m) => {
    if (m.rol === 'antonio') return h('div', { class: 'msg yo' }, h('p', {}, m.texto), h('p', { class: 'msg-who m-at' }, `${fecha(m.at)}${m.via === 'movil' ? ' · desde el móvil' : ''}`));
    if (m.rol === 'sistema') return h('div', { class: 'msg sis' }, h('p', {}, m.texto));
    return h('div', { class: 'msg ceo' }, h('p', { class: 'msg-who' }, `MAMA · ${fecha(m.at)}`), h('p', { class: 'msg-r' }, m.texto),
      m.inciertos?.length ? h('details', { class: 'msg-more' }, h('summary', {}, 'Lo que no sabe seguro'), h('ul', {}, m.inciertos.map((x) => h('li', {}, x)))) : null);
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

  function paint() {
    const b = body();
    if (!b) return;
    if (!local) {
      b.replaceChildren(h('section', { class: 'side-card mama-aviso' }, h('h2', {}, 'Mama se abre en el PC'),
        h('p', {}, 'La conversación con Mama es privada y está cifrada en tu PC. Desde el móvil llegará con su canal cifrado propio (en preparación): por el canal actual se vería en la nube.'),
        h('p', { class: 'muted small' }, 'Abre CEOPadre en el PC para hablar con ella.')));
      return;
    }
    const s = JSON.stringify([v?.mensajes?.length, v?.mensajes?.at(-1)?.id, v?.pensando, v?.ordenes?.map((o) => [o.id, o.trabajo_estado]), v?.uso, v?.panel, canal]);
    if (s === sig) return;
    sig = s;
    const ms = v?.mensajes || [];
    const u = v?.uso || {};
    const lista = h('div', { class: 'ceo-msgs mama-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación con Mama' },
      ms.length ? ms.map(burbuja) : h('p', { class: 'muted ceo-vacio' }, 'Cuéntale a Mama lo que quieras: una novedad, un compromiso o algo para CEOPadre.'),
      v?.pensando ? h('div', { class: 'msg ceo pensando', role: 'status' }, h('p', {}, h('span', { class: 'dots', 'aria-hidden': 'true' }, '• • •'), ' Mama está respondiendo…')) : null);
    const form = h('form', { class: 'ceo-form', onsubmit: enviar },
      h('textarea', { id: 'm-text', 'aria-label': 'Mensaje para Mama', rows: '2', maxlength: '4000', placeholder: 'Escribe a Mama…', onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(e); } }),
      h('button', { class: 'btn primary', type: 'submit', id: 'm-send', disabled: v?.pensando || false }, 'Enviar'));
    const ords = v?.ordenes || [];
    const encargos = h('section', { class: 'side-card mama-encargos', 'aria-labelledby': 'm-h-enc' },
      h('h2', { id: 'm-h-enc' }, 'Encargos a CEOPadre'),
      h('p', { class: 'muted small' }, `Hoy: ${u.ordenes ?? 0}/${u.ordenes_max ?? '—'} órdenes · ${u.ia ?? 0}/${u.ia_max ?? '—'} respuestas. Mama sólo puede: ${(v?.lista_cerrada || []).map((t) => ({ ENCARGO: 'encargar un trabajo', INSTRUCCION: 'dar una instrucción a un trabajo abierto' }[t] || t)).join(' o ') || '—'}. Nunca aprueba, envía ni gasta.`),
      ords.length ? h('ul', { class: 'side-list' }, ords.map((o) => {
        const [t, tone] = ESTADO[o.estado] || [o.estado, 'idle'];
        return h('li', { class: 'mama-orden' }, h('div', {}, chip(t, tone), ' ', h('strong', {}, `${o.tipo === 'ENCARGO' ? 'Encargo' : o.tipo === 'INSTRUCCION' ? 'Instrucción' : o.tipo}${o.proyecto ? ` · ${o.proyecto}` : ''}`)),
          h('p', { class: 'muted small' }, [fecha(o.at), o.trabajo_estado ? `trabajo: ${o.trabajo_estado}` : '', o.motivo || ''].filter(Boolean).join(' · ')));
      })) : h('p', { class: 'muted small' }, 'Todavía no ha encargado nada.'));
    const foco = document.activeElement?.id === 'm-text';
    const borrador = document.getElementById('m-text')?.value || '';
    b.replaceChildren(h('div', { class: 'mama-grid' }, h('section', { class: 'mama-chat', 'aria-label': 'Conversación' }, lista, form),
      h('div', { class: 'mama-side' }, tarjetaMovil(), ...tarjetas(v?.panel), encargos)));
    const ta = document.getElementById('m-text');
    ta.value = borrador;
    if (foco) ta.focus();
    lista.scrollTop = lista.scrollHeight;
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
    const estado = h('p', { class: 'small' }, c.conectado ? `Canal cifrado conectado${c.ultimo_ciclo ? ` · último ciclo ${fecha(c.ultimo_ciclo)}` : ''}` : c.configurado ? 'Canal configurado, sin conexión ahora' : 'Canal sin configurar en este PC (node tools/mama-remoto.mjs)',
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
        : vacio('Sin compromisos anotados. Mama sólo apunta los que tú le dices.'));
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
