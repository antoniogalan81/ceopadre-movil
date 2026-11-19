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
  let contactos = [], prefs = [], estilos = [], filtro = 'incluidos', abierto = null, analisis = null, ocupado = '';
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
    contactos = c.data.contactos; prefs = p?.ok ? p.data.preferencias : []; estilos = p?.ok ? p.data.estilos || [] : [];
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
    const cat = h('input', { class: 'msj-cat', value: c.categoria || '', placeholder: 'grupo/subgrupo (Proveedores/Agua, Familia…)', 'aria-label': 'Grupo y subgrupo', maxlength: 40,
      onchange: (e) => accion(`c-${c.id}`, () => api.cmd('mensajes.clasificar', { id: c.id, nivel: c.nivel, categoria: e.target.value.trim() }), (d) => (d.privado ? 'Privado: queda fuera de revisión (no se lee ni se analiza)' : 'Grupo guardado')) });
    return h('li', { class: 'msj-fila' },
      h('div', {}, h('strong', {}, c.nombre || c.clave), ' ', h('span', { class: 'muted small' }, `${c.canal}${c.tipo === 'grupo' ? ' · grupo' : ''} · ${c.n_mensajes} mensajes · último ${fecha(c.ultimo_at)}${c.memoria_version ? ` · memoria v${c.memoria_version}` : ''}`)),
      h('div', { class: 'row msj-acc' }, sel, cat, c.privado ? h('span', { class: 'a-chip', title: 'Familia, amigos o conocidos: fuera de revisión' }, '🔒 privado') : null,
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
    const FILTROS = { incluidos: ['Incluidos', (c) => ['LECTURA', 'BORRADORES'].includes(c.nivel)], pendientes: ['Sin clasificar', (c) => c.nivel === 'PENDIENTE' && !c.privado],
      privados: ['Privados', (c) => c.privado], excluidos: ['Excluidos', (c) => c.nivel === 'EXCLUIDO' && !c.privado] };
    vistas.replaceChildren(...Object.entries(FILTROS).map(([k, [txt, f]]) => h('button', { class: `btn small${filtro === k ? ' primary' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filtro === k), onclick: () => { filtro = k; pintar(); } }, `${txt} (${n(f)})`)));
    const xs = contactos.filter(FILTROS[filtro][1]);
    // El formulario de preferencias se conserva si se está escribiendo en él (no se repinta debajo del cursor).
    const escribiendo = document.activeElement && prefsBox.contains(document.activeElement);
    // Agrupados por grupo y subgrupo (los sin grupo, al final), sin clasificar nada a mano más allá del campo de cada contacto.
    const grupos = new Map();
    for (const c of xs) { const g = c.grupo ? `${c.grupo}${c.subgrupo ? ` / ${c.subgrupo}` : ''}` : 'Sin grupo'; grupos.set(g, [...(grupos.get(g) || []), c]); }
    const orden = [...grupos].sort(([a], [b]) => (a === 'Sin grupo') - (b === 'Sin grupo') || a.localeCompare(b, 'es'));
    lista.replaceChildren(...(xs.length ? (grupos.size > 1 || !grupos.has('Sin grupo') ? orden.map(([g, cs]) => h('section', { 'aria-label': g, class: 'msj-grupo' }, h('h3', { class: 'small' }, `${g} (${cs.length})`), h('ul', { class: 'side-list' }, cs.map(fila))))
      : [h('ul', { class: 'side-list' }, xs.map(fila))]) : [h('p', { class: 'muted small' }, filtro === 'pendientes' ? 'No hay contactos sin clasificar.' : 'Ninguno aquí.')]));
    panel.replaceChildren();
    if (!escribiendo) {
      // T27: aprendido de TUS ediciones (propuesto → lo que aprobaste o enviaste), sólo de contactos incluidos. Nada se aplica
      // hasta que lo confirmas; lo rechazado no vuelve salvo que lo repitas en 3 borradores nuevos.
      const quien = (e) => (e.ambito === 'global' ? AMBITO.global : `${AMBITO.contacto} (${contactos.find((c) => c.id === e.objetivo)?.nombre || e.objetivo})`);
      const evid = (e) => `${e.apariciones} borrador${e.apariciones === 1 ? '' : 'es'}: ${e.borradores.slice(-5).map((i) => `#${i}`).join(', ')}${e.borradores.length > 5 ? '…' : ''}`;
      const cand = estilos.filter((e) => e.estado === 'CANDIDATA');
      const itemCand = (e) => h('li', {}, h('strong', {}, e.texto), ' ',
        h('span', { class: 'muted small' }, `${quien(e)} · ${evid(e)}${e.reabierta ? ' · vuelve con evidencia nueva tras rechazarla' : ''}`), ' ',
        h('button', { class: 'btn small primary', type: 'button', disabled: !!ocupado, onclick: () => accion('conf', () => api.cmd('mensajes.preferencia.confirmar', { estilo: e.id }), () => 'Confirmada: se aplica en los próximos borradores') }, 'Confirmar'), ' ',
        h('button', { class: 'btn small', type: 'button', disabled: !!ocupado, onclick: () => accion('desc', () => api.cmd('mensajes.preferencia.retirar', { estilo: e.id }), () => 'Rechazada: no se volverá a proponer sin evidencia nueva') }, 'Rechazar'));
      const VISIBLES = 4; // lo de más evidencia primero; el resto, plegado
      const candidatas = cand.length ? h('div', { class: 'msj-cand' }, h('p', { class: 'muted small' }, `Aprendido de cómo editas los borradores (${cand.length}; no se aplica hasta que lo confirmes):`),
        h('ul', { class: 'side-list' }, cand.slice(0, VISIBLES).map(itemCand)),
        cand.length > VISIBLES ? h('details', {}, h('summary', { class: 'small' }, `Ver ${cand.length - VISIBLES} más`), h('ul', { class: 'side-list' }, cand.slice(VISIBLES).map(itemCand))) : null) : null;
      const activas = [...prefs.filter((p) => p.estado === 'ACTIVA').map((p) => ({ texto: p.texto, quien: `${AMBITO[p.ambito]}${p.objetivo ? ` (${contactos.find((c) => c.id === p.objetivo)?.nombre || p.objetivo})` : ''}`, cmd: { id: p.id }, ok: 'Retirada' })),
        ...estilos.filter((e) => e.estado === 'CONFIRMADA').map((e) => ({ texto: e.texto, quien: `${quien(e)} · aprendida (${evid(e)})`, cmd: { estilo: e.id }, ok: 'Retirada: queda rechazada' }))];
      prefsBox.replaceChildren(candidatas || '', activas.length ? h('ul', { class: 'side-list' }, activas.map((p) => h('li', {},
        h('span', { class: 'muted small' }, `${p.quien}: `), p.texto, ' ',
        h('button', { class: 'link small', type: 'button', onclick: () => accion('ret', () => api.cmd('mensajes.preferencia.retirar', p.cmd), () => p.ok) }, 'Retirar')))) : h('p', { class: 'muted small' }, 'Aún no hay preferencias guardadas.'),
      formPreferencia());
    }
  }

  return { el, cargar };
}
