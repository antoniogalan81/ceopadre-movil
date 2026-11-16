// PANEL DE TAREAS de FocoGravital dentro de CEOPadre (misión 16-11). Sin chat y sin lógica propia: lee mama.tareas.panel y cada
// botón es UNA operación de mama.tareas.operar, el MISMO motor que la conversación con MAMA (src/mama-tareas.js: alcance,
// protegidas, compare-and-set, relectura). «Hecho» sólo cuando FocoGravital lo refleja (estado de la operación, no del clic).
// El nodo se crea UNA vez y se recoloca en cada repintado de la sección Mama: no se pierde lo que se está escribiendo.
import { h } from './dom.js';

const VISTAS = [['hoy', 'Hoy y atrasadas'], ['proximas', 'Próximas'], ['hechas', 'Hechas'], ['archivadas', 'Archivadas'], ['borradas', 'Borradas']];
const OP_TXT = { CREAR: 'crear', POSPONER: 'cambiar fecha', ACTUALIZAR: 'renombrar', COMPLETAR: 'marcar hecha', NOTA: 'añadir nota', ARCHIVAR: 'archivar', ELIMINAR: 'eliminar' };
const sumarDia = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fechaCorta = (f, hora) => (f ? `${new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}${hora ? ` ${hora}` : ''}` : 'sin fecha');
const op = (accion, x = {}) => ({ accion, tarea: '', titulo: '', fecha: '', hora: '', texto: '', aviso: '', ...x });

export function tareasUi({ api, toast }) {
  let d = null, vista = 'hoy', filtro = '', timer = null, vigilar = 0, abierto = new Set();
  const lista = h('div', { class: 'mt-lista', 'aria-live': 'polite' });
  const estado = h('p', { class: 'muted small mt-estado' });
  const pestanas = h('div', { class: 'mt-vistas', role: 'tablist' });
  const alta = h('form', { class: 'mt-alta', onsubmit: crear },
    h('label', { for: 'mt-titulo', class: 'sr-only' }, 'Tarea nueva'),
    h('input', { id: 'mt-titulo', placeholder: 'Tarea nueva…', maxlength: 200, required: true }),
    h('label', { for: 'mt-fecha', class: 'sr-only' }, 'Fecha'), h('input', { id: 'mt-fecha', type: 'date' }),
    h('label', { for: 'mt-hora', class: 'sr-only' }, 'Hora'), h('input', { id: 'mt-hora', type: 'time' }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Crear'));
  const buscar = h('input', { type: 'search', class: 'mt-buscar', placeholder: 'Buscar…', 'aria-label': 'Buscar tareas', oninput: (e) => { filtro = e.target.value.trim().toLowerCase(); pintar(); } });
  const el = h('section', { class: 'side-card mama-tareas', id: 'm-tareas', 'aria-labelledby': 'mt-h' },
    h('h2', { id: 'mt-h' }, 'Tareas (FocoGravital)'), estado, alta, h('div', { class: 'mt-barra' }, pestanas, buscar), lista);

  async function cargar() {
    const r = await api.cmd('mama.tareas.panel', {});
    if (!r?.ok) { estado.textContent = r?.error || 'No se pudieron leer las tareas'; return; }
    d = r.data; pintar();
  }
  // Tras un clic se relee hasta que la operación deja de estar pendiente (máx. ~40 s); después, el sondeo normal de la sección.
  function seguir() { vigilar = 20; clearTimeout(timer); const t = async () => { await cargar(); if (--vigilar > 0 && d?.ops?.some((o) => o.estado === 'PENDIENTE')) timer = setTimeout(t, 2000); }; timer = setTimeout(t, 800); }

  async function operar(o, quien) {
    const r = await api.cmd('mama.tareas.operar', { id: crypto.randomUUID(), op: o });
    if (!r?.ok) { toast(r?.error || 'No se pudo', 'bad'); return; }
    const x = r.data;
    if (x.estado === 'ENCOLADA') toast(`${quien}: enviado a FocoGravital; se confirma al comprobarlo`, 'ok');
    else toast(`${quien}: NO hecho — ${x.texto || x.estado}`, 'bad');
    seguir();
  }
  async function crear(e) {
    e.preventDefault();
    const t = document.getElementById('mt-titulo'), f = document.getElementById('mt-fecha'), hh = document.getElementById('mt-hora');
    if (hh.value && !f.value) { toast('Para la hora hace falta la fecha', 'bad'); return; }
    await operar(op('crear', { titulo: t.value.trim(), fecha: f.value, hora: hh.value }), `«${t.value.trim()}»`);
    t.value = ''; hh.value = '';
  }

  const enVista = (t) => {
    const hoy = d.hoy;
    if (vista === 'borradas') return t.borrada;
    if (t.borrada) return false;
    if (vista === 'archivadas') return t.archivada;
    if (t.archivada) return false;
    if (vista === 'hechas') return t.completada;
    if (t.completada) return false;
    return vista === 'hoy' ? !!t.fecha && t.fecha <= hoy : !t.fecha || t.fecha > hoy;
  };
  const pendiente = (t) => d.ops.find((o) => o.tarea === t.id && o.estado === 'PENDIENTE');
  const ultimaOp = (t) => d.ops.find((o) => o.tarea === t.id);

  function fila(t) {
    const p = pendiente(t), u = ultimaOp(t), id = t.id;
    const nombre = `«${t.titulo}»`;
    const atrasada = !t.completada && t.fecha && t.fecha < d.hoy;
    const estadoOp = p ? h('span', { class: 'a-chip t-work' }, `${OP_TXT[p.tipo] || p.tipo}: enviándose…`)
      : u && u.estado === 'HECHA' && !u.comprobada ? h('span', { class: 'a-chip t-bad' }, 'FocoGravital no lo refleja')
        : u && u.estado === 'DESCARTADA' ? h('span', { class: 'a-chip t-bad', title: u.motivo || '' }, `no hecho: ${u.motivo || 'descartado'}`) : null;
    const b = (txt, o, extra = {}) => h('button', { class: 'btn small', type: 'button', disabled: !!p || !d.escritura, onclick: () => operar(o, `${txt} ${nombre}`), ...extra }, txt);
    const acciones = t.borrada ? [b('Recuperar', op('recuperar', { tarea: id }))]
      : t.archivada ? [b('Desarchivar', op('desarchivar', { tarea: id }))]
        : t.completada ? [b('Archivar', op('archivar', { tarea: id }))]
          : [b('Hecha', op('completar', { tarea: id })), b('Mañana', op('posponer', { tarea: id, fecha: sumarDia(d.hoy, 1), hora: t.hora || '' }))];
    const mas = !t.borrada && !t.completada && !t.archivada ? h('details', { class: 'mt-mas', open: abierto.has(id), ontoggle: (e) => { if (e.target.open) abierto.add(id); else abierto.delete(id); } },
      h('summary', {}, 'Más'),
      h('form', { class: 'mt-mini', onsubmit: (e) => { e.preventDefault(); const f = e.target.elements; operar(op('posponer', { tarea: id, fecha: f.f.value, hora: f.h.value }), `Fecha de ${nombre}`); } },
        h('input', { name: 'f', type: 'date', required: true, value: t.fecha || '', 'aria-label': 'Fecha nueva' }), h('input', { name: 'h', type: 'time', value: t.hora || '', 'aria-label': 'Hora' }),
        h('button', { class: 'btn small', type: 'submit', disabled: !!p }, 'Cambiar fecha')),
      h('form', { class: 'mt-mini', onsubmit: (e) => { e.preventDefault(); operar(op('nota', { tarea: id, texto: e.target.elements.n.value }), `Nota en ${nombre}`); e.target.reset(); } },
        h('input', { name: 'n', required: true, maxlength: 2000, placeholder: 'Nota…', 'aria-label': 'Nota' }), h('button', { class: 'btn small', type: 'submit', disabled: !!p }, 'Añadir nota')),
      h('form', { class: 'mt-mini', onsubmit: (e) => { e.preventDefault(); operar(op('actualizar', { tarea: id, titulo: e.target.elements.t.value }), 'Renombrar'); } },
        h('input', { name: 't', required: true, maxlength: 200, value: t.titulo, 'aria-label': 'Título' }), h('button', { class: 'btn small', type: 'submit', disabled: !!p }, 'Renombrar')),
      h('p', {}, b('Archivar', op('archivar', { tarea: id })), ' ',
        // Eliminar es recuperable (borrado lógico), pero se confirma con un segundo toque.
        h('button', { class: 'btn small danger', type: 'button', disabled: !!p || !d.escritura, onclick: (e) => {
          if (e.target.dataset.seguro) { operar(op('eliminar', { tarea: id }), `Eliminar ${nombre}`); return; }
          e.target.dataset.seguro = '1'; e.target.textContent = '¿Seguro? Eliminar';
        } }, 'Eliminar'))) : null;
    return h('li', { class: `mt-fila${atrasada ? ' mt-atrasada' : ''}`, 'data-tarea': id },
      h('div', { class: 'mt-linea' }, h('strong', {}, t.titulo || '(sin título)'), ' ', h('span', { class: 'muted small' }, `${atrasada ? 'atrasada · ' : ''}${fechaCorta(t.fecha, t.hora)}`), ' ', estadoOp),
      h('div', { class: 'mt-acc' }, ...acciones), mas);
  }

  function pintar() {
    if (!d) { estado.textContent = 'Leyendo tus tareas…'; return; }
    estado.textContent = !d.conectado ? `Sin conexión con FocoGravital${d.error ? ` (${d.error})` : ''}: se ve la última copia.`
      : !d.escritura ? 'Sólo lectura: la escritura en tus tareas no está activada.'
        : `Cambios con el mismo motor que Mama (alcance: ${d.alcance === 'ordinarias' ? 'tareas ordinarias; dinero, listas y recurrentes, en FocoGravital' : 'sólo «PRUEBA MAMA»'}). «Hecho» = comprobado en FocoGravital.`;
    pestanas.replaceChildren(...VISTAS.map(([k, txt]) => {
      const n = d.tareas.filter((t) => { const v = vista; vista = k; const r = enVista(t); vista = v; return r; }).length;
      return h('button', { class: `btn small${vista === k ? ' primary' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(vista === k), onclick: () => { vista = k; pintar(); } }, `${txt} (${n})`);
    }));
    const xs = d.tareas.filter(enVista).filter((t) => !filtro || t.titulo.toLowerCase().includes(filtro))
      .sort((a, b) => (vista === 'hoy' || vista === 'proximas' ? String(a.fecha || '9999').localeCompare(String(b.fecha || '9999')) || String(a.hora || '').localeCompare(String(b.hora || '')) : String(b.fecha || '').localeCompare(String(a.fecha || ''))));
    lista.replaceChildren(xs.length ? h('ul', { class: 'side-list' }, xs.map(fila)) : h('p', { class: 'muted small' }, filtro ? 'Nada coincide con la búsqueda.' : 'Nada aquí.'));
  }

  return { el, cargar };
}
