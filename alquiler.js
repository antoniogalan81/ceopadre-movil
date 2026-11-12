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
        { name: 'envio', label: 'Entrega del recibo', type: 'choice', value: a.envio, options: [{ value: 'WHATSAPP', label: 'Por WhatsApp' }, { value: 'MANO', label: 'En mano (no se envía)' }] },
        { name: 'telefono', label: 'WhatsApp del inquilino', value: a.telefono, inputmode: 'tel', required: false },
        { name: 'contacto', label: 'Contacto para las comunicaciones (si no es el inquilino)', value: a.contacto || '', required: false },
        { name: 'inmueble', label: 'Inmueble', value: a.inmueble || '', required: false },
        { name: 'unidad', label: 'Unidad (piso, habitación…)', value: a.unidad || '', required: false },
        { name: 'titular', label: 'Titular (persona o sociedad)', value: a.titular || '', required: false },
        { name: 'lugar', label: 'Lugar de emisión', value: a.lugar },
      ] });
    const vacioVale = (k) => ['contacto', 'unidad'].includes(k) || (k === 'telefono' && r?.envio === 'MANO');
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
            ' · ', h('button', { class: 'link', type: 'button', onclick: () => rectificar(a, x) }, 'Rectificar')] : '—')))))));
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
      historial(a));
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

  // TARJETA COMPACTA (la misma de los agentes, web/tarjeta.js). El mes relevante va en el estado. La acción principal:
  // pendiente → «Me ha pagado», que SÓLO abre la vista previa (nada se registra ni se envía sin «Confirmar pago y
  // enviar»); envío fallido → «Ver problema»; al día → «Ver ficha». Nunca cobra ni envía con un solo clic.
  function mini(a, gestion) {
    const pend = a.pendientes;
    const ultimo = a.historial.find((x) => x.recibo);
    const r = ultimo?.recibo;
    const mes = (m) => MESES[Number(m.slice(5, 7)) - 1];
    const metodo = a.metodos.find((m) => m.valor === a.metodo)?.nombre || a.metodo;
    const busy = ocupado.has(a.id);
    const abrir = () => abrirFicha(a);
    const [estado, accion] = r?.wa_estado === 'ERROR' ? [['Recibo sin enviar', 'bad'], { txt: 'Ver problema', on: abrir }]
      : pend.length > 1 ? [[`${pend.length} mensualidades pendientes`, 'bad'], { txt: busy ? 'Registrando…' : 'Me ha pagado', on: (b) => modificar(a, b), cls: 'primary', disabled: busy }]
      : pend.length ? [[`Pendiente de pago · ${mes(pend[0])}`, 'wait'], { txt: busy ? 'Registrando…' : 'Me ha pagado', on: (b) => previaYConfirmar(a, {}, b), cls: 'primary', disabled: busy }]
      : r?.wa_estado === 'ENVIANDO' ? [['Enviando recibo…', 'work'], { txt: 'Ver ficha', on: abrir }]
      : [[`Pagado · al día${ultimo ? ` · ${mes(ultimo.mes)}` : ''}`, 'ok'], { txt: 'Ver ficha', on: abrir }];
    const el = miniTarjeta({ id: `alq:${a.id}`, titulo: a.inquilino, sub: gestion?.nombre && gestion.nombre !== 'Alquileres' ? `Alquileres · ${gestion.nombre}` : 'Alquileres · Gestión', clase: 'alq-mini',
      desc: `Recibo mensual por WhatsApp · ${eur(a.importe)} al mes · ${metodo}`, estado, accion, abrir });
    return { tono: estado[1] === 'wait' ? 'ask' : estado[1], texto: `${a.inquilino} alquileres alquiler ${gestion?.nombre || ''}`, el };
  }

  // ---------------------------------------------------------------- PANEL «Alquileres» (Agentes → Alquileres)
  // Todos los alquileres en una tabla (inmueble, unidad, titular, inquilino, renta, estado, pendiente, último movimiento,
  // próxima acción) y «Agua y suministros» con su reparto. Nada se cobra ni se envía sin confirmarlo Antonio.
  const fecha = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
  const MOV = { COBRADO: 'Cobro registrado', RECTIFICADO: 'Recibo rectificado', ENVIADO: 'Recibo enviado', ENVIANDO: 'Enviando recibo', ENVIO_ERROR: 'Envío fallido',
    REINTENTO: 'Reintento de envío', FICHA: 'Ficha modificada', CONFIGURADO: 'Alta del alquiler', RECONFIGURADO: 'Ficha reconfigurada', SUMINISTRO_COBRADO: 'Suministro cobrado' };
  const PAGO_PROV = { DESCONOCIDO: 'sin comprobar', PENDIENTE: 'pendiente', PAGADA: 'pagada', DOMICILIADA: 'domiciliada' };
  const todos = (gestiones) => gestiones.flatMap((c) => (c.alquileres || []).map((a) => ({ ...a, gestion: c })));
  const facturasDe = (lista) => { const m = new Map(); for (const a of lista) for (const f of a.suministros || []) m.set(f.id, f); return [...m.values()].sort((x, y) => y.fecha.localeCompare(x.fecha)); };
  const firma = (gestiones) => JSON.stringify(gestiones.flatMap((c) => c.alquileres || []));

  async function cobrarParte(x, btn) {
    const r = await ask({ title: `Cobro de suministro · ${x.obligado}`, ok: 'Confirmar cobro', help: `${x.importe_txt}. Sólo si ya te lo han pagado: queda registrado como cobrado.`,
      fields: [{ name: 'fecha_pago', label: 'Fecha del pago', type: 'date', value: new Date().toISOString().slice(0, 10) },
        { name: 'metodo', label: 'Forma de pago', type: 'choice', value: 'TRANSFERENCIA', options: [{ value: 'TRANSFERENCIA', label: 'Transferencia' }, { value: 'BIZUM', label: 'Bizum' }, { value: 'EFECTIVO', label: 'Efectivo' }] }] });
    if (r) await run('suministro.cobrar', { parte: x.id, ...r }, 'Cobro registrado', btn);
  }
  async function mensajeParte(x) {
    const v = await cmd('suministro.mensaje', { parte: x.id });
    if (!v?.ok) { toast(v?.error || 'No se pudo preparar el mensaje', 'bad'); return; }
    const r = await ask({ title: `Mensaje para ${v.data.destinatario}`, ok: 'Copiar texto', help: v.data.aviso,
      fields: [{ name: 'texto', label: 'Texto (puedes cambiarlo antes de copiarlo)', type: 'textarea', value: v.data.texto }] });
    if (!r?.texto) return;
    try { await navigator.clipboard.writeText(r.texto); toast('Texto copiado: envíalo tú cuando quieras'); } catch { toast('No se pudo copiar: selecciónalo y cópialo', 'bad'); }
  }
  async function repartirFactura(f, lista) {
    const cand = lista.filter((a) => !a.inmueble || a.inmueble === f.inmueble);
    const r = await ask({ title: `Repartir ${f.importe_txt} · ${f.proveedor} ${fecha(f.fecha)}`, ok: 'Guardar reparto',
      help: 'A partes iguales entre los marcados (el céntimo impar va al primero). Comprueba antes quién vivía en el inmueble en ese periodo.',
      fields: [...cand.map((a) => ({ name: `a:${a.id}`, label: a.inquilino, type: 'checkbox', value: true })),
        { name: 'otro', label: 'Otro obligado (p. ej. un inquilino anterior)', required: false },
        { name: 'criterio', label: 'Por qué se reparte así', type: 'textarea', placeholder: 'p. ej. ambos vivían en el inmueble todo el periodo de la factura' }] });
    if (!r) return;
    const partes = [...cand.filter((a) => r[`a:${a.id}`]).map((a) => ({ obligado: a.inquilino, alquiler: a.id })), ...(r.otro ? [{ obligado: r.otro }] : [])];
    if (!partes.length) { toast('Marca al menos un obligado', 'bad'); return; }
    await run('suministro.repartir', { factura: f.id, partes, criterio: r.criterio }, 'Reparto guardado');
  }
  async function registrarFactura(lista) {
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

  function filaPanel(a) {
    const pend = a.pendientes;
    const estado = pend.length > 1 ? chip(`${pend.length} meses pendientes`, 'bad') : pend.length ? chip(`Pendiente · ${mesTitulo(pend[0])}`, 'wait') : chip('Al día', 'ok');
    const pagar = (e) => (pend.length > 1 ? modificar(a, e.currentTarget) : previaYConfirmar(a, {}, e.currentTarget));
    const tr = h('tr', {},
      h('td', {}, a.inmueble || '—', a.unidad ? h('small', { class: 'muted' }, ` · ${a.unidad}`) : null),
      h('td', {}, a.titular || a.arrendador),
      h('td', {}, h('button', { class: 'link', type: 'button', onclick: () => abrirFicha(a) }, a.inquilino), a.contacto ? h('small', { class: 'muted alq-motivo' }, `vía ${a.contacto}`) : null),
      h('td', { class: 'num' }, eur(a.importe)),
      h('td', {}, estado),
      h('td', { class: 'num' }, a.pendiente_cent ? eur(a.pendiente_cent) : '—'),
      h('td', {}, a.ultimo ? `${MOV[a.ultimo.tipo] || a.ultimo.tipo} · ${fecha(a.ultimo.at.slice(0, 10))}` : '—'),
      h('td', { class: 'alq-prox' }, a.proxima),
      h('td', {}, pend.length ? h('button', { class: 'btn primary small', type: 'button', disabled: ocupado.has(a.id), onclick: pagar }, 'Me ha pagado')
        : h('button', { class: 'btn ghost small', type: 'button', onclick: () => abrirFicha(a) }, 'Ficha')));
    // En el móvil cada fila es una tarjeta: cada celda lleva su etiqueta (CSS ::before).
    [...tr.children].forEach((td, i) => { if (COLS[i]) td.dataset.l = COLS[i]; });
    return tr;
  }
  const COLS = ['Inmueble', 'Titular', 'Inquilino', 'Renta', 'Estado', 'Pendiente', 'Último movimiento', 'Próxima acción', ''];
  function facturaPanel(f, lista) {
    const parte = (x) => h('li', {}, `${x.obligado}: ${x.importe_txt} `, x.estado === 'COBRADO' ? chip(`Cobrado ${fecha(x.fecha_pago)}`, 'ok') : [chip('Pendiente', 'wait'),
      ' ', h('button', { class: 'link', type: 'button', onclick: (e) => cobrarParte(x, e.currentTarget) }, 'Me ha pagado'),
      ' · ', h('button', { class: 'link', type: 'button', onclick: () => mensajeParte(x) }, 'Preparar mensaje')]);
    const tipo = f.tipo === 'AGUA' ? 'Agua' : f.tipo.charAt(0) + f.tipo.slice(1).toLowerCase();
    return h('article', { class: `alq-card alq-fact${f.sin_repartir || f.partes.some((x) => x.estado === 'PENDIENTE') ? ' need' : ''}` },
      h('header', { class: 'alq-head' }, h('div', {}, h('h3', {}, `${tipo} · ${f.proveedor} · ${f.importe_txt}`),
        h('small', { class: 'muted' }, `${f.inmueble} · factura del ${fecha(f.fecha)}${f.periodo ? ` · periodo ${fecha(f.periodo.desde)}–${fecha(f.periodo.hasta)}` : ''}`))),
      h('p', { class: 'muted' }, `Pago al proveedor: ${PAGO_PROV[f.pago_proveedor] || f.pago_proveedor}. El cobro a los inquilinos va aparte.`),
      f.nota ? h('p', { class: 'alq-motivo' }, f.nota) : null,
      f.sin_repartir ? h('div', { class: 'alq-acciones' }, chip('Sin repartir', 'wait'), ' ', h('button', { class: 'btn small', type: 'button', onclick: () => repartirFactura(f, lista) }, 'Repartir'))
        : [h('ul', { class: 'alq-partes' }, f.partes.map(parte)), h('small', { class: 'muted' }, f.partes[0]?.criterio || '')]);
  }
  function cuerpoPanel(gestiones) {
    const lista = todos(gestiones);
    const total = lista.reduce((s, a) => s + (a.pendiente_cent || 0), 0);
    const facturas = facturasDe(lista);
    return h('div', { class: 'alq-panel' },
      h('p', {}, `${lista.length} ${lista.length === 1 ? 'alquiler' : 'alquileres'} · pendiente total `, total ? chip(eur(total), 'wait') : chip('nada', 'ok'),
        h('small', { class: 'muted' }, ' · un cobro sólo cuenta cuando tú lo confirmas')),
      h('div', { class: 'alq-scroll' }, h('table', { class: 'alq-tabla alq-panel-tabla' },
        h('thead', {}, h('tr', {}, ['Inmueble', 'Titular', 'Inquilino', 'Renta', 'Estado', 'Pendiente', 'Último movimiento', 'Próxima acción', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, lista.map(filaPanel)))),
      h('h3', { class: 'alq-sec' }, 'Agua y suministros'),
      h('div', { class: 'alq-acciones' }, h('button', { class: 'btn small', type: 'button', onclick: () => registrarFactura(lista) }, 'Registrar factura')),
      facturas.length ? h('div', { class: 'alq-list' }, facturas.map((f) => facturaPanel(f, lista))) : h('p', { class: 'muted' }, 'Aún no hay facturas de suministros registradas.'));
  }
  let panel = null; // { dlg, cuerpo, sig }
  function abrirPanel(gestiones) {
    if (panel?.dlg.open) panel.dlg.close();
    const cuerpo = h('div', { class: 'alq-ficha-body' }, cuerpoPanel(gestiones));
    const dlg = h('dialog', { class: 'sheet alq-ficha alq-panel-dlg', 'aria-label': 'Panel de alquileres' },
      h('header', { class: 'cmp-head' }, h('h2', {}, 'Alquileres'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')), cuerpo);
    dlg.addEventListener('close', () => { dlg.remove(); if (panel?.dlg === dlg) panel = null; });
    document.body.append(dlg);
    panel = { dlg, cuerpo, sig: firma(gestiones) };
    dlg.showModal();
  }
  function syncPanel(gestiones) {
    if (!panel) return;
    const sig = firma(gestiones);
    if (sig === panel.sig) return;
    panel.sig = sig;
    panel.cuerpo.replaceChildren(cuerpoPanel(gestiones));
  }
  function miniPanel(gestiones) {
    const lista = todos(gestiones);
    const total = lista.reduce((s, a) => s + (a.pendiente_cent || 0), 0);
    const sinRepartir = facturasDe(lista).filter((f) => f.sin_repartir).length;
    const estado = total ? [`Pendiente ${eur(total)}`, 'wait'] : sinRepartir ? [`${sinRepartir} factura${sinRepartir > 1 ? 's' : ''} sin repartir`, 'wait'] : ['Todo al día', 'ok'];
    const abrir = () => abrirPanel(gestiones);
    const el = miniTarjeta({ id: 'alq:panel', titulo: 'Alquileres', sub: 'Agente · panel completo', clase: 'alq-mini',
      desc: `${lista.length} ${lista.length === 1 ? 'alquiler' : 'alquileres'}: cobros, recibos, historial, agua y suministros`, estado, accion: { txt: 'Abrir panel', on: abrir, cls: 'primary' }, abrir });
    return { tono: estado[1] === 'wait' ? 'ask' : estado[1], texto: 'alquileres alquiler panel agua suministros inquilinos recibos', el };
  }

  /** Tarjetas compactas: el panel y cada alquiler que traen las gestiones (vacío si no hay); fichas y panel al día. */
  return {
    minis: (gestiones) => (todos(gestiones).length ? [miniPanel(gestiones), ...gestiones.flatMap((c) => (c.alquileres || []).map((a) => mini(a, c)))] : []),
    sync: (gestiones) => { sync(gestiones); syncPanel(gestiones); }, abrirFicha, abrirPanel,
  };
}
