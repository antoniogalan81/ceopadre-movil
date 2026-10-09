// EDITAR CON IA: chat de redacción sobre un texto que espera aprobación (bandeja, textos de VideoFactory…). Se abre encima
// de la pantalla de trabajo; la IA sólo propone. APLICAR cambia el texto vigente; aprobar/enviar/publicar siguen en la tarjeta.
// Cerrar sin querer no pierde nada: al volver a abrir se recupera la misma conversación (y lo que estabas escribiendo).
import { h } from './dom.js';

const DRAFT = (s) => `ceo-redactor:${s}`;
const keep = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sin almacenamiento */ } };
const load = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

export function aiEditor({ api, toast, onApplied }) {
  const dlg = document.getElementById('redactor');
  let ses = null, chosen = null, timer = null, busy = false;
  const $ = (id) => document.getElementById(id);

  async function cmd(op, params) {
    const r = await api.cmd(op, params);
    if (!r?.ok) toast(r?.error || 'No se pudo', 'bad');
    return r?.ok ? r.data : null;
  }

  /** Abre (o recupera) el editor de ese texto. destino: {tipo:'bandeja',id} | {tipo:'remoto',proyecto,item,plataforma}. */
  async function open(destino) {
    $('red-title').textContent = 'Editar con IA';
    $('red-body').replaceChildren(h('p', { class: 'muted' }, 'Abriendo…'));
    if (!dlg.open) dlg.showModal();
    const v = await cmd('redactor.abrir', { destino });
    if (!v) { dlg.close(); return; }
    ses = v;
    chosen = null;
    $('red-input').value = load(DRAFT(v.id));
    if (v.recuperada) toast('Conversación recuperada: sigue donde lo dejaste', 'ok');
    paint();
    poll();
  }

  const versions = () => (ses?.turnos || []).filter((t) => t.rol === 'ia' && t.estado === 'OK');
  const current = () => versions().find((t) => t.id === chosen) || versions().at(-1) || null;
  const pending = () => (ses?.turnos || []).some((t) => t.estado === 'PENDIENTE');

  function paint() {
    if (!ses) return;
    const v = ses;
    $('red-title').textContent = v.titulo || 'Editar con IA';
    const cur = current();
    const turns = (v.turnos || []).map((t) => (t.rol === 'antonio'
      ? h('div', { class: 'red-me' }, h('p', {}, t.texto))
      : h('div', { class: `red-ia${cur && t.id === cur.id ? ' sel' : ''}` },
        t.estado === 'PENDIENTE' ? h('p', { class: 'muted' }, 'La IA está escribiendo…')
          : t.estado === 'ERROR' ? h('p', { class: 'note' }, `No pudo responder: ${t.error || ''}. Puedes pedirlo otra vez.`)
            : [h('p', { class: 'r-text' }, t.texto), t.nota ? h('small', { class: 'muted' }, t.nota) : null,
              h('button', { class: 'btn ghost small', type: 'button', onclick: () => { chosen = t.id; paint(); } }, cur && t.id === cur.id ? '✓ Versión elegida' : 'Recuperar esta versión')])));
    const work = h('textarea', { id: 'red-text', rows: 6, 'aria-label': 'Texto que se aplicará (puedes retocarlo)' });
    work.value = cur ? cur.texto : v.base;
    $('red-body').replaceChildren(...[
      v.conflicto ? h('p', { class: 'pcline bad' }, 'El texto cambió fuera del editor mientras trabajabas: no se puede aplicar. Cierra y vuelve a abrir para partir del texto actual.') : null,
      h('details', { class: 'fold' }, h('summary', {}, 'Texto de partida'), h('p', { class: 'r-text' }, v.base)),
      turns.length ? h('div', { class: 'red-chat', 'aria-live': 'polite' }, turns)
        : h('p', { class: 'muted' }, 'Escribe abajo qué quieres cambiar («más cercano», «no me gusta cómo empieza», «añade que…») o pega tu propia versión y pide que la mejore.'),
      h('label', { class: 'field' }, cur ? 'Texto que se aplicará (puedes retocarlo a mano)' : 'Texto actual', work),
    ].filter(Boolean));
    $('red-send').disabled = pending() || busy;
    $('red-apply').disabled = pending() || busy || v.conflicto;
    $('red-send').textContent = pending() ? 'Escribiendo…' : 'SEGUIR MEJORANDO';
    const chat = dlg.querySelector('.red-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  // Mientras la IA escribe se consulta el estado sin bloquear nada más de CEOPadre.
  function poll() {
    clearTimeout(timer);
    if (!ses || !dlg.open || !pending()) return;
    timer = setTimeout(async () => {
      const v = await api.cmd('redactor.ver', { sesion: ses.id });
      if (v?.ok) { ses = v.data; chosen = null; paint(); }
      poll();
    }, 2000);
  }

  async function send() {
    const instr = $('red-input').value.trim();
    if (!instr) { toast('Escribe qué quieres cambiar', 'bad'); return; }
    busy = true; paint();
    try {
      const v = await cmd('redactor.pedir', { sesion: ses.id, instruccion: instr });
      if (v) { ses = v; $('red-input').value = ''; keep(DRAFT(ses.id), ''); }
    } finally { busy = false; paint(); poll(); }
  }

  async function apply() {
    const texto = $('red-text').value.trim();
    if (!texto) { toast('El texto no puede quedar vacío', 'bad'); return; }
    busy = true; paint();
    try {
      const v = await cmd('redactor.aplicar', { sesion: ses.id, texto });
      if (!v) return;
      toast(v.mensaje || 'Texto aplicado', 'ok');
      const learn = $('red-learn').checked;
      const done = ses.id;
      keep(DRAFT(done), '');
      ses = null; dlg.close();
      if (learn) {
        toast('Analizando si es una preferencia para el futuro…', 'ok');
        const r = await api.cmd('redactor.aprender', { sesion: done });
        toast(r?.ok ? r.data.mensaje : `No se pudo aprender: ${r?.error || ''}`, r?.ok ? 'ok' : 'bad');
      }
      onApplied?.();
    } finally { busy = false; }
  }

  async function cancel() {
    if (ses) { await cmd('redactor.cancelar', { sesion: ses.id }); keep(DRAFT(ses.id), ''); }
    ses = null; dlg.close();
    toast('Descartado: el texto no ha cambiado', 'ok');
  }

  $('red-send').addEventListener('click', send);
  $('red-apply').addEventListener('click', apply);
  $('red-cancel').addEventListener('click', cancel);
  // Cerrar (X o Esc) NO descarta: la conversación queda para la próxima vez.
  $('red-close').addEventListener('click', () => { clearTimeout(timer); dlg.close(); });
  $('red-input').addEventListener('input', () => { if (ses) keep(DRAFT(ses.id), $('red-input').value); });
  $('red-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  dlg.addEventListener('close', () => clearTimeout(timer));
  return { open };
}
