// GESTIÓN · ALQUILERES: la tarjeta de cada inquilino dentro de GESTIONES (PC y móvil). Sólo pinta y da órdenes de la lista
// cerrada (alquiler.*); todo lo decide el PC (src/alquiler.js). Uso normal: un clic en «Me ha pagado».
import { h } from './dom.js';

const eur = (c) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesTitulo = (m) => { const s = `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`; return s[0].toUpperCase() + s.slice(1); };
const WA = { PENDIENTE: ['Pendiente', 'wait'], ENVIANDO: ['Enviando…', 'work'], ENVIADO: ['Enviado', 'ok'], ERROR: ['Error', 'bad'] };
const chip = (txt, tone) => h('span', { class: `a-chip t-${tone}` }, txt);

export function alquileresUi({ run, ask, cmd, toast, LOCAL }) {
  const ocupado = new Set(); // alquileres con una orden en curso: el botón sigue desactivado aunque la tarjeta se repinte
  const abierto = new Set(); // historiales desplegados (sobreviven al repintado)
  const orden = async (a, op, params, okMsg, btn) => {
    if (ocupado.has(a.id)) return;
    ocupado.add(a.id);
    try { return await run(op, { alquiler: a.id, ...params }, okMsg, btn); } finally { ocupado.delete(a.id); }
  };

  // «Modificar datos del cobro» (excepcional): mes, importe, fecha de recepción y forma de pago. Mismo proceso al confirmar.
  async function modificar(a, btn) {
    const meses = [...a.pendientes, ...(a.pendientes.includes(a.siguiente) ? [] : [a.siguiente])];
    const r = await ask({ title: `Cobro de ${a.inquilino}`, ok: 'Confirmar cobro y enviar',
      help: a.pendientes.length > 1 ? `Hay ${a.pendientes.length} mensualidades pendientes: elige a cuál corresponde este cobro.` : 'Sólo si algo es distinto de lo habitual. Se genera el recibo y se envía por WhatsApp.',
      fields: [
        { name: 'mes', label: 'Mensualidad', type: 'choice', value: a.pendientes.length === 1 ? a.pendientes[0] : '',
          options: meses.map((m) => ({ value: m, label: `${mesTitulo(m)}${a.pendientes.includes(m) ? ' · pendiente' : ' · adelantado'}` })) },
        { name: 'importe', label: 'Importe (€)', value: (a.importe / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }), inputmode: 'decimal' },
        { name: 'fecha_pago', label: 'Fecha de recepción del pago', type: 'date', value: a.hoy, max: a.hoy },
        { name: 'metodo', label: 'Forma de pago', type: 'choice', value: a.metodo, options: a.metodos.map((m) => ({ value: m.valor, label: m.nombre })) },
      ] });
    if (r) await previaYConfirmar(a, r, btn);
  }

  // Visor del documento (PC y móvil): imagen de la página del PDF real. Con `confirmar`, dos botones; si no, sólo «Cerrar».
  function visor({ titulo, resumen = '', imagen, confirmar = false, pdf = null }) {
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'alq-doc', 'aria-label': titulo });
      const fin = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(h('h2', {}, titulo), resumen ? h('p', { class: 'muted' }, resumen) : null,
        h('div', { class: 'alq-doc-img' }, h('img', { src: imagen, alt: `Documento: ${titulo}` })),
        h('div', { class: 'row alq-doc-btns' },
          confirmar ? [h('button', { class: 'btn ghost', type: 'button', onclick: () => fin(false) }, 'Cancelar'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => fin(true) }, 'Confirmar pago y enviar')]
            : [pdf ? h('a', { class: 'btn ghost', href: pdf, target: '_blank', rel: 'noopener' }, 'Abrir PDF') : null, h('button', { class: 'btn primary', type: 'button', onclick: () => fin(false) }, 'Cerrar')]));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); fin(false); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  // «Me ha pagado» → VISTA PREVIA del PDF real (nada registrado) → «Confirmar pago y enviar» o «Cancelar».
  async function previaYConfirmar(a, params, btn) {
    if (ocupado.has(a.id)) return;
    ocupado.add(a.id);
    if (btn) btn.disabled = true;
    let v;
    try { v = await cmd('alquiler.vista_previa', { alquiler: a.id, ...params }); } finally { ocupado.delete(a.id); if (btn) btn.disabled = false; }
    if (!v?.ok) { toast(v?.error || 'No se pudo preparar la vista previa', 'bad'); return; }
    const d = v.data;
    const si = await visor({ titulo: `Recibo de ${d.etiqueta}`, imagen: d.imagen, confirmar: true,
      resumen: `${d.importe_txt} · ${d.metodo_txt} · se enviará por WhatsApp a ${a.telefono}. Aún no se ha registrado nada.` });
    if (si) await orden(a, 'alquiler.cobrar', { ...params, mes: d.mes }, 'Cobro registrado', btn);
  }

  // OJO «Ver documento»: emitido = el PDF guardado; pendiente = BORRADOR — NO EMITIDO. Nunca cobra ni envía.
  async function ver(a, recibo = null) {
    if (LOCAL) { window.open(recibo ? `/alquiler/recibo/${recibo}` : `/alquiler/borrador/${encodeURIComponent(a.id)}`, '_blank', 'noopener'); return; }
    const v = await cmd('alquiler.ver', recibo ? { recibo } : { alquiler: a.id });
    if (!v?.ok) { toast(v?.error || 'No se pudo abrir el documento', 'bad'); return; }
    await visor({ titulo: v.data.titulo, imagen: v.data.imagen, resumen: v.data.emitido ? 'Recibo emitido (guardado).' : 'BORRADOR — NO EMITIDO: no se ha registrado ni enviado nada.' });
  }
  const ojo = (a, recibo = null, label = 'Ver documento') => h('button', { class: 'icon-btn alq-ojo', type: 'button', title: label, 'aria-label': label,
    onclick: () => ver(a, recibo) }, '👁');

  async function rectificar(a, x) {
    const r = await ask({ title: `Rectificar ${x.recibo.numero}`, ok: 'Emitir recibo rectificado',
      help: 'El recibo original se conserva tal cual. Se emite una versión nueva que lo sustituye y se envía por WhatsApp.',
      fields: [
        { name: 'importe', label: 'Importe (€)', value: (x.recibo.importe_cent / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }), inputmode: 'decimal' },
        { name: 'fecha_pago', label: 'Fecha de recepción del pago', type: 'date', value: x.recibo.fecha_pago, max: a.hoy },
        { name: 'metodo', label: 'Forma de pago', type: 'choice', value: x.recibo.metodo, options: a.metodos.map((m) => ({ value: m.valor, label: m.nombre })) },
        { name: 'motivo', label: 'Motivo de la rectificación', placeholder: 'p. ej. el importe era 650 €' },
      ] });
    if (r) await run('alquiler.rectificar', { recibo: x.recibo.id, ...r }, 'Recibo rectificado');
  }

  async function ficha(a) {
    const r = await ask({ title: `Ficha del alquiler · ${a.inquilino}`, ok: 'Guardar ficha',
      help: 'Los recibos ya emitidos no cambian. Si cambias un nombre, la plantilla del recibo se rehace una vez.',
      fields: [
        { name: 'arrendador', label: 'Arrendador', value: a.arrendador },
        { name: 'arrendatario', label: 'Arrendatario', value: a.inquilino },
        { name: 'importe', label: 'Mensualidad (€)', value: (a.importe / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }), inputmode: 'decimal' },
        { name: 'metodo', label: 'Forma de pago', type: 'choice', value: a.metodo || 'BIZUM', options: a.metodos.map((m) => ({ value: m.valor, label: m.nombre })) },
        { name: 'telefono', label: 'WhatsApp del inquilino', value: a.telefono, inputmode: 'tel' },
        { name: 'lugar', label: 'Lugar de emisión', value: a.lugar },
      ] });
    if (r) await run('alquiler.guardar', { alquiler: a.id, ...r }, 'Ficha guardada');
  }

  const waCell = (x) => {
    const r = x.recibo;
    if (!r) return '—';
    const [t, tone] = WA[r.wa_estado] || [r.wa_estado, 'idle'];
    return chip(t, tone);
  };

  function historial(a) {
    const det = h('details', { class: 'alq-hist', open: abierto.has(a.id), ontoggle: (e) => { if (e.currentTarget.open) abierto.add(a.id); else abierto.delete(a.id); } },
      h('summary', {}, `Historial (${a.historial.length} ${a.historial.length === 1 ? 'mes' : 'meses'})`),
      h('div', { class: 'alq-scroll' }, h('table', { class: 'alq-tabla' },
        h('thead', {}, h('tr', {}, ['Mes', 'Importe', 'Pago', 'WhatsApp', 'Recibo'].map((t) => h('th', {}, t)))),
        h('tbody', {}, a.historial.map((x) => h('tr', {},
          h('td', {}, x.etiqueta),
          h('td', { class: 'num' }, eur(x.importe)),
          h('td', {}, x.pago === 'PAGADO' ? chip('Pagado', 'ok') : chip('Pendiente', 'wait')),
          h('td', {}, waCell(x)),
          h('td', {}, x.recibo ? [
            ojo(a, x.recibo.id, `Ver recibo ${x.recibo.numero}`),
            x.recibo.versiones > 1 ? h('small', { class: 'muted' }, ` · rectificado (${x.recibo.numero})`) : null,
            ' · ', h('button', { class: 'link', type: 'button', onclick: () => rectificar(a, x) }, 'Rectificar')] : '—')))))));
    return det;
  }

  function card(a) {
    const pend = a.pendientes;
    const ultimo = a.historial.find((x) => x.recibo);
    const mes = pend[0] || ultimo?.mes || a.actual;
    const busy = ocupado.has(a.id);
    const estado = pend.length > 1 ? chip(`${pend.length} mensualidades pendientes`, 'bad') : pend.length ? chip('Pendiente de pago', 'wait') : chip('Pagado · al día', 'ok');
    const metodo = a.metodos.find((m) => m.valor === a.metodo)?.nombre || a.metodo;
    const r = ultimo?.recibo;
    const wa = r ? (WA[r.wa_estado] || [r.wa_estado, 'idle']) : null;
    return h('article', { class: `alq-card${pend.length ? ' need' : ''}`, 'data-id': `alq:${a.id}`, 'aria-label': `Alquiler de ${a.inquilino}` },
      h('header', { class: 'alq-head' },
        h('div', {}, h('h3', {}, a.inquilino), h('small', { class: 'muted' }, `Alquiler · ${eur(a.importe)} al mes · ${metodo}`)),
        h('div', { class: 'row' }, ojo(a, pend.length ? null : r?.id ?? null, pend.length ? 'Ver documento (borrador, no emitido)' : 'Ver documento'),
          h('button', { class: 'link', type: 'button', onclick: () => ficha(a) }, 'Ficha'))),
      h('dl', { class: 'alq-dl' },
        h('dt', {}, 'Mes'), h('dd', {}, pend.length > 1 ? pend.map(mesTitulo).join(' · ') : mesTitulo(mes)),
        h('dt', {}, 'Estado'), h('dd', {}, estado),
        r ? [h('dt', {}, 'WhatsApp'), h('dd', {}, chip(wa[0], wa[1]), ` ${r.numero}`, r.wa_motivo ? h('small', { class: 'muted alq-motivo' }, r.wa_motivo) : null)] : null),
      h('div', { class: 'row alq-acciones' },
        pend.length ? h('button', { class: 'btn primary alq-pagado', type: 'button', disabled: busy,
          onclick: (e) => (pend.length > 1 ? modificar(a, e.currentTarget) : previaYConfirmar(a, {}, e.currentTarget)) },
        busy ? 'Registrando…' : 'Me ha pagado') : null,
        r?.wa_estado === 'ERROR' ? h('button', { class: 'btn small', type: 'button', disabled: busy,
          onclick: (e) => orden(a, 'alquiler.reintentar', { recibo: r.id }, 'Reintentando', e.currentTarget) }, 'Reintentar envío') : null,
        h('button', { class: 'link', type: 'button', onclick: (e) => modificar(a, e.currentTarget) }, 'Modificar datos del cobro')),
      historial(a));
  }

  /** Tarjetas de todos los alquileres que traen las gestiones (vacío si no hay). */
  return { cards: (gestiones) => gestiones.flatMap((c) => (c.alquileres || []).map(card)) };
}
