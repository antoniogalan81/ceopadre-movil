// GESTIÓN · ALQUILERES: la tarjeta de cada inquilino dentro de GESTIONES (PC y móvil). Sólo pinta y da órdenes de la lista
// cerrada (alquiler.*); todo lo decide el PC (src/alquiler.js). Uso normal: un clic en «Me ha pagado».
import { h } from './dom.js';
import { miniTarjeta } from './tarjeta.js';

const eur = (c) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesTitulo = (m) => { const s = `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`; return s[0].toUpperCase() + s.slice(1); };
const WA = { PENDIENTE: ['Pendiente', 'wait'], ENVIANDO: ['Enviando…', 'work'], ENVIADO: ['Enviado', 'ok'], ERROR: ['Error', 'bad'] };
const centTxt = (c) => (c / 100).toFixed(2).replace('.', ',');
/** «20,35» / «20.35» / «20» → 2035 céntimos; vacío o no válido → null. */
const aCent = (v) => { const s = String(v ?? '').replace(/[\s€]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null; };
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
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

  // DETALLE DEL RECIBO (PC y móvil), en secciones: A datos del cobro · B el PDF (ampliar / descargar) · C el mensaje (editable)
  // · D preguntar al CEO (propone; sólo se aplica si Antonio acepta) · E adjuntos · F acciones. Nada se registra ni se envía
  // hasta pulsar «Confirmar» (registra y guarda el recibo, sin enviar) o «Confirmar y enviar». Ya cobrado: no se vuelve a cobrar.
  async function reciboDialogo(a, mes, params = {}, btn = null) {
    if (ocupado.has(a.id)) return;
    ocupado.add(a.id);
    if (btn) btn.disabled = true;
    let det, prev;
    try {
      det = await cmd('alquiler.recibo_detalle', { alquiler: a.id, mes });
      // Ya cobrado sin justificante: se usa la fecha que confirmó Antonio; si no la hay, se pide (nunca se inventa).
      if (det?.ok && det.data.estado === 'COBRADO_SIN_RECIBO' && !params.fecha_pago) {
        if (det.data.datos.fecha_pago) params = { ...params, fecha_pago: det.data.datos.fecha_pago, metodo: det.data.datos.metodo };
        else {
          const f = await ask({ title: `Justificante de ${det.data.etiqueta}`, ok: 'Seguir', help: 'El cobro ya está confirmado. Para el justificante hace falta la fecha REAL en que cobraste (no se inventa).',
            fields: [{ name: 'fecha_pago', label: 'Fecha del cobro', type: 'date', max: new Date().toISOString().slice(0, 10) }] });
          if (!f) return;
          params = { ...params, fecha_pago: f.fecha_pago };
        }
      }
      if (det?.ok && ['NO_EMITIDO', 'COBRADO_SIN_RECIBO'].includes(det.data.estado)) prev = await cmd('alquiler.vista_previa', { alquiler: a.id, ...params, mes });
    } finally { ocupado.delete(a.id); if (btn) btn.disabled = false; }
    if (!det?.ok) { toast(det?.error || 'No se pudo abrir el recibo', 'bad'); return; }
    if (prev && !prev.ok) { toast(prev.error || 'No se pudo preparar la vista previa', 'bad'); return; }
    const d = det.data, pv = prev?.data, dt = d.datos;
    const porEmitir = !!pv;
    const yaCobrado = dt.confirmado;
    const puedeEnviar = d.entrega === 'WHATSAPP';
    const [est, tono] = ESTADO_RECIBO[d.estado] || [d.estado, 'idle'];
    const imagenPdf = (pv || d).imagen;
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'sheet alq-ficha alq-recibo', 'aria-label': `Recibo de ${d.etiqueta}` });
      const fin = (v) => { dlg.close(); resolve(v); };
      const botones = [];
      const ocupar = (on) => { for (const b of botones) b.disabled = on; };
      // Si la orden falla, la ventana sigue abierta (con el mensaje escrito) para corregir y reintentar.
      const accion = async (op, p, okMsg) => { ocupar(true); try { if (await run(op, p, okMsg)) fin(true); } finally { ocupar(false); } };

      // A · DATOS DEL COBRO
      const importe = pv ? pv.importe_txt : `${eur(dt.importe_cent)}${dt.importe_por_confirmar ? ' (por confirmar)' : ''}`;
      const datos = h('dl', { class: 'alq-dl' },
        h('dt', {}, 'Inmueble'), h('dd', {}, `${dt.inmueble || '—'}${dt.unidad ? ` · ${dt.unidad}` : ''}`),
        h('dt', {}, 'Inquilino'), h('dd', {}, dt.inquilino, dt.contacto ? h('small', { class: 'muted' }, ` · vía ${dt.contacto}`) : null),
        h('dt', {}, 'Mensualidad'), h('dd', {}, dt.mensualidad),
        h('dt', {}, 'Importe'), h('dd', {}, importe),
        h('dt', {}, 'Fecha del cobro'), h('dd', {}, pv?.fecha_pago && !yaCobrado ? `${fechaCorta(pv.fecha_pago)} (si confirmas ahora)` : dt.fecha_pago ? fechaCorta(dt.fecha_pago) : 'sin fecha registrada'),
        h('dt', {}, 'Forma de pago'), h('dd', {}, pv ? pv.metodo_txt : dt.metodo_txt),
        h('dt', {}, 'Pago'), h('dd', {}, yaCobrado ? chip('Cobrado (confirmado por ti)', 'ok') : chip('Pendiente: aún no se ha registrado nada', 'wait')),
        h('dt', {}, 'Recibo'), h('dd', {}, chip(est, tono), d.recibo ? ` ${d.recibo.numero}` : ''));

      // B · EL PDF: ampliar y descargar
      const verGrande = () => {
        const v = h('dialog', { class: 'alq-zoom', 'aria-label': 'Recibo ampliado' }, h('img', { src: imagenPdf, alt: `Recibo de ${d.etiqueta}` }),
          h('button', { class: 'btn primary', type: 'button', onclick: () => v.close() }, 'Cerrar'));
        v.addEventListener('close', () => v.remove());
        document.body.append(v); v.showModal();
      };
      const urlPdf = d.recibo ? `/alquiler/recibo/${d.recibo.id}` : d.estado === 'NO_EMITIDO' ? `/alquiler/borrador/${encodeURIComponent(a.id)}` : null;
      const enPc = LOCAL && !!urlPdf;
      const pdf = h('div', { class: 'alq-pdf' },
        porEmitir ? h('p', { class: 'alq-borrador' }, d.recibo ? '' : 'BORRADOR — NO EMITIDO. No se ha registrado ni enviado nada.') : null,
        h('button', { class: 'alq-doc-img', type: 'button', onclick: verGrande, 'aria-label': 'Ampliar el recibo' }, h('img', { src: imagenPdf, alt: `Recibo de ${d.etiqueta}` })),
        h('div', { class: 'alq-acciones' }, h('button', { class: 'btn ghost small', type: 'button', onclick: verGrande }, 'Ampliar'),
          enPc ? h('a', { class: 'btn ghost small', href: urlPdf, target: '_blank', rel: 'noopener' }, 'Abrir PDF') : null,
          enPc ? h('a', { class: 'btn ghost small', href: urlPdf, download: `Recibo ${d.etiqueta}.pdf` }, 'Descargar PDF')
            : h('a', { class: 'btn ghost small', href: imagenPdf, download: `Recibo ${d.etiqueta}.jpg` }, 'Descargar')));

      // C · MENSAJE (siempre visible y editable; si este alquiler no recibe envíos, se dice)
      const txt = h('textarea', { rows: 5, class: 'alq-msg', 'aria-label': 'Mensaje que se enviará al inquilino' }); txt.value = d.mensaje;
      const restaurar = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { txt.value = d.mensaje_recomendado; } }, 'Restaurar el recomendado');

      // D · PREGUNTAR AL CEO: su propuesta se enseña aparte; el mensaje sólo cambia con «Aplicar propuesta».
      const instr = h('input', { type: 'text', placeholder: '¿Qué quieres? «más cercano», «más formal», «recuérdale el agua»…', 'aria-label': 'Petición al CEO' });
      const propuesta = h('div', { class: 'alq-prop', hidden: true });
      const preguntar = h('button', { class: 'btn small', type: 'button', onclick: async () => {
        ocupar(true); preguntar.textContent = 'El CEO está pensando…';
        const r = await cmd('alquiler.redactar', { alquiler: a.id, mes, mensaje: txt.value, instruccion: instr.value });
        ocupar(false); preguntar.textContent = 'Preguntar al CEO';
        if (!r?.ok) { toast(r?.error || 'El CEO no ha podido responder', 'bad'); return; }
        propuesta.hidden = false;
        propuesta.replaceChildren(h('p', { class: 'small muted' }, 'Propuesta del CEO (no se ha cambiado nada):'), h('p', { class: 'alq-prop-txt' }, r.data.propuesta),
          h('div', { class: 'alq-acciones' },
            h('button', { class: 'btn primary small', type: 'button', onclick: () => { txt.value = r.data.propuesta; propuesta.hidden = true; toast('Propuesta aplicada al mensaje'); } }, 'Aplicar propuesta'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { propuesta.hidden = true; } }, 'Descartar')));
      } }, 'Preguntar al CEO');

      // E · ADJUNTOS
      const adjuntos = h('ul', { class: 'alq-partes' }, d.adjuntos.map((x) => h('li', {},
        h('strong', {}, x.tipo), ` · ${x.nombre} `, x.se_adjunta ? chip('Se adjuntará al mensaje', 'ok') : chip('No se envía', 'idle'), ' ',
        h('button', { class: 'link', type: 'button', onclick: verGrande }, 'Ver'),
        enPc ? [' · ', h('a', { class: 'link', href: urlPdf, target: '_blank', rel: 'noopener' }, 'Abrir'), ' · ', h('a', { class: 'link', href: urlPdf, download: x.nombre }, 'Descargar')] : null)));

      // F · ACCIONES
      const acciones = [];
      const datosCobro = { alquiler: a.id, ...params, mes };
      if (porEmitir) {
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => fin(false) }, yaCobrado ? 'Cerrar' : 'Cancelar'));
        acciones.push(h('button', { class: `btn ${puedeEnviar ? '' : 'primary'}`, type: 'button',
          onclick: () => accion('alquiler.cobrar', { ...datosCobro, enviar: false, mensaje: txt.value }, yaCobrado ? 'Justificante interno guardado (sin enviar)' : 'Cobro confirmado (sin enviar)') },
        yaCobrado ? 'Guardar justificante (sin enviar)' : 'Confirmar'));
        if (puedeEnviar) acciones.push(h('button', { class: 'btn primary', type: 'button',
          onclick: () => accion('alquiler.cobrar', { ...datosCobro, enviar: true, mensaje: txt.value }, 'Enviando por WhatsApp') }, yaCobrado ? 'Guardar y enviar' : 'Confirmar y enviar'));
      } else {
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => fin(false) }, 'Cerrar'));
        if (d.recibo && puedeEnviar && ['CONFIRMADO_SIN_ENVIAR', 'EMITIDO', 'ENVIO_FALLIDO'].includes(d.estado)) {
          acciones.push(h('button', { class: 'btn primary', type: 'button', onclick: () => accion('alquiler.enviar_recibo', { recibo: d.recibo.id, mensaje: txt.value }, 'Enviando') }, d.estado === 'ENVIO_FALLIDO' ? 'Reintentar el envío' : 'Enviar ahora'));
        }
        acciones.push(h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
          const r = await ask({ title: `Anular el cobro de ${d.etiqueta}`, ok: 'Anular el cobro', danger: true,
            help: `La mensualidad vuelve a quedar pendiente${d.recibo ? ` y el recibo ${d.recibo.numero} queda anulado (no se borra)` : ''}. Queda en el historial.`,
            fields: [{ name: 'motivo', label: 'Motivo', placeholder: 'p. ej. lo registré en el inquilino equivocado' }] });
          if (r) await accion('alquiler.anular_cobro', { alquiler: a.id, mes, motivo: r.motivo }, 'Cobro anulado');
        } }, 'Anular cobro'));
      }
      botones.push(...acciones, preguntar);
      const enviado = d.estado === 'ENVIADO' || d.estado === 'ENVIANDO';
      txt.disabled = enviado;
      const envioTxt = !puedeEnviar ? 'Este alquiler no recibe envíos (entrega en mano o sin WhatsApp confirmado): el mensaje se guarda pero no se manda.'
        : enviado ? `Mensaje ${d.estado === 'ENVIADO' ? 'enviado' : 'enviándose'} a ${d.destinatario}.`
          : `Se enviará a ${d.destinatario} SÓLO si pulsas «${porEmitir ? (yaCobrado ? 'Guardar y enviar' : 'Confirmar y enviar') : 'Enviar ahora'}».`;
      const sec = (t, ...hijos) => h('section', { class: 'alq-sec-box' }, h('h3', { class: 'alq-sec' }, t), ...hijos);
      dlg.append(
        h('header', { class: 'cmp-head' }, h('h2', {}, `Recibo · ${a.inquilino.split(' ')[0]} · ${d.etiqueta}`), chip(est, tono)),
        h('div', { class: 'alq-ficha-body alq-panel alq-recibo-cuerpo' },
          d.recibo?.wa_motivo ? h('p', { class: 'small alq-aviso' }, d.recibo.wa_motivo) : null,
          sec('Datos del cobro', datos),
          sec('Recibo PDF', pdf),
          sec('Mensaje que se enviará al inquilino', h('p', { class: 'small muted' }, envioTxt), txt,
            enviado ? null : h('div', { class: 'alq-acciones' }, restaurar)),
          enviado ? null : sec('Preguntar al CEO', h('div', { class: 'alq-acciones' }, instr, preguntar), propuesta),
          sec('Documentos adjuntos', adjuntos, h('p', { class: 'small muted' }, d.otros_documentos)),
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
  const EST = { PENDIENTE: ['Pendiente', 'wait'], PARCIAL: ['Pagada en parte', 'ask'], PAGADA: ['Pagada', 'ok'], SIN_REPARTIR: ['Sin repartir', 'idle'], ANULADA: ['Anulada', 'idle'],
    CERRADA: ['Cerrada', 'ok'] };
  const CIERRE = { SIN_RECLAMAR: 'no se reclama', RESUELTA_FUERA: 'resuelta fuera de CEOPadre' };
  const estChip = (e) => chip(...(EST[e] || [e, 'idle']));
  const todos = (gestiones) => gestiones.flatMap((c) => (c.alquileres || []).map((a) => ({ ...a, gestion: c })));
  const facturasDe = (lista) => { const m = new Map(); for (const a of lista) for (const f of a.suministros || []) m.set(f.id, f); return [...m.values()].sort((x, y) => y.fecha.localeCompare(x.fecha)); };
  const firma = (gestiones) => JSON.stringify(gestiones.flatMap((c) => c.alquileres || []));
  const hoy = () => new Date().toISOString().slice(0, 10);
  const vista = { tab: 'suministros', filtro: 'GESTIONAR' }; // sobrevive al repintado
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
  const repartirFactura = (f) => editorReparto(f);
  // EDITOR DE REPARTO: responsable · vivienda · importe · %; total asignado y diferencia en vivo. «Guardar propuesta» no crea
  // deuda (suministro.proponer); «Confirmar reparto» sólo con la diferencia a 0 (suministro.repartir, sólo Antonio).
  function editorReparto(f) {
    const cand = lista.filter((a) => !a.inmueble || a.inmueble === f.inmueble);
    const pr = f.propuesta?.ok ? f.propuesta : null;
    const base = f.partes.length ? f.partes.map((x) => ({ obligado: x.obligado, alquiler: x.alquiler, cent: x.importe }))
      : pr ? pr.partes.map((x) => ({ obligado: x.obligado, alquiler: x.alquiler || null, unidad: x.unidad, cent: x.importe_cent ?? null })) : [{ obligado: '', alquiler: null, cent: null }];
    if (base.some((x) => x.cent == null)) base.forEach((x, i) => { x.cent = Math.floor(f.importe / base.length) + (i < f.importe % base.length ? 1 : 0); });
    const filas = h('div', { class: 'alq-rep-filas' });
    const resumen = h('p', { class: 'alq-rep-sum', 'aria-live': 'polite' });
    const criterio = h('textarea', { rows: 3, placeholder: 'Por qué se reparte así (periodo, quién vivía…)' });
    criterio.value = f.partes[0]?.criterio?.split(' · ')[0] || pr?.criterio || '';
    const nombres = h('datalist', { id: `alq-rep-n-${f.id}` }, cand.map((a) => h('option', { value: a.inquilino })));
    const leer = () => [...filas.children].map((el) => ({ obligado: el.querySelector('[name=o]').value.trim(), cent: aCent(el.querySelector('[name=i]').value), alquiler: el.dataset.alq || null }));
    const btnConf = h('button', { class: 'btn primary', type: 'button' }, 'Confirmar reparto');
    const pintar = () => {
      const xs = leer(), asignado = xs.reduce((s, x) => s + (x.cent || 0), 0), dif = f.importe - asignado;
      [...filas.children].forEach((el, i) => { el.querySelector('.alq-rep-pct').textContent = xs[i].cent != null && f.importe ? `${(xs[i].cent * 100 / f.importe).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : '—'; });
      resumen.className = `alq-rep-sum ${dif ? 't-warn' : 't-ok'}`;
      resumen.textContent = `Factura ${f.importe_txt} · asignado ${eur(asignado)} · ${dif === 0 ? 'cuadra exacto' : dif > 0 ? `faltan ${eur(dif)} por asignar` : `sobran ${eur(-dif)}`}`;
      btnConf.disabled = dif !== 0 || xs.some((x) => !x.obligado || x.cent == null);
    };
    const fila = (x) => {
      const o = h('input', { name: 'o', value: x.obligado, list: nombres.id, 'aria-label': 'Responsable', placeholder: 'Responsable', autocomplete: 'off' });
      const i = h('input', { name: 'i', value: x.cent == null ? '' : centTxt(x.cent), inputmode: 'decimal', 'aria-label': 'Importe en euros', class: 'alq-rep-imp' });
      const el = h('div', { class: 'alq-rep-fila' }, o, h('small', { class: 'muted alq-rep-viv' }, x.unidad || cand.find((a) => a.id === x.alquiler)?.unidad || ''), i, h('span', { class: 'alq-rep-pct small' }),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Quitar responsable', onclick: () => { el.remove(); pintar(); } }, '✕'));
      if (x.alquiler) el.dataset.alq = x.alquiler;
      o.addEventListener('input', () => { const a = cand.find((c) => c.inquilino === o.value.trim()); if (a) el.dataset.alq = a.id; else delete el.dataset.alq; pintar(); });
      i.addEventListener('input', pintar);
      return el;
    };
    base.forEach((x) => filas.append(fila(x)));
    const partesOut = (xs) => xs.map((x) => ({ obligado: x.obligado, ...(x.alquiler ? { alquiler: x.alquiler } : {}), importe: centTxt(x.cent) }));
    const dlg = h('dialog', { class: 'sheet alq-rep', 'aria-label': `Reparto de ${f.importe_txt}` },
      h('header', { class: 'cmp-head' }, h('h2', {}, `Reparto · ${f.proveedor} ${fecha(f.fecha)} · ${f.importe_txt}`)),
      h('p', { class: 'small muted' }, `${f.inmueble}${f.periodo ? ` · periodo ${fecha(f.periodo.desde)} – ${fecha(f.periodo.hasta)}` : ''}${pr && !pr.guardada ? ` · propuesta automática: ${pr.criterio}` : pr?.guardada ? ' · propuesta guardada (aún no es deuda)' : ''}`),
      nombres, filas, resumen,
      h('div', { class: 'alq-acciones' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { filas.append(fila({ obligado: '', alquiler: null, cent: null })); pintar(); } }, 'Añadir responsable'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { const els = [...filas.children]; els.forEach((el, k) => { el.querySelector('[name=i]').value = centTxt(Math.floor(f.importe / els.length) + (k < f.importe % els.length ? 1 : 0)); }); pintar(); } }, 'A partes iguales')),
      h('label', { class: 'field' }, 'Criterio', criterio),
      h('div', { class: 'alq-rep-acc' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Volver'),
        f.partes.length ? null : h('button', { class: 'btn', type: 'button', onclick: async (e) => {
          const xs = leer().filter((x) => x.obligado || x.cent);
          if (!xs.length || xs.some((x) => !x.obligado || x.cent == null)) { toast('Cada fila necesita responsable e importe', 'bad'); return; }
          if (await run('suministro.proponer', { factura: f.id, partes: partesOut(xs), criterio: criterio.value }, 'Propuesta guardada (no es deuda)', e.currentTarget)) dlg.close();
        } }, 'Guardar propuesta'),
        btnConf));
    btnConf.addEventListener('click', async (e) => {
      const xs = leer();
      if (await run('suministro.repartir', { factura: f.id, partes: partesOut(xs), criterio: criterio.value }, 'Reparto confirmado', e.currentTarget)) dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); pintar(); dlg.showModal();
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

  // La factura ORIGINAL (primera página) en grande, en el PC y en el móvil. Sólo se mira: no se adjunta a nada.
  async function verFacturaPdf(f) {
    const v = await cmd('suministro.ver_documento', { factura: f.id });
    if (!v?.ok) { toast(v?.error || 'No se pudo abrir la factura', 'bad'); return; }
    const pags = v.data.paginas?.length ? v.data.paginas : [v.data.imagen];
    // Documento COMPLETO (todas las páginas) y el PDF original para guardarlo: en el PC por su enlace; en el móvil llega por
    // el canal autenticado (se retira de Supabase a los 3 min) y se guarda con un Blob local, sin enlaces públicos.
    const descargar = async (btn) => {
      if (LOCAL) { const a = h('a', { href: `/alquiler/factura/${f.id}`, download: v.data.nombre }); document.body.append(a); a.click(); a.remove(); return; }
      btn.disabled = true;
      try {
        const d = await cmd('suministro.ver_documento', { factura: f.id, pdf: true });
        if (!d?.ok) { toast(d?.error || 'No se pudo descargar', 'bad'); return; }
        const bin = Uint8Array.from(atob(d.data.pdf), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bin], { type: 'application/pdf' }));
        const a = h('a', { href: url, download: d.data.nombre }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        toast('PDF original descargado');
      } finally { btn.disabled = false; }
    };
    const z = h('dialog', { class: 'alq-zoom', 'aria-label': v.data.titulo },
      h('p', { class: 'small' }, `${v.data.nombre} · ${pags.length} ${pags.length === 1 ? 'página' : 'páginas'}`),
      h('div', { class: 'alq-zoom-pags' }, pags.map((src, i) => h('img', { src, alt: `${v.data.titulo} · página ${i + 1} de ${pags.length}`, loading: i ? 'lazy' : 'eager' }))),
      h('div', { class: 'alq-acciones' },
        h('button', { class: 'btn', type: 'button', onclick: (e) => descargar(e.currentTarget) }, 'Descargar PDF'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => z.close() }, 'Cerrar')));
    z.addEventListener('close', () => z.remove());
    document.body.append(z); z.showModal();
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
        h('dt', {}, 'Documento'), h('dd', { class: 'small' }, f.documento ? [
          h('button', { class: 'link', type: 'button', onclick: () => verFacturaPdf(f) }, 'Ver la factura original'),
          LOCAL ? [' · ', h('a', { class: 'link', href: `/alquiler/factura/${f.id}`, target: '_blank', rel: 'noopener' }, 'Abrir PDF'), ' · ',
            h('a', { class: 'link', href: `/alquiler/factura/${f.id}`, download: `Factura ${f.proveedor} ${f.fecha}.pdf` }, 'Descargar')] : null]
          : `Sin PDF guardado (se buscó en GalanContable; fuente: ${f.fuente})`),
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
    const nombre = (a) => a.inquilino.split(' ')[0];
    const importeDe = (x) => (x.recibo ? x.recibo.importe_cent : x.cobro_sin_recibo?.importe_cent ?? null);
    const fechaDe = (x) => (x.recibo ? x.recibo.fecha_pago : x.cobro_sin_recibo?.fecha_pago || null);
    const pagadas = lst.flatMap((a) => (a.historial || []).filter((x) => x.pago === 'PAGADO').map((x) => ({ a, x })));
    // Rentas de ESTE mes cobradas (la mensualidad), con o sin fecha.
    const delMes = pagadas.filter(({ x }) => x.mes === mes);
    const rentasMes = delMes.reduce((s, { x }) => s + (importeDe(x) || 0), 0);
    const detalleMes = delMes.map(({ a, x }) => `${nombre(a)} ${importeDe(x) != null ? eur(importeDe(x)) : 'importe por confirmar'}`).join(' · ');
    // Dinero RECIBIDO este mes: sólo cobros con fecha acreditada dentro del mes (de cualquier mensualidad).
    const recibido = pagadas.filter(({ x }) => (fechaDe(x) || '').startsWith(mes));
    const cobRenta = recibido.reduce((s, { x }) => s + (importeDe(x) || 0), 0);
    const sinFecha = delMes.filter(({ x }) => !fechaDe(x)).map(({ a }) => nombre(a));
    const cobSum = fs.flatMap((f) => f.partes.flatMap((x) => x.cobros)).filter((c) => c.estado === 'VALIDO' && (c.fecha_pago || '').startsWith(mes)).reduce((s, c) => s + c.importe_cent, 0);
    const recibos = lst.reduce((s, a) => s + (a.recibos_sin_enviar || 0), 0), sinComunicar = lst.reduce((s, a) => s + (a.recibos_sin_comunicar || 0), 0);
    const kpi = (t, v, tone) => h('div', { class: `alq-kpi t-${tone}` }, h('small', {}, t), h('strong', {}, v));
    return h('div', { class: 'alq-resumen' },
      kpi('Alquileres activos', String(lst.length), 'idle'),
      kpi('Rentas pendientes', eur(renta), renta ? 'wait' : 'ok'),
      kpi('Suministros pendientes', eur(sum), sum ? 'wait' : 'ok'),
      h('div', { class: 'alq-kpi t-ok' }, h('small', {}, `Rentas de ${MESES[Number(mes.slice(5, 7)) - 1]} cobradas`), h('strong', {}, `${eur(rentasMes)} · ${delMes.length} de ${lst.length}`),
        detalleMes ? h('small', { class: 'muted' }, detalleMes) : null),
      h('div', { class: 'alq-kpi t-ok' }, h('small', {}, 'Recibido este mes (con fecha)'), h('strong', {}, `${eur(cobRenta)} renta · ${eur(cobSum)} suministros`),
        sinFecha.length ? h('small', { class: 'muted' }, `Sin fecha de cobro: ${sinFecha.join(', ')}`) : null),
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
  // POR GESTIONAR (por defecto): sin resolver con los inquilinos (sin repartir, pendiente o parcial). Una propuesta de reparto
  // sin confirmar se gestiona, pero NO es deuda (no suma «pendiente»). ACTIVAS: además, lo que aún debes pagar al proveedor.
  const resuelta = (f) => ['PAGADA', 'CERRADA'].includes(f.estado);
  const FILTROS = [['GESTIONAR', 'Por gestionar'], ['ACTIVAS', 'Todas las activas'], ['PARCIAL', 'Parcialmente cobradas'], ['RESUELTAS', 'Pagadas / cerradas'], ['TODOS', 'Historial completo']];
  const enFiltro = (k, f) => (k === 'TODOS' ? true : k === 'GESTIONAR' ? !resuelta(f) : k === 'ACTIVAS' ? !resuelta(f) || f.pago_proveedor === 'PENDIENTE'
    : k === 'PARCIAL' ? f.estado === 'PARCIAL' : resuelta(f));
  // REGISTRAR SITUACIÓN de una factura (sobre todo antiguas): lo que pasó de verdad, sin recrear operaciones ficticias.
  async function registrarSituacion(f) {
    if (f.cierre) {
      const r = await ask({ title: `Reabrir · ${f.proveedor} ${fecha(f.fecha)}`, ok: 'Reabrir', help: `Está cerrada (${CIERRE[f.cierre.tipo]}: ${f.cierre.motivo}). Reabrirla la devuelve a «por gestionar» con su historial.`, fields: [] });
      if (r) await run('suministro.cerrar', { factura: f.id, reabrir: true }, 'Reabierta');
      return;
    }
    const pend = f.partes.filter((x) => x.pendiente > 0);
    const r = await ask({ title: `Registrar situación · ${f.proveedor} ${fecha(f.fecha)} · ${f.importe_txt}`, ok: 'Guardar',
      help: 'Para dejar constancia de lo que ocurrió sin inventar cobros. Si te pagaron y sabes cuánto y cuándo, usa «Me ha pagado» (queda como dinero recibido). La documentación y el historial se conservan siempre.',
      fields: [{ name: 'tipo', label: 'Qué pasó', type: 'choice', options: [
        ...(pend.length === 1 ? [{ value: 'COBRO', label: `${pend[0].obligado.split(' ')[0]} me pagó (registrar el cobro)` }] : []),
        { value: 'RESUELTA_FUERA', label: 'Ya está resuelta fuera de CEOPadre (no recuerdo importe ni fecha)' },
        { value: 'SIN_RECLAMAR', label: 'No la voy a reclamar' }] },
      { name: 'motivo', label: 'Motivo o nota (obligatorio salvo cobro)', type: 'text', required: false }] });
    if (!r) return;
    if (r.tipo === 'COBRO') { await cobrarParte(pend[0]); return; }
    if (!String(r.motivo || '').trim()) { toast('Escribe el motivo: queda en el historial', 'bad'); return; }
    await run('suministro.cerrar', { factura: f.id, tipo: r.tipo, motivo: r.motivo }, 'Situación registrada');
  }
  // Confirmar la propuesta TAL CUAL (con su criterio) desde la lista; para cambiar responsables, «Revisar» en el detalle.
  async function confirmarPropuesta(f) {
    const pr = f.propuesta;
    if (pr.guardada && pr.diferencia_cent) { editorReparto(f); return; } // faltan céntimos por asignar: se corrige en el editor
    const r = await ask({ title: `Confirmar reparto · ${f.importe_txt}`, ok: 'Confirmar reparto',
      help: `${pr.criterio}.${pr.probable ? ' Incluye datos probables: confírmalo sólo si es correcto.' : ''} ${pr.guardada ? pr.partes.map((x) => `${x.obligado} ${eur(x.importe_cent)}`).join(' · ') : 'A partes iguales'}. Después cada parte se marca como cobrada cuando te paguen.`, fields: [] });
    if (!r) return;
    await run('suministro.repartir', { factura: f.id, criterio: `Propuesta confirmada por Antonio: ${pr.criterio}`,
      partes: pr.partes.map((x) => ({ obligado: x.obligado, ...(x.alquiler ? { alquiler: x.alquiler } : {}), ...(pr.guardada ? { importe: centTxt(x.importe_cent) } : {}) })) }, 'Reparto confirmado');
  }
  function tabSuministros(lst, repintar) {
    const fs = facturasDe(lst);
    const pasa = (f) => enFiltro(vista.filtro, f);
    const vis = fs.filter(pasa);
    // Cada factura con lo que hace falta para gestionarla SIN abrir más ventanas: fecha, periodo, inmueble, proveedor, importe,
    // pago al proveedor y cobro a inquilinos POR SEPARADO, lo pendiente y sus acciones.
    const fila = (f) => h('button', { class: 'alq-fact-fila', type: 'button', onclick: () => abrirFactura(f), 'aria-label': `Detalle de la factura ${f.proveedor} del ${fecha(f.fecha)}` },
      h('span', { class: 'alq-ff-a' }, h('strong', {}, `${f.proveedor} · ${fecha(f.fecha)} · ${f.importe_txt}`),
        h('small', { class: 'muted' }, ` ${f.tipo === 'AGUA' ? 'Agua' : f.tipo}${f.periodo ? ` ${fecha(f.periodo.desde)} – ${fecha(f.periodo.hasta)}` : ''} · ${f.inmueble}`)),
      h('span', { class: 'alq-ff-b small' }, f.cierre ? `Cerrada: ${CIERRE[f.cierre.tipo]} · ${f.cierre.motivo}`
        : f.partes.length ? f.partes.map((x) => `${x.obligado.split(' ')[0]} ${x.importe_txt}${x.estado === 'PAGADA' ? ' ✓' : x.estado === 'PARCIAL' ? ` (faltan ${eur(x.pendiente)})` : ''}`).join(' · ')
          : (f.propuesta?.ok ? 'Reparto propuesto, sin confirmar (aún no es deuda)' : 'Sin propuesta: falta saber quién vivía')),
      h('span', { class: 'alq-ff-c' }, h('small', { class: 'muted' }, 'Inquilinos: '), estChip(f.estado), f.partes.length && f.pendiente ? h('small', {}, ` faltan ${eur(f.pendiente)}`) : null,
        h('small', { class: `muted alq-prov ${f.pago_proveedor === 'PENDIENTE' ? 't-warn' : ''}` }, ` · ${f.proveedor}: ${PAGO_PROV[f.pago_proveedor] || f.pago_proveedor}`)));
    const acciones = (f) => {
      const pend = f.partes.filter((x) => x.pendiente > 0);
      const b = (t, fn, cls = 'ghost') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: (e) => { e.stopPropagation(); fn(e.currentTarget); } }, t);
      return h('div', { class: 'alq-fact-acc' },
        f.documento ? b('Ver factura', () => verFacturaPdf(f)) : h('small', { class: 'muted', title: f.fuente }, 'Sin PDF guardado'),
        f.sin_repartir && f.propuesta?.ok && !f.cierre ? b('Confirmar reparto', () => confirmarPropuesta(f), '') : null,
        !f.cierre && pend.length === 1 ? b(`${pend[0].obligado.split(' ')[0]} me ha pagado`, (btn) => cobrarParte(pend[0], btn), '') : null,
        b('Pago al proveedor', () => pagoProveedor(f)),
        b(f.cierre ? 'Reabrir' : 'Registrar situación', () => registrarSituacion(f)));
    };
    return h('div', { class: 'alq-panel' },
      h('div', { class: 'alq-filtros', role: 'tablist' }, FILTROS.map(([k, t]) => h('button', { class: `btn small ${vista.filtro === k ? 'primary' : 'ghost'}`, type: 'button', role: 'tab', 'aria-selected': String(vista.filtro === k),
        onclick: () => { vista.filtro = k; repintar(); } }, `${t} (${fs.filter((f) => enFiltro(k, f)).length})`)),
      h('button', { class: 'btn small', type: 'button', onclick: () => registrarFactura() }, 'Registrar factura')),
      vis.length ? h('div', { class: 'alq-fact-lista' }, vis.map((f) => h('div', { class: 'alq-fact-item' }, fila(f), acciones(f))))
        : h('p', { class: 'muted' }, vista.filtro === 'GESTIONAR' ? 'Nada por gestionar en suministros.' : 'Ninguna factura en este filtro.'));
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
