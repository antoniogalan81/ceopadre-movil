// MENSAJES (16-11): bajo la bandeja de respuestas (que sigue igual: editar, mejorar con IA, aprobar y enviar), lo que faltaba:
// quién entra (por contacto, PENDIENTE por defecto), su memoria («Analizar contexto»), preparar una respuesta y cómo quiere
// Antonio que se conteste (preferencias y correcciones por contacto, categoría o en general). Sólo en el PC: son datos privados.
// Nada de aquí envía: los borradores van a la bandeja y salen sólo con «Aprobar y enviar».
import { h } from './dom.js';

const NIVEL = { PENDIENTE: 'Sin clasificar', EXCLUIDO: 'Excluido (no se analiza)', LECTURA: 'Sólo leer y recordar', BORRADORES: 'Preparar borradores' };
const TIPO = { HECHO: 'Hecho', PROPUESTA: 'Propuesta', ACUERDO: 'Acuerdo', COMPROMISO: 'Compromiso', PENDIENTE: 'Pendiente', CONTRADICHO: 'Contradicho', SUPOSICION: 'Suposición', OBSOLETO: 'Obsoleto' };
const AMBITO = { contacto: 'Sólo este contacto', categoria: 'Toda su categoría', global: 'Todos los mensajes' };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function mensajesUi({ api, toast }) {
  let contactos = [], prefs = [], filtro = 'incluidos', abierto = null, analisis = null, ocupado = '';
  const lista = h('div', { class: 'msj-lista' });
  const panel = h('div', { class: 'msj-panel' });
  const vistas = h('div', { class: 'msj-vistas', role: 'tablist' });
  const prefsBox = h('div', { class: 'msj-prefs' });
  const el = h('section', { class: 'side-card mensajes', id: 'mensajes', 'aria-labelledby': 'msj-h' },
    h('h2', { id: 'msj-h' }, 'Contactos y memoria'),
    h('p', { class: 'muted small' }, 'Sólo los contactos que incluyas se analizan y reciben borradores; el resto no se guarda. Excluir borra lo ya guardado de ese contacto.'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => accion('ingerir', () => api.cmd('mensajes.ingerir', {}), (d) => `Leídas ${d.revisiones} revisiones · ${d.mensajes} mensajes nuevos · ${(d.borradores || []).filter((x) => x.preparado).length} borradores`) }, 'Leer mensajes nuevos')),
    vistas, lista, panel, h('h3', {}, 'Cómo quieres que responda'), prefsBox);

  async function cargar() {
    const [c, p] = await Promise.all([api.cmd('mensajes.contactos', {}), api.cmd('mensajes.preferencias', {})]);
    if (!c?.ok) { lista.replaceChildren(h('p', { class: 'muted small' }, c?.error || 'No se pudieron leer los contactos')); return; }
    contactos = c.data.contactos; prefs = p?.ok ? p.data.preferencias : [];
    pintar();
  }
  async function accion(que, f, ok) {
    if (ocupado) return;
    ocupado = que; pintar();
    try {
      const r = await f();
      if (!r?.ok) toast(r?.error || 'No se pudo', 'bad'); else if (ok) toast(ok(r.data), 'ok');
      return r;
    } finally { ocupado = ''; await cargar(); }
  }
  const clasificar = (c, nivel) => accion(`n-${c.id}`, () => api.cmd('mensajes.clasificar', { id: c.id, nivel, categoria: c.categoria || undefined }),
    (d) => `${c.nombre || c.clave}: ${NIVEL[nivel]}${d.rellenados ? ` · ${d.rellenados} mensajes de su historia` : ''}${d.borrados ? ` · borrados ${d.borrados} mensajes guardados` : ''}`);
  async function analizar(c) {
    abierto = c.id; analisis = null; pintar();
    const r = await accion(`a-${c.id}`, () => api.cmd('mensajes.analizar', { id: c.id }), (d) => (d.actualizada ? `Memoria v${d.version}: ${d.nuevos} mensajes nuevos analizados` : 'Memoria al día: nada nuevo que analizar'));
    if (r?.ok || r) { const x = await api.cmd('mensajes.contexto', { id: c.id }); analisis = x?.ok ? x.data : { error: x?.error }; pintar(); }
  }

  function fichaAnalisis(c) {
    if (abierto !== c.id) return null;
    if (!analisis) return h('p', { class: 'muted small' }, 'Analizando…');
    if (analisis.error) return h('p', { class: 'bad small' }, analisis.error);
    const m = analisis.memoria;
    const hechos = (m?.hechos || []).filter((x) => x.tipo !== 'OBSOLETO');
    return h('div', { class: 'msj-ficha' },
      m ? h('p', {}, m.resumen || 'Sin resumen todavía.') : h('p', { class: 'muted small' }, 'Aún sin memoria: pulsa Analizar.'),
      hechos.length ? h('ul', { class: 'side-list' }, hechos.map((x) => h('li', {}, h('strong', {}, `${TIPO[x.tipo] || x.tipo}: `), x.texto,
        x.sin_verificar ? h('span', { class: 'a-chip t-ask', title: 'Sin mensaje que lo respalde o con una cifra que no aparece en él: no se usa al redactar' }, ' sin verificar') : null,
        h('span', { class: 'muted small' }, ` · ${x.refs.length} mensaje${x.refs.length === 1 ? '' : 's'}`)))) : null,
      m?.pendientes?.length ? h('p', {}, h('strong', {}, 'Pendiente: '), m.pendientes.join(' · ')) : null,
      h('p', { class: 'muted small' }, `${analisis.pide.si ? 'Espera respuesta' : `No hace falta contestar (${analisis.pide.motivo})`} · contexto para redactar: ${analisis.paquete.chars} caracteres de ${analisis.paquete.total} mensajes guardados (sólo los ${analisis.paquete.ultimos} últimos + memoria)${m?.tokens_in ? ` · última actualización ${m.tokens_in} tokens` : ''}`));
  }

  function fila(c) {
    const incluido = ['LECTURA', 'BORRADORES'].includes(c.nivel);
    const sel = h('select', { 'aria-label': `Qué hacer con ${c.nombre || c.clave}`, disabled: !!ocupado, onchange: (e) => clasificar(c, e.target.value) },
      ...Object.entries(NIVEL).map(([k, v]) => h('option', { value: k, selected: c.nivel === k }, v)));
    const cat = h('input', { class: 'msj-cat', value: c.categoria || '', placeholder: 'categoría (proveedor, cliente…)', 'aria-label': 'Categoría', maxlength: 40,
      onchange: (e) => accion(`c-${c.id}`, () => api.cmd('mensajes.clasificar', { id: c.id, nivel: c.nivel, categoria: e.target.value.trim() }), () => 'Categoría guardada') });
    return h('li', { class: 'msj-fila' },
      h('div', {}, h('strong', {}, c.nombre || c.clave), ' ', h('span', { class: 'muted small' }, `${c.canal}${c.tipo === 'grupo' ? ' · grupo' : ''} · ${c.n_mensajes} mensajes · último ${fecha(c.ultimo_at)}${c.memoria_version ? ` · memoria v${c.memoria_version}` : ''}`)),
      h('div', { class: 'row msj-acc' }, sel, incluido ? cat : null,
        incluido ? h('button', { class: 'btn small', type: 'button', disabled: !!ocupado, onclick: () => analizar(c) }, ocupado === `a-${c.id}` ? 'Analizando…' : 'Analizar contexto') : null,
        c.nivel === 'BORRADORES' ? h('button', { class: 'btn small primary', type: 'button', disabled: !!ocupado,
          onclick: () => accion(`p-${c.id}`, () => api.cmd('mensajes.preparar', { id: c.id }), (d) => (d.preparado ? 'Borrador preparado: está arriba, en la bandeja, esperando tu aprobación' : d.duplicado ? 'Ya tenías ese borrador en la bandeja' : `Sin borrador: ${d.motivo}`)) }, ocupado === `p-${c.id}` ? 'Preparando…' : 'Preparar respuesta') : null),
      fichaAnalisis(c));
  }

  function formPreferencia() {
    const incl = contactos.filter((c) => ['LECTURA', 'BORRADORES'].includes(c.nivel));
    const cats = [...new Set(incl.map((c) => c.categoria).filter(Boolean))];
    const amb = h('select', { name: 'ambito', 'aria-label': 'A qué se aplica' }, ...Object.entries(AMBITO).map(([k, v]) => h('option', { value: k }, v)));
    const obj = h('select', { name: 'objetivo', 'aria-label': 'Contacto o categoría' },
      ...incl.map((c) => h('option', { value: c.id, 'data-amb': 'contacto' }, c.nombre || c.clave)), ...cats.map((x) => h('option', { value: x, 'data-amb': 'categoria' }, `categoría: ${x}`)));
    return h('form', { class: 'msj-pref-form', onsubmit: (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const objetivo = f.ambito.value === 'global' ? '' : f.objetivo.value;
      if (f.ambito.value !== 'global' && !objetivo) { toast('Elige el contacto o la categoría', 'bad'); return; }
      void accion('pref', () => api.cmd('mensajes.preferencia', { ambito: f.ambito.value, objetivo, texto: f.texto.value }), () => 'Guardado: se aplica en los próximos borradores');
    } }, h('label', { for: 'msj-pref-t' }, 'Corrígeme («demasiado formal», «más corto», «no uses esta expresión», «así es exactamente como quiero»):'),
      h('textarea', { id: 'msj-pref-t', name: 'texto', rows: 2, required: true, maxlength: 500 }), h('div', { class: 'row' }, amb, obj, h('button', { class: 'btn small primary', type: 'submit', disabled: !!ocupado }, 'Guardar')));
  }

  function pintar() {
    const n = (f) => contactos.filter(f).length;
    const FILTROS = { incluidos: ['Incluidos', (c) => ['LECTURA', 'BORRADORES'].includes(c.nivel)], pendientes: ['Sin clasificar', (c) => c.nivel === 'PENDIENTE'], excluidos: ['Excluidos', (c) => c.nivel === 'EXCLUIDO'] };
    vistas.replaceChildren(...Object.entries(FILTROS).map(([k, [txt, f]]) => h('button', { class: `btn small${filtro === k ? ' primary' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filtro === k), onclick: () => { filtro = k; pintar(); } }, `${txt} (${n(f)})`)));
    const xs = contactos.filter(FILTROS[filtro][1]);
    // El formulario de preferencias se conserva si se está escribiendo en él (no se repinta debajo del cursor).
    const escribiendo = document.activeElement && prefsBox.contains(document.activeElement);
    lista.replaceChildren(xs.length ? h('ul', { class: 'side-list' }, xs.map(fila)) : h('p', { class: 'muted small' }, filtro === 'pendientes' ? 'No hay contactos sin clasificar.' : 'Ninguno aquí.'));
    panel.replaceChildren();
    if (!escribiendo) {
      // Aprendido de TUS ediciones (punto 5): sólo propuestas; nada se aplica hasta que lo confirmas.
      const cand = prefs.filter((p) => p.estado === 'CANDIDATA');
      const candidatas = cand.length ? h('div', { class: 'msj-cand' }, h('p', { class: 'muted small' }, 'Aprendido de cómo editas los borradores (no se aplica hasta que lo confirmes):'),
        h('ul', { class: 'side-list' }, cand.map((p) => h('li', {}, h('span', { class: 'muted small' }, `${contactos.find((c) => c.id === p.objetivo)?.nombre || p.objetivo}: `), p.texto,
          h('span', { class: 'muted small' }, ` (${(String(p.evidencia || '').match(/#\d+/g) || []).length} borrador(es))`), ' ',
          h('button', { class: 'btn small primary', type: 'button', onclick: () => accion('conf', () => api.cmd('mensajes.preferencia.confirmar', { id: p.id }), () => 'Confirmada: se aplica en los próximos borradores') }, 'Confirmar'), ' ',
          h('button', { class: 'btn small', type: 'button', onclick: () => accion('desc', () => api.cmd('mensajes.preferencia.retirar', { id: p.id }), () => 'Descartada') }, 'Descartar'))))) : null;
      prefsBox.replaceChildren(candidatas || '',prefs.filter((p) => p.estado === 'ACTIVA').length ? h('ul', { class: 'side-list' }, prefs.filter((p) => p.estado === 'ACTIVA').map((p) => h('li', {},
        h('span', { class: 'muted small' }, `${AMBITO[p.ambito]}${p.objetivo ? ` (${contactos.find((c) => c.id === p.objetivo)?.nombre || p.objetivo})` : ''}: `), p.texto, ' ',
        h('button', { class: 'link small', type: 'button', onclick: () => accion('ret', () => api.cmd('mensajes.preferencia.retirar', { id: p.id }), () => 'Retirada') }, 'Retirar')))) : h('p', { class: 'muted small' }, 'Aún no hay preferencias guardadas.'),
      formPreferencia());
    }
  }

  return { el, cargar };
}
