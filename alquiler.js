// GESTIÓN · ALQUILERES: la tarjeta de cada inquilino dentro de GESTIONES (PC y móvil). Sólo pinta y da órdenes de la lista
// cerrada (alquiler.*); todo lo decide el PC (src/alquiler.js). Uso normal: un clic en «Me ha pagado».
import { h } from './dom.js';
import { miniTarjeta } from './tarjeta.js';

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
  const ESTADO_RECIBO = { NO_EMITIDO: ['No emitido', 'wait'], COBRADO_SIN_RECIBO: ['Cobrado · sin recibo', 'ok'], EMITIDO: ['Emitido · por enviar', 'ask'],
    CONFIRMADO_SIN_ENVIAR: ['Confirmado · no comunicado', 'ok'], ENVIANDO: ['Enviando…', 'work'], ENVIADO: ['Enviado', 'ok'], ENVIO_FALLIDO: ['Envío fallido', 'bad'] };
  async function previaYConfirmar(a, params, btn) { await reciboDialogo(a, params?.mes || a.pendientes[0] || a.actual, params || {}, btn); }

  // DETALLE DEL RECIBO (PC y móvil). Nada se registra ni se envía hasta pulsar «Confirmar» (sólo registra y guarda el recibo)
  // o «Confirmar y enviar» (además lo envía con ESTE mensaje). Con el recibo ya emitido: enviar después o anular el cobro.
  async function reciboDialogo(a, mes, params = {}, btn = null) {
    if (ocupado.has(a.id)) return;
    ocupado.add(a.id);
    if (btn) btn.disabled = true;
    let det, prev;
    try {
      det = await cmd('alquiler.recibo_detalle', { alquiler: a.id, mes });
      if (det?.ok && ['NO_EMITIDO', 'COBRADO_SIN_RECIBO'].includes(det.data.estado)) prev = await cmd('alquiler.vista_previa', { alquiler: a.id, ...params, mes });
    } finally { ocupado.delete(a.id); if (btn) btn.disabled = false; }
    if (!det?.ok) { toast(det?.error || 'No se pudo abrir el recibo', 'bad'); return; }
    if (prev && !prev.ok) { toast(prev.error || 'No se pudo preparar la vista previa', 'bad'); return; }
    const d = det.data, pv = prev?.data;
    const porEmitir = !!pv;
    const puedeEnviar = d.entrega === 'WHATSAPP';
    const [est, tono] = ESTADO_RECIBO[d.estado] || [d.estado, 'idle'];
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'sheet alq-ficha alq-recibo', 'aria-label': `Recibo de ${d.etiqueta}` });
      const fin = (v) => { dlg.close(); resolve(v); };
      const txt = h('textarea', { rows: 4, class: 'alq-msg', 'aria-label': 'Mensaje que se enviará' }); txt.value = d.mensaje;
      const instr = h('input', { type: 'text', placeholder: 'Pide algo al CEO (opcional): «más formal», «recuérdale el agua»…', 'aria-label': 'Petición al CEO' });
      const botones = [];
      const ocupar = (on) => { for (const b of botones) b.disabled = on; };
      const ayuda = h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        ocupar(true); ayuda.textContent = 'El CEO está redactando…';
        const r = await cmd('alquiler.redactar', { alquiler: a.id, mes, mensaje: txt.value, instruccion: instr.value });
        ocupar(false); ayuda.textContent = 'Pedir ayuda al CEO';
        if (!r?.ok) { toast(r?.error || 'El CEO no ha podido proponer un texto', 'bad'); return; }
        txt.value = r.data.propuesta; toast('Propuesta del CEO en el mensaje: revísala antes de confirmar');
      } }, 'Pedir ayuda al CEO');
      const restaurar = h('button', { class: 'link', type: 'button', onclick: () => { txt.value = d.mensaje_recomendado; } }, 'Restaurar el recomendado');
      // Si la orden falla, la ventana sigue abierta (con el mensaje escrito) para corregir y reintentar.
      const accion = async (op, p, okMsg) => { ocupar(true); try { if (await run(op, p, okMsg)) fin(true); } finally { ocupar(false); } };
      const datosCobro = pv ? `${pv.importe_txt} · ${pv.metodo_txt}` : d.recibo ? `${eur(d.recibo.importe_cent)} · cobrado el ${d.recibo.fecha_pago}` : '';
      const yaCobrado = d.estado === 'COBRADO_SIN_RECIBO';
      const pasos = porEmitir
        ? h('ul', { class: 'small alq-pasos' }, h('li', {}, yaCobrado ? `El cobro de ${d.etiqueta} ya está confirmado: el recibo saldrá con ${datosCobro} (corrígelo con «Modificar datos del cobro» si no es así)` : `Registrar el cobro de ${d.etiqueta}: ${datosCobro}`),
          h('li', {}, 'Generar y guardar el recibo PDF'),
          h('li', {}, puedeEnviar ? `Enviar por WhatsApp a ${d.destinatario} SÓLO con «Confirmar y enviar»` : 'Sin envío: este alquiler recibe el recibo en mano'))
        : null;
      const acciones = [];
      if (porEmitir) {
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => fin(false) }, 'Cancelar'));
        acciones.push(h('button', { class: `btn ${puedeEnviar ? '' : 'primary'}`, type: 'button', onclick: () => accion('alquiler.cobrar', { alquiler: a.id, ...params, mes, enviar: false, mensaje: txt.value }, 'Cobro confirmado (sin enviar)') }, 'Confirmar'));
        if (puedeEnviar) acciones.push(h('button', { class: 'btn primary', type: 'button', onclick: () => accion('alquiler.cobrar', { alquiler: a.id, ...params, mes, enviar: true, mensaje: txt.value }, 'Cobro confirmado y enviando') }, 'Confirmar y enviar'));
      } else {
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => fin(false) }, 'Cerrar'));
        if (d.recibo && puedeEnviar && ['CONFIRMADO_SIN_ENVIAR', 'EMITIDO', 'ENVIO_FALLIDO'].includes(d.estado)) {
          acciones.push(h('button', { class: 'btn primary', type: 'button', onclick: () => accion('alquiler.enviar_recibo', { recibo: d.recibo.id, mensaje: txt.value }, 'Enviando') }, 'Enviar ahora'));
        }
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
          const r = await ask({ title: `Anular el cobro de ${d.etiqueta}`, ok: 'Anular el cobro', danger: true,
            help: `La mensualidad vuelve a quedar pendiente${d.recibo ? ` y el recibo ${d.recibo.numero} queda anulado (no se borra)` : ''}. Queda en el historial.`,
            fields: [{ name: 'motivo', label: 'Motivo', placeholder: 'p. ej. lo registré en el inquilino equivocado' }] });
          if (r) await accion('alquiler.anular_cobro', { alquiler: a.id, mes, motivo: r.motivo }, 'Cobro anulado');
        } }, 'Anular cobro'));
      }
      botones.push(...acciones, ayuda);
      const editable = porEmitir || ['CONFIRMADO_SIN_ENVIAR', 'EMITIDO', 'ENVIO_FALLIDO'].includes(d.estado);
      txt.disabled = !editable || !puedeEnviar;
      dlg.append(
        h('header', { class: 'cmp-head' }, h('h2', {}, `Recibo · ${a.inquilino} · ${d.etiqueta}`), chip(est, tono)),
        h('div', { class: 'alq-ficha-body alq-panel' },
          porEmitir ? h('p', { class: 'small' }, h('strong', {}, d.estado === 'COBRADO_SIN_RECIBO' ? 'Cobro ya confirmado, sin recibo todavía. ' : 'Aún no se ha registrado nada. '), 'Revisa el recibo y el mensaje.') : d.recibo?.wa_motivo ? h('p', { class: 'small alq-aviso' }, d.recibo.wa_motivo) : null,
          pasos,
          h('div', { class: 'alq-doc-img' }, h('img', { src: (pv || d).imagen, alt: `Recibo de ${d.etiqueta}` })),
          h('h3', { class: 'alq-sec' }, 'Adjuntos'),
          h('ul', { class: 'alq-partes' }, d.adjuntos.map((x) => h('li', {}, `${x.tipo} · ${x.nombre} `,
            LOCAL ? h('a', { class: 'link', href: x.recibo ? `/alquiler/recibo/${x.recibo}` : `/alquiler/borrador/${encodeURIComponent(a.id)}`, target: '_blank', rel: 'noopener' }, 'Abrir PDF') : null))),
          h('h3', { class: 'alq-sec' }, puedeEnviar ? `Mensaje de WhatsApp para ${a.contacto || a.inquilino}` : 'Mensaje (este alquiler no recibe envíos: recibo en mano)'),
          txt,
          puedeEnviar && editable ? h('div', { class: 'alq-acciones' }, instr, ayuda, restaurar) : null,
          h('div', { class: 'row alq-doc-btns' }, acciones)));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(false); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  // OJO «Ver documento»: emitido = el PDF guardado; pendiente = BORRADOR — NO EMITIDO. Nunca cobra ni envía.
  async function ver(a, recibo = null) {
    if (recibo) { const x = a.historial.find((y) => y.recibo?.id === recibo); if (x) { await reciboDialogo(a, x.mes); return; } }
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
        { name: 'envio', label: 'Entrega del recibo', type: 'choice', value: a.envio, options: [{ value: 'WHATSAPP', label: 'Por WhatsApp' }, { value: 'MANO', label: 'En mano (no se envía)' }] },
        { name: 'telefono', label: 'WhatsApp del inquilino', value: a.telefono, inputmode: 'tel', required: false },
        { name: 'contacto', label: 'Contacto para las comunicaciones (si no es el inquilino)', value: a.contacto || '', required: false },
        { name: 'inmueble', label: 'Inmueble', value: a.inmueble || '', required: false },
        { name: 'unidad', label: 'Unidad (piso, habitación…)', value: a.unidad || '', required: false },
        { name: 'titular', label: 'Titular (persona o sociedad)', value: a.titular || '', required: false },
        { name: 'lugar', label: 'Lugar de emisión', value: a.lugar },
        { name: 'observaciones', label: 'Observaciones (datos pendientes, cuenta de cobro…)', type: 'textarea', value: a.observaciones || '', required: false },
      ] });
    const vacioVale = (k) => ['contacto', 'unidad', 'observaciones'].includes(k) || (k === 'telefono' && r?.envio === 'MANO');
    if (r) await run('alquiler.guardar', { alquiler: a.id, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== '' || vacioVale(k))) }, 'Ficha guardada');
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
            ' · ', h('button', { class: 'link', type: 'button', onclick: () => rectificar(a, x) }, 'Rectificar')]
            : x.sin_recibo ? h('button', { class: 'link', type: 'button', onclick: (e) => previaYConfirmar(a, { mes: x.mes }, e.currentTarget) }, 'Emitir recibo') : '—')))))));
    return det;
  }

  // FICHA COMPLETA (contenido de la ventana): datos, estado del pago y del WhatsApp, «Me ha pagado», modificar, ficha,
  // ver documento e historial con rectificar. Es la tarjeta grande de antes, sin cambios de lógica.
  function detalle(a) {
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
        a.inmueble ? [h('dt', {}, 'Inmueble'), h('dd', {}, `${a.inmueble}${a.unidad ? ` · ${a.unidad}` : ''}`)] : null,
        h('dt', {}, 'Titular'), h('dd', {}, a.titular || a.arrendador),
        a.contacto ? [h('dt', {}, 'Contacto'), h('dd', {}, a.contacto)] : null,
        a.observaciones ? [h('dt', {}, 'Observaciones'), h('dd', { class: 'small' }, a.observaciones)] : null,
        h('dt', {}, 'Pendiente'), h('dd', {}, a.pendiente_cent ? chip(a.pendiente_txt, 'wait') : chip('Nada', 'ok')),
        h('dt', {}, 'Próxima acción'), h('dd', {}, a.proxima),
        h('dt', {}, 'Mes'), h('dd', {}, pend.length > 1 ? pend.map(mesTitulo).join(' · ') : mesTitulo(mes)),
        h('dt', {}, 'Estado'), h('dd', {}, estado),
        r ? [h('dt', {}, 'Recibo'), h('dd', {}, a.envio === 'MANO' ? chip('Entrega en mano', 'idle') : chip(wa[0], wa[1]), ` ${r.numero}`, r.wa_motivo ? h('small', { class: 'muted alq-motivo' }, r.wa_motivo) : null)] : null),
      h('div', { class: 'row alq-acciones' },
        pend.length ? h('button', { class: 'btn primary alq-pagado', type: 'button', disabled: busy,
          onclick: (e) => (pend.length > 1 ? modificar(a, e.currentTarget) : previaYConfirmar(a, {}, e.currentTarget)) },
        busy ? 'Registrando…' : 'Me ha pagado') : null,
        r?.wa_estado === 'ERROR' ? h('button', { class: 'btn small', type: 'button', disabled: busy,
          onclick: (e) => orden(a, 'alquiler.reintentar', { recibo: r.id }, 'Reintentando', e.currentTarget) }, 'Reintentar envío') : null,
        h('button', { class: 'link', type: 'button', onclick: (e) => modificar(a, e.currentTarget) }, 'Modificar datos del cobro')),
      historial(a),
      h('h3', { class: 'alq-sec' }, 'Agua y suministros'), suministrosFicha(a));
  }

  // VENTANA de la ficha. Clic fuera / Escape / Cerrar la cierran (web/modal.js); abrirla no registra, genera ni envía nada.
  // Mientras está abierta se repinta con los datos reales (sync), sin repintar si nada cambió (no se pierde el foco).
  let abierta = null; // { id, dlg, cuerpo, sig }
  function abrirFicha(a) {
    if (abierta?.dlg.open) abierta.dlg.close();
    const cuerpo = h('div', { class: 'alq-ficha-body' }, detalle(a));
    const dlg = h('dialog', { class: 'sheet alq-ficha', 'aria-label': `Alquiler de ${a.inquilino}` },
      h('header', { class: 'cmp-head' }, h('h2', {}, `Alquiler · ${a.inquilino}`), h('button', { class: 'btn ghost small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')), cuerpo);
    dlg.addEventListener('close', () => { dlg.remove(); if (abierta?.dlg === dlg) abierta = null; });
    document.body.append(dlg);
    abierta = { id: a.id, dlg, cuerpo, sig: JSON.stringify(a) };
    dlg.showModal();
  }
  function sync(gestiones) {
    if (!abierta) return;
    const a = gestiones.flatMap((c) => c.alquileres || []).find((x) => x.id === abierta.id);
    const sig = JSON.stringify(a || null);
    if (!a || sig === abierta.sig) return;
    abierta.sig = sig;
    abierta.cuerpo.replaceChildren(detalle(a));
  }

  // ---------------------------------------------------------------- AGENTE «Alquileres» (Agentes → Alquileres)
  // UN solo agente para todos los inmuebles (12-11-2026: los inquilinos ya no son tarjetas propias). Dentro: resumen,
  // fichas de cada alquiler y pestañas Rentas · Suministros · Recibos y mensajes · Historial. Renta y suministros se
  // cuentan por separado. Nada se cobra ni se envía sin que Antonio lo confirme; un cobro confirmado deja de ser pendiente.
  const fecha = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
  const MOV = { COBRADO: 'Renta cobrada', RECTIFICADO: 'Recibo rectificado', ENVIADO: 'Recibo enviado', ENVIANDO: 'Enviando recibo', ENVIO_ERROR: 'Envío fallido',
    REINTENTO: 'Reintento de envío', FICHA: 'Ficha modificada', CONFIGURADO: 'Alta del alquiler', RECONFIGURADO: 'Ficha reconfigurada',
    SUMINISTRO_COBRADO: 'Suministro cobrado', SUMINISTRO_COBRO_ANULADO: 'Cobro de suministro anulado', COBRADO_SIN_RECIBO: 'Renta cobrada (recibo pendiente)' };
  const PAGO_PROV = { DESCONOCIDO: 'sin confirmar', PENDIENTE: 'pendiente', PAGADA: 'pagada', DOMICILIADA: 'domiciliada' };
  const EST = { PENDIENTE: ['Pendiente', 'wait'], PARCIAL: ['Pagada en parte', 'ask'], PAGADA: ['Pagada', 'ok'], SIN_REPARTIR: ['Sin repartir', 'idle'], ANULADA: ['Anulada', 'idle'] };
  const estChip = (e) => chip(...(EST[e] || [e, 'idle']));
  const todos = (gestiones) => gestiones.flatMap((c) => (c.alquileres || []).map((a) => ({ ...a, gestion: c })));
  const facturasDe = (lista) => { const m = new Map(); for (const a of lista) for (const f of a.suministros || []) m.set(f.id, f); return [...m.values()].sort((x, y) => y.fecha.localeCompare(x.fecha)); };
  const firma = (gestiones) => JSON.stringify(gestiones.flatMap((c) => c.alquileres || []));
  const hoy = () => new Date().toISOString().slice(0, 10);
  const vista = { tab: 'suministros', filtro: 'PENDIENTES' }; // sobrevive al repintado
  let lista = []; // la última lista pintada (para los diálogos)

  // «Me ha pagado» de una parte de suministro: total o parcial, fecha, forma de pago y nota. La operación lleva un id: si se
  // pulsa dos veces (o se reintenta), el PC lo reconoce y no cobra dos veces.
  async function cobrarParte(x, btn) {
    const op = crypto.randomUUID();
    const r = await ask({ title: `Me ha pagado · ${x.obligado}`, ok: 'Confirmar cobro',
      help: `Le quedan ${eur(x.pendiente)} de ${x.importe_txt}. Sólo cuenta como cobrado cuando lo confirmas aquí.`,
      fields: [
        { name: 'tipo', label: 'Pago', type: 'choice', value: 'TOTAL', options: [{ value: 'TOTAL', label: `Total: ${eur(x.pendiente)}` }, { value: 'PARCIAL', label: 'Parcial (indica el importe)' }] },
        { name: 'importe', label: 'Importe si es parcial (€)', inputmode: 'decimal', required: false },
        { name: 'fecha_pago', label: 'Fecha del pago', type: 'date', value: hoy(), max: hoy() },
        { name: 'metodo', label: 'Forma de pago', type: 'choice', value: 'EFECTIVO', options: [{ value: 'EFECTIVO', label: 'Efectivo' }, { value: 'TRANSFERENCIA', label: 'Transferencia' }, { value: 'BIZUM', label: 'Bizum' }] },
        { name: 'nota', label: 'Observación (opcional)', required: false }] });
    if (!r) return;
    if (r.tipo === 'PARCIAL' && !r.importe) { toast('Indica el importe del pago parcial', 'bad'); return; }
    await run('suministro.cobrar', { parte: x.id, op, importe: r.tipo === 'PARCIAL' ? r.importe : '', fecha_pago: r.fecha_pago, metodo: r.metodo, nota: r.nota }, 'Cobro registrado', btn);
  }
  async function anularCobro(c, x) {
    const r = await ask({ title: `Anular el cobro de ${c.importe_txt} de ${x.obligado}`, ok: 'Anular el cobro', danger: true,
      help: 'Se conserva en el historial como anulado y la cantidad vuelve a estar pendiente.', fields: [{ name: 'motivo', label: 'Motivo', placeholder: 'p. ej. lo registré dos veces' }] });
    if (r) await run('suministro.anular_cobro', { cobro: c.id, motivo: r.motivo }, 'Cobro anulado');
  }
  async function mensajeParte(x) {
    const v = await cmd('suministro.mensaje', { parte: x.id });
    if (!v?.ok) { toast(v?.error || 'No se pudo preparar el mensaje', 'bad'); return; }
    const r = await ask({ title: `Mensaje para ${v.data.destinatario}`, ok: 'Copiar texto', help: v.data.aviso,
      fields: [{ name: 'texto', label: 'Texto (puedes cambiarlo antes de copiarlo)', type: 'textarea', value: v.data.texto }] });
    if (!r?.texto) return;
    try { await navigator.clipboard.writeText(r.texto); toast('Texto copiado: envíalo tú cuando quieras'); } catch { toast('No se pudo copiar: selecciónalo y cópialo', 'bad'); }
  }
  // Reparto: la propuesta (si la hay) llega marcada, nunca aplicada; Antonio elige responsables y escribe el criterio.
  async function repartirFactura(f) {
    const cand = lista.filter((a) => !a.inmueble || a.inmueble === f.inmueble);
    const prop = f.propuesta?.ok ? f.propuesta.partes : [];
    const r = await ask({ title: `Repartir ${f.importe_txt} · ${f.proveedor} ${fecha(f.fecha)}`, ok: 'Guardar reparto',
      help: `${f.propuesta?.ok ? `Propuesta (${f.propuesta.probable ? 'con datos probables: revísala' : 'con datos confirmados'}): ${f.propuesta.criterio}.` : `${f.periodo ? `Periodo ${fecha(f.periodo.desde)}–${fecha(f.periodo.hasta)}. ` : ''}${f.propuesta?.motivo || ''}`} A partes iguales entre los marcados (el céntimo impar va al primero).`,
      fields: [...cand.map((a) => ({ name: `a:${a.id}`, label: a.inquilino, type: 'checkbox', value: prop.some((p) => p.alquiler === a.id) })),
        { name: 'otro', label: 'Otro responsable (p. ej. un inquilino anterior)', value: prop.find((p) => !p.alquiler)?.obligado || '', required: false },
        { name: 'criterio', label: 'Por qué se reparte así', type: 'textarea', value: f.propuesta?.ok ? f.propuesta.criterio : '' }] });
    if (!r) return;
    const partes = [...cand.filter((a) => r[`a:${a.id}`]).map((a) => ({ obligado: a.inquilino, alquiler: a.id })), ...(r.otro ? [{ obligado: r.otro }] : [])];
    if (!partes.length) { toast('Marca al menos un responsable', 'bad'); return; }
    await run('suministro.repartir', { factura: f.id, partes, criterio: r.criterio }, 'Reparto guardado');
  }
  async function pagoProveedor(f) {
    const r = await ask({ title: `Pago a ${f.proveedor} · ${f.importe_txt}`, ok: 'Guardar', help: 'Lo que tú pagas al proveedor. No cambia lo que te deben los inquilinos.',
      fields: [{ name: 'estado', label: 'Estado', type: 'choice', value: f.pago_proveedor === 'DESCONOCIDO' ? '' : f.pago_proveedor,
        options: [{ value: 'PENDIENTE', label: 'Pendiente de pagar' }, { value: 'PAGADA', label: 'Pagada' }, { value: 'DOMICILIADA', label: 'Domiciliada en el banco' }] }] });
    if (r) await run('suministro.pago_proveedor', { factura: f.id, estado: r.estado }, 'Guardado');
  }
  async function registrarFactura() {
    const g = lista[0]?.gestion;
    if (!g) return;
    const inm = [...new Set(lista.map((a) => a.inmueble).filter(Boolean))];
    const r = await ask({ title: 'Registrar factura de suministro', ok: 'Registrar', help: 'Con los datos del documento original. Una factura repetida no se duplica.',
      fields: [
        inm.length ? { name: 'inmueble', label: 'Inmueble', type: 'choice', value: inm.length === 1 ? inm[0] : '', options: inm.map((x) => ({ value: x, label: x })) } : { name: 'inmueble', label: 'Inmueble' },
        { name: 'tipo', label: 'Suministro', type: 'choice', value: 'AGUA', options: [{ value: 'AGUA', label: 'Agua' }, { value: 'LUZ', label: 'Luz' }, { value: 'GAS', label: 'Gas' }, { value: 'OTRO', label: 'Otro' }] },
        { name: 'proveedor', label: 'Proveedor', value: 'EMASESA' },
        { name: 'contrato', label: 'Nº de contrato', required: false },
        { name: 'fecha_factura', label: 'Fecha de la factura', type: 'date' },
        { name: 'periodo_desde', label: 'Periodo: desde', type: 'date', required: false },
        { name: 'periodo_hasta', label: 'Periodo: hasta', type: 'date', required: false },
        { name: 'importe', label: 'Importe total (€)', inputmode: 'decimal' },
        { name: 'nota', label: 'Nota', type: 'textarea', required: false }] });
    if (r) await run('suministro.registrar', { proyecto: g.id, fuente: 'Registrada a mano por Antonio', ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')) }, 'Factura registrada');
  }

  // Detalle de una factura (ventana): documento, propuesta o criterio, responsables, cobros (con anular) y acciones.
  let detFactura = null; // { id, dlg, cuerpo }
  function cuerpoFactura(f) {
    const filaParte = (x) => h('div', { class: 'alq-parte' },
      h('div', { class: 'alq-parte-top' }, h('strong', {}, x.obligado), ' ', estChip(x.estado)),
      h('p', { class: 'small' }, `Le corresponde ${x.importe_txt} · cobrado ${eur(x.cobrado)} · pendiente ${eur(x.pendiente)}`),
      x.cobros.length ? h('ul', { class: 'alq-cobros' }, x.cobros.map((c) => h('li', { class: c.estado === 'ANULADO' ? 'muted' : '' },
        `${c.importe_txt} · ${fecha(c.fecha_pago)} · ${({ EFECTIVO: 'efectivo', TRANSFERENCIA: 'transferencia', BIZUM: 'Bizum' })[c.metodo] || c.metodo}${c.nota ? ` · ${c.nota}` : ''}`,
        c.estado === 'ANULADO' ? ` · ANULADO (${c.anulado_motivo})` : c.id ? [' · ', h('button', { class: 'link', type: 'button', onclick: () => anularCobro(c, x) }, 'Anular')] : null))) : null,
      x.pendiente > 0 ? h('div', { class: 'alq-acciones' },
        h('button', { class: 'btn primary small', type: 'button', onclick: (e) => cobrarParte(x, e.currentTarget) }, 'Me ha pagado'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => mensajeParte(x) }, 'Preparar mensaje')) : null);
    return h('div', { class: 'alq-panel' },
      h('dl', { class: 'alq-dl' },
        h('dt', {}, 'Inmueble'), h('dd', {}, f.inmueble),
        h('dt', {}, 'Periodo'), h('dd', {}, f.periodo ? `${fecha(f.periodo.desde)} – ${fecha(f.periodo.hasta)}` : 'sin indicar'),
        h('dt', {}, 'Factura'), h('dd', {}, `${f.proveedor}${f.contrato ? ` · contrato ${f.contrato}` : ''} · ${fecha(f.fecha)} · ${f.importe_txt}`),
        h('dt', {}, 'Estado'), h('dd', {}, estChip(f.estado), f.partes.length ? ` cobrado ${eur(f.cobrado)} · pendiente ${eur(f.pendiente)}` : ''),
        h('dt', {}, 'Pago al proveedor'), h('dd', {}, PAGO_PROV[f.pago_proveedor] || f.pago_proveedor, ' · ', h('button', { class: 'link', type: 'button', onclick: () => pagoProveedor(f) }, 'Cambiar')),
        h('dt', {}, 'Documento'), h('dd', { class: 'small' }, f.documento ? 'PDF guardado en GalanContable' : 'Sin PDF local', ` · fuente: ${f.fuente}`),
        f.nota ? [h('dt', {}, 'Nota'), h('dd', { class: 'small' }, f.nota)] : null),
      f.sin_repartir
        ? h('div', { class: 'alq-prop' }, h('p', {}, f.propuesta?.ok ? `Propuesta (pendiente de tu confirmación): ${f.propuesta.criterio}` : f.propuesta?.motivo || 'Sin propuesta.'),
          h('button', { class: 'btn small', type: 'button', onclick: () => repartirFactura(f) }, f.propuesta?.ok ? 'Revisar y repartir' : 'Repartir a mano'))
        : [h('h3', { class: 'alq-sec' }, 'Responsables'), ...f.partes.map(filaParte), h('p', { class: 'small muted' }, `Criterio: ${f.partes[0]?.criterio || '—'}`),
          h('button', { class: 'link', type: 'button', onclick: () => repartirFactura(f) }, 'Corregir el reparto (lo cobrado se conserva)')]);
  }
  function abrirFactura(f) {
    if (detFactura?.dlg.open) detFactura.dlg.close();
    const cuerpo = h('div', { class: 'alq-ficha-body' }, cuerpoFactura(f));
    const dlg = h('dialog', { class: 'sheet alq-ficha', 'aria-label': `Factura ${f.proveedor} ${fecha(f.fecha)}` },
      h('header', { class: 'cmp-head' }, h('h2', {}, `${f.tipo === 'AGUA' ? 'Agua' : f.tipo} · ${fecha(f.fecha)} · ${f.importe_txt}`), h('button', { class: 'btn ghost small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')), cuerpo);
    dlg.addEventListener('close', () => { dlg.remove(); if (detFactura?.dlg === dlg) detFactura = null; });
    document.body.append(dlg);
    detFactura = { id: f.id, dlg, cuerpo, sig: JSON.stringify(f) };
    dlg.showModal();
  }

  // Suministros de UN alquiler (dentro de su ficha): lo que debe y lo que ya pagó, con «Me ha pagado».
  function suministrosFicha(a) {
    const mias = (a.suministros || []).flatMap((f) => f.partes.filter((x) => x.alquiler === a.id).map((x) => ({ f, x })));
    if (!mias.length) return h('p', { class: 'small muted' }, 'Sin suministros repartidos a este alquiler.');
    return h('ul', { class: 'alq-partes' }, mias.map(({ f, x }) => h('li', {},
      h('button', { class: 'link', type: 'button', onclick: () => abrirFactura(f) }, `${f.tipo === 'AGUA' ? 'Agua' : f.tipo} ${f.periodo ? `${fecha(f.periodo.desde)}–${fecha(f.periodo.hasta)}` : fecha(f.fecha)}`),
      ` · ${x.importe_txt} `, estChip(x.estado), x.pendiente > 0 ? [' ', h('button', { class: 'link', type: 'button', onclick: (e) => cobrarParte(x, e.currentTarget) }, 'Me ha pagado')] : null)));
  }

  const resumen = (lst) => {
    const mes = hoy().slice(0, 7);
    const renta = lst.reduce((s, a) => s + (a.renta_pendiente_cent || 0), 0);
    // Suministros: TODAS las facturas (también lo que deben inquilinos anteriores, que no tienen ficha de alquiler).
    const fs = facturasDe(lst);
    const sum = fs.reduce((s, f) => s + (f.pendiente || 0), 0);
    const cobradas = lst.flatMap((a) => (a.historial || []).filter((x) => x.pago === 'PAGADO' && ((x.recibo && (x.recibo.fecha_pago || '').startsWith(mes))
      || (x.sin_recibo && ((x.cobro_sin_recibo?.fecha_pago || '').startsWith(mes) || (!x.cobro_sin_recibo?.fecha_pago && x.mes === mes))))).map((x) => ({ a, x })));
    const cobRenta = cobradas.reduce((s, { x }) => s + (x.recibo ? x.recibo.importe_cent : x.cobro_sin_recibo?.importe_cent || 0), 0);
    const porConfirmar = cobradas.filter(({ x }) => !x.recibo && x.cobro_sin_recibo && x.cobro_sin_recibo.importe_cent == null).map(({ a }) => a.inquilino.split(' ')[0]);
    const detalleRenta = cobradas.map(({ a, x }) => `${a.inquilino.split(' ')[0]} ${x.recibo ? eur(x.recibo.importe_cent) : x.cobro_sin_recibo?.importe_cent != null ? eur(x.cobro_sin_recibo.importe_cent) : 'importe por confirmar'}`).join(' · ');
    const cobSum = fs.flatMap((f) => f.partes.flatMap((x) => x.cobros)).filter((c) => c.estado === 'VALIDO' && (c.fecha_pago || '').startsWith(mes)).reduce((s, c) => s + c.importe_cent, 0);
    const recibos = lst.reduce((s, a) => s + (a.recibos_sin_enviar || 0), 0), sinComunicar = lst.reduce((s, a) => s + (a.recibos_sin_comunicar || 0), 0);
    const kpi = (t, v, tone) => h('div', { class: `alq-kpi t-${tone}` }, h('small', {}, t), h('strong', {}, v));
    return h('div', { class: 'alq-resumen' },
      kpi('Alquileres activos', String(lst.length), 'idle'),
      kpi('Rentas pendientes', eur(renta), renta ? 'wait' : 'ok'),
      kpi('Suministros pendientes', eur(sum), sum ? 'wait' : 'ok'),
      h('div', { class: 'alq-kpi t-ok' }, h('small', {}, 'Cobrado este mes'), h('strong', {}, `${eur(cobRenta)} renta${porConfirmar.length ? ' + importe por confirmar' : ''} · ${eur(cobSum)} suministros`),
        detalleRenta ? h('small', { class: 'muted' }, detalleRenta) : null),
      kpi('Recibos sin enviar', `${recibos}${sinComunicar ? ` · ${sinComunicar} confirmados sin comunicar` : ''}`, recibos ? 'bad' : 'ok'));
  };
  const tarjetaAlquiler = (a) => {
    const pend = a.pendientes;
    return h('article', { class: `alq-mini-ficha${a.pendiente_cent ? ' need' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Ficha del alquiler de ${a.inquilino}`,
      onclick: (e) => { if (!e.target.closest('button')) abrirFicha(a); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrirFicha(a); } },
    h('small', { class: 'muted' }, `${a.inmueble || 'Inmueble sin indicar'}${a.unidad ? ` · ${a.unidad}` : ''}`),
    h('h3', {}, a.inquilino), a.contacto ? h('small', { class: 'muted' }, `vía ${a.contacto}`) : null,
    h('p', { class: 'small' }, `${eur(a.importe)}/mes · `, pend.length ? chip(`Renta pendiente · ${mesTitulo(pend[0])}`, 'wait') : chip('Renta al día', 'ok'),
      a.suministros_pendiente_cent ? [' ', chip(`Suministros ${eur(a.suministros_pendiente_cent)}`, 'wait')] : null),
    h('p', { class: 'small muted' }, a.proxima),
    h('div', { class: 'alq-acciones' }, pend.length ? h('button', { class: 'btn primary small', type: 'button', disabled: ocupado.has(a.id),
      onclick: (e) => (pend.length > 1 ? modificar(a, e.currentTarget) : previaYConfirmar(a, {}, e.currentTarget)) }, 'Me ha pagado la renta') : null,
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => abrirFicha(a) }, 'Ficha')));
  };

  function tabRentas(lst) {
    const filas = lst.flatMap((a) => a.historial.map((x) => ({ a, x })));
    return h('div', { class: 'alq-scroll' }, h('table', { class: 'alq-tabla alq-panel-tabla' },
      h('thead', {}, h('tr', {}, ['Alquiler', 'Mes', 'Renta', 'Estado', 'Recibo'].map((t) => h('th', {}, t)))),
      h('tbody', {}, filas.map(({ a, x }) => {
        const tr = h('tr', {}, h('td', {}, a.inquilino), h('td', {}, x.etiqueta), h('td', { class: 'num' }, eur(x.importe), x.importe_por_confirmar ? h('small', { class: 'muted' }, ' (importe por confirmar)') : null),
          h('td', {}, x.pago === 'PAGADO' ? chip(x.sin_recibo ? 'Cobrada · sin recibo' : 'Cobrada', 'ok') : chip('Pendiente', 'wait')),
          h('td', {}, x.recibo ? h('button', { class: 'link', type: 'button', onclick: (e) => reciboDialogo(a, x.mes, {}, e.currentTarget) }, `${x.recibo.numero} · ${x.recibo.envio === 'NO_ENVIAR' && x.recibo.wa_estado !== 'ENVIADO' ? 'no comunicado' : (WA[x.recibo.wa_estado] || [x.recibo.wa_estado])[0].toLowerCase()}`)
            : x.sin_recibo ? h('button', { class: 'link', type: 'button', onclick: (e) => reciboDialogo(a, x.mes, {}, e.currentTarget) }, 'Emitir recibo')
              : h('button', { class: 'link', type: 'button', onclick: (e) => reciboDialogo(a, x.mes, {}, e.currentTarget) }, 'Me ha pagado')));
        [...tr.children].forEach((td, i) => { td.dataset.l = ['Alquiler', 'Mes', 'Renta', 'Estado', 'Recibo'][i]; });
        return tr;
      }))));
  }
  const FILTROS = [['PENDIENTES', 'Pendientes de cobro'], ['REPARTIR', 'Por repartir'], ['PARCIAL', 'Parcialmente pagados'], ['PAGADA', 'Pagados'], ['TODOS', 'Todos']];
  const enFiltro = (k, f) => (k === 'TODOS' ? true : k === 'PENDIENTES' ? ['PENDIENTE', 'PARCIAL'].includes(f.estado) : k === 'REPARTIR' ? f.estado === 'SIN_REPARTIR' : f.estado === k);
  // Confirmar la propuesta TAL CUAL (con su criterio) desde la lista; para cambiar responsables, «Revisar» en el detalle.
  async function confirmarPropuesta(f) {
    const pr = f.propuesta;
    const r = await ask({ title: `Confirmar reparto · ${f.importe_txt}`, ok: 'Confirmar reparto',
      help: `${pr.criterio}.${pr.probable ? ' Incluye datos probables: confírmalo sólo si es correcto.' : ''} A partes iguales. Después cada parte se marca como cobrada cuando te paguen.`, fields: [] });
    if (!r) return;
    await run('suministro.repartir', { factura: f.id, criterio: `Propuesta confirmada por Antonio: ${pr.criterio}`, partes: pr.partes.map((x) => ({ obligado: x.obligado, ...(x.alquiler ? { alquiler: x.alquiler } : {}) })) }, 'Reparto confirmado');
  }
  function tabSuministros(lst, repintar) {
    const fs = facturasDe(lst);
    const pasa = (f) => enFiltro(vista.filtro, f);
    const vis = fs.filter(pasa);
    const fila = (f) => h('button', { class: 'alq-fact-fila', type: 'button', onclick: () => abrirFactura(f) },
      h('span', { class: 'alq-ff-a' }, h('strong', {}, `${f.tipo === 'AGUA' ? 'Agua' : f.tipo} ${f.periodo ? `${fecha(f.periodo.desde)} – ${fecha(f.periodo.hasta)}` : fecha(f.fecha)}`),
        h('small', { class: 'muted' }, ` ${f.inmueble} · ${f.importe_txt}`)),
      h('span', { class: 'alq-ff-b small' }, f.partes.length ? f.partes.map((x) => `${x.obligado.split(' ')[0]} ${x.importe_txt}${x.estado === 'PAGADA' ? ' ✓' : x.estado === 'PARCIAL' ? ` (faltan ${eur(x.pendiente)})` : ''}`).join(' · ')
        : (f.propuesta?.ok ? 'Propuesta pendiente de confirmar' : 'Sin propuesta: falta saber quién vivía')),
      h('span', { class: 'alq-ff-c' }, estChip(f.estado), f.partes.length && f.pendiente ? h('small', {}, ` ${eur(f.pendiente)}`) : null));
    return h('div', { class: 'alq-panel' },
      h('div', { class: 'alq-filtros', role: 'tablist' }, FILTROS.map(([k, t]) => h('button', { class: `btn small ${vista.filtro === k ? 'primary' : 'ghost'}`, type: 'button', role: 'tab', 'aria-selected': String(vista.filtro === k),
        onclick: () => { vista.filtro = k; repintar(); } }, `${t} (${fs.filter((f) => enFiltro(k, f)).length})`)),
      h('button', { class: 'btn small', type: 'button', onclick: () => registrarFactura() }, 'Registrar factura')),
      vis.length ? h('div', { class: 'alq-fact-lista' }, vis.map((f) => h('div', { class: 'alq-fact-item' }, fila(f),
        f.sin_repartir && f.propuesta?.ok ? h('button', { class: 'btn small', type: 'button', onclick: () => confirmarPropuesta(f) }, 'Confirmar reparto') : null)))
        : h('p', { class: 'muted' }, vista.filtro === 'PENDIENTES' ? 'Nada pendiente de cobrar en suministros.' : 'Ninguna factura en este filtro.'));
  }
  function tabRecibos(lst) {
    const recibos = lst.flatMap((a) => a.historial.filter((x) => x.recibo).map((x) => ({ a, x })));
    const partes = facturasDe(lst).flatMap((f) => f.partes.filter((x) => x.pendiente > 0).map((x) => ({ f, x })));
    return h('div', { class: 'alq-panel' },
      h('h3', { class: 'alq-sec' }, 'Recibos de renta'),
      recibos.length ? h('ul', { class: 'alq-partes' }, recibos.map(({ a, x }) => h('li', {}, ojo(a, x.recibo.id, `Ver recibo ${x.recibo.numero}`), ` ${x.recibo.numero} · ${a.inquilino} · `,
        a.envio === 'MANO' ? chip('Entrega en mano', 'idle') : waCell(x)))) : h('p', { class: 'muted small' }, 'Aún no hay recibos emitidos.'),
      h('h3', { class: 'alq-sec' }, 'Mensajes de suministros por preparar'),
      partes.length ? h('ul', { class: 'alq-partes' }, partes.map(({ f, x }) => h('li', {}, `${x.obligado} · ${eur(x.pendiente)} (${f.tipo === 'AGUA' ? 'agua' : f.tipo} ${fecha(f.fecha)}) `,
        h('button', { class: 'link', type: 'button', onclick: () => mensajeParte(x) }, 'Preparar mensaje')))) : h('p', { class: 'muted small' }, 'No hay importes de suministros pendientes que reclamar.'),
      h('p', { class: 'small muted' }, 'CEOPadre prepara los textos; no envía nada sin ti.'));
  }
  function tabHistorial(lst) {
    // Rentas y fichas (por alquiler) + TODOS los cobros de suministros, también de inquilinos anteriores y los anulados.
    const sums = facturasDe(lst).flatMap((f) => f.partes.flatMap((x) => x.cobros.map((c) => ({ at: c.fecha_pago, quien: x.obligado, importe: c.importe_cent,
      tipo: c.estado === 'ANULADO' ? 'SUMINISTRO_COBRO_ANULADO' : 'SUMINISTRO_COBRADO', mes: null, extra: ` · ${f.tipo === 'AGUA' ? 'agua' : f.tipo} ${fecha(f.fecha)}${c.estado === 'ANULADO' ? ` (${c.anulado_motivo})` : ''}` }))));
    const movs = [...lst.flatMap((a) => (a.movimientos || []).filter((m) => !m.tipo.startsWith('SUMINISTRO_')).map((m) => ({ ...m, quien: a.inquilino }))), ...sums]
      .sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 80);
    return movs.length ? h('ul', { class: 'alq-partes' }, movs.map((m) => h('li', {}, `${fecha(String(m.at).slice(0, 10))} · ${m.quien} · ${MOV[m.tipo] || m.tipo}${m.importe ? ` · ${eur(m.importe)}` : ''}${m.mes ? ` · ${mesTitulo(m.mes)}` : ''}${m.extra || ''}`)))
      : h('p', { class: 'muted small' }, 'Sin movimientos todavía.');
  }
  const TABS = [['rentas', 'Rentas'], ['suministros', 'Suministros'], ['recibos', 'Recibos y mensajes'], ['historial', 'Historial']];
  function cuerpoPanel(gestiones, repintar) {
    lista = todos(gestiones);
    const proximas = lista.filter((a) => a.pendiente_cent || a.recibos_sin_enviar).map((a) => `${a.inquilino.split(' ')[0]}: ${a.proxima}`);
    const tab = { rentas: () => tabRentas(lista), suministros: () => tabSuministros(lista, repintar), recibos: () => tabRecibos(lista), historial: () => tabHistorial(lista) }[vista.tab];
    return h('div', { class: 'alq-panel' },
      resumen(lista),
      proximas.length ? h('p', { class: 'small' }, h('strong', {}, 'Próximas acciones: '), proximas.join(' · ')) : null,
      h('h3', { class: 'alq-sec' }, 'Alquileres'),
      h('div', { class: 'alq-list' }, lista.map(tarjetaAlquiler)),
      h('div', { class: 'alq-tabs', role: 'tablist' }, TABS.map(([k, t]) => h('button', { class: `alq-tab${vista.tab === k ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(vista.tab === k),
        onclick: () => { vista.tab = k; repintar(); } }, t))),
      tab());
  }
  let panel = null; // { dlg, cuerpo, sig, gestiones }
  function abrirPanel(gestiones) {
    if (panel?.dlg.open) panel.dlg.close();
    const cuerpo = h('div', { class: 'alq-ficha-body' });
    const repintar = () => { if (panel) cuerpo.replaceChildren(cuerpoPanel(panel.gestiones, repintar)); };
    const dlg = h('dialog', { class: 'sheet alq-ficha alq-panel-dlg', 'aria-label': 'Agente Alquileres' },
      h('header', { class: 'cmp-head' }, h('h2', {}, 'Alquileres'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')), cuerpo);
    dlg.addEventListener('close', () => { dlg.remove(); if (panel?.dlg === dlg) panel = null; });
    document.body.append(dlg);
    panel = { dlg, cuerpo, sig: firma(gestiones), gestiones, repintar };
    repintar();
    dlg.showModal();
  }
  function syncPanel(gestiones) {
    const sig = firma(gestiones);
    if (detFactura) { const f = facturasDe(todos(gestiones)).find((x) => x.id === detFactura.id); const s = JSON.stringify(f || null); if (f && s !== detFactura.sig) { detFactura.sig = s; detFactura.cuerpo.replaceChildren(cuerpoFactura(f)); } }
    if (!panel || sig === panel.sig) return;
    panel.sig = sig; panel.gestiones = gestiones;
    panel.repintar();
  }
  function miniPanel(gestiones) {
    const lst = todos(gestiones);
    const renta = lst.reduce((s, a) => s + (a.renta_pendiente_cent || 0), 0), sum = facturasDe(lst).reduce((s, f) => s + (f.pendiente || 0), 0);
    const estado = renta || sum ? [`Por cobrar ${eur(renta + sum)}`, 'wait'] : ['Todo cobrado', 'ok'];
    const abrir = () => abrirPanel(gestiones);
    const el = miniTarjeta({ id: 'alq:panel', titulo: 'Alquileres', sub: `Agente · ${lst.length} ${lst.length === 1 ? 'alquiler' : 'alquileres'}`, clase: 'alq-mini',
      desc: `Rentas ${eur(renta)} · suministros ${eur(sum)} pendientes. Fichas, recibos, agua e historial.`, estado, accion: { txt: 'Abrir', on: abrir, cls: 'primary' }, abrir });
    return { tono: estado[1] === 'wait' ? 'ask' : estado[1], texto: `alquileres alquiler agua suministros inquilinos recibos ${lst.map((a) => a.inquilino).join(' ')}`, el };
  }

  /** UN solo agente (la tarjeta Alquileres); los inquilinos viven dentro de su panel. Fichas, facturas y panel al día. */
  return {
    minis: (gestiones) => (todos(gestiones).length ? [miniPanel(gestiones)] : []),
    sync: (gestiones) => { sync(gestiones); syncPanel(gestiones); }, abrirFicha, abrirPanel,
    suministrosFicha,
  };
}
