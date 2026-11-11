// MAMA (T9): la sección «Mama» de CEOPadre. Una sola conversación con la asistente personal, privada y cifrada en el PC, y
// lo que MAMA ha encargado a CEOPadre (lista cerrada) con su estado real. Sólo pinta lo que devuelven mama.ver / mama.enviar.
// En el móvil (PWA remota) no se lee ni se escribe: por Supabase viajaría legible; el canal móvil cifrado es T10.
import { h } from './dom.js';

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const ESTADO = { HECHA: ['Hecha', 'ok'], DENEGADA: ['Denegada', 'bad'], TOPE: ['Tope diario', 'ask'], ERROR: ['Falló', 'bad'] };
const chip = (label, tone) => h('span', { class: `a-chip t-${tone}` }, label);

export function mamaUi({ api, toast, show, local }) {
  let abierta = false, timer = null, sig = '', v = null, enviando = false;
  const body = () => document.getElementById('m-body');

  async function load() {
    if (!local) { v = null; paint(); return; }
    const r = await api.cmd('mama.ver', {});
    if (!r?.ok) { toast(r?.error || 'No se pudo abrir MAMA', 'bad'); return; }
    v = r.data; paint();
  }
  function programar() { clearTimeout(timer); if (abierta) timer = setTimeout(async () => { if (!document.hidden) await load(); programar(); }, v?.pensando ? 1500 : 8000); }
  function open() { abierta = true; sig = ''; show('p-mama'); window.scrollTo(0, 0); void load().then(programar); }
  function back() { abierta = false; clearTimeout(timer); show('p-list'); }

  const burbuja = (m) => {
    if (m.rol === 'antonio') return h('div', { class: 'msg yo' }, h('p', {}, m.texto), h('p', { class: 'msg-who m-at' }, fecha(m.at)));
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
    const s = JSON.stringify([v?.mensajes?.length, v?.mensajes?.at(-1)?.id, v?.pensando, v?.ordenes?.map((o) => [o.id, o.trabajo_estado]), v?.uso]);
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
    b.replaceChildren(h('div', { class: 'mama-grid' }, h('section', { class: 'mama-chat', 'aria-label': 'Conversación' }, lista, form), encargos));
    const ta = document.getElementById('m-text');
    ta.value = borrador;
    if (foco) ta.focus();
    lista.scrollTop = lista.scrollHeight;
  }

  document.getElementById('m-back')?.addEventListener('click', back);
  document.getElementById('b-mama')?.addEventListener('click', open);
  return { open, abierta: () => abierta };
}
