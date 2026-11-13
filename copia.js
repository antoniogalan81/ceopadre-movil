// COPIA DE SEGURIDAD ECOAPP en «Agentes» (sólo PC). Pinta el estado REAL que devuelve el motor (copia.estado: bloqueo del
// proceso, base del agente, disco presente por etiqueta+serie+marca) y da órdenes de la lista cerrada copia.*. No decide nada.
import { h } from './dom.js';
import { miniTarjeta } from './tarjeta.js';

const GB = 1 << 30;
const bytes = (n) => (n == null ? '—' : n >= GB ? `${(n / GB).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`
  : n >= 1 << 20 ? `${(n / (1 << 20)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB` : `${Math.round(n / 1024).toLocaleString('es-ES')} KB`);
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (n) => (n ?? 0).toLocaleString('es-ES');
const chip = (txt, tone) => h('span', { class: `a-chip t-${tone}` }, txt);
const ESTADO = {
  completada: ['Completada', 'ok'], completada_con_incidencias: ['Con incidencias', 'warn'], en_curso: ['En curso', 'work'],
  pausada: ['Pausada', 'idle'], cancelada: ['Cancelada', 'idle'], interrumpida: ['Interrumpida', 'warn'],
  esperando_disco: ['Esperando al disco', 'wait'], detenida: ['Detenida', 'bad'], error: ['Error', 'bad'],
  verificada: ['Verificada', 'ok'], verificacion_fallida: ['Verificación fallida', 'bad'],
  verificada_con_excepciones: ['Verificada (con excepciones del origen)', 'ok'],
};
const est = (s) => ESTADO[s] || [s, 'idle'];
const hecha = (st) => st?.ultima_completada
  || (() => { const r = st?.historial?.find((x) => x.tipo === 'copia' && x.estado === 'completada_con_incidencias'); return r ? { ts: r.fin, run: r.id } : null; })();

// CIFRAS DEL CONJUNTO (st.avance, calculadas por el motor con el índice; persisten aunque se cierre todo). Nunca se
// inventa un total ni un %: con estimación parcial el total es un mínimo («≥») y el % no se enseña.
const durTxt = (s) => (s == null ? '—' : s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
  : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const vel = (bs) => (bs == null ? '—' : `${(bs / (1 << 20)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB/s`);
const cuando = (t) => (t ? new Date(t * 1000).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const mbs = (x) => (x != null ? `${x.toLocaleString('es-ES')} MB/s` : 'midiendo…');
function cifras(st) {
  const a = st?.avance;
  if (!a) return null;
  const tot = a.total;
  const ge = tot?.minimo ? '≈ ' : '';
  const hechos = a.hechos || a.confirmados;
  const inc = a.incidencias || {};
  const v = a.velocidad || {};
  const corriendo = st.en_curso;
  const vf = corriendo ? a.verificacion : null;
  if (vf) {
    return {
      archivos: `${num(vf.archivos)} archivos verificados de ${num(vf.de_archivos)} copiados`,
      bytes: `${bytes(vf.bytes)} verificados de ${bytes(vf.de_bytes)}`,
      pct: vf.pct != null ? `${vf.pct.toLocaleString('es-ES')} % verificado` : '% —',
      vel: `${mbs(v.actual_mb_s)} (media ${vel(v.media_sesion_b_s)})`,
      eta: vf.eta_s ? `≈ ${durTxt(vf.eta_s)} restantes al ritmo medio` : 'tiempo restante: midiendo el ritmo',
      errores: `${num(vf.mal)} archivos que no coinciden · ${num(inc.fallidos)} fallidos de la copia · ${num(inc.omitidos)} omitidos`,
    };
  }
  return {
    archivos: `${num(hechos.archivos)} archivos completados de ${tot ? ge + num(tot.archivos) : '? (recuento pendiente)'}`,
    bytes: `${bytes(hechos.bytes)} respaldados de ${tot ? ge + bytes(tot.bytes) : '?'}`,
    pct: a.pct != null ? `${a.pct.toLocaleString('es-ES')} %` : tot?.minimo ? '% sin total exacto' : '% pendiente de recuento',
    vel: corriendo ? mbs(v.actual_mb_s) : a.copia?.media_b_s ? `media última copia ${vel(a.copia.media_b_s)}` : 'sin copia',
    eta: corriendo ? (a.eta_s ? `≈ ${durTxt(a.eta_s)} restantes` : 'tiempo restante sin estimación fiable')
      : a.pendientes?.exacto && !a.pendientes.archivos ? 'nada pendiente' : 'restante: se calcula al copiar',
    errores: `${num(inc.fallidos)} fallidos · ${num(inc.omitidos)} omitidos · ${num(inc.reintento)} por reintentar`,
  };
}
const lineaCifras = (c) => (c ? [c.archivos, c.bytes, c.pct, c.vel, c.eta, c.errores].join(' — ') : '');

export function copiaUi({ cmd, toast, ask }) {
  let st = null;
  let err = '';
  let dlg = null;
  let timer = null;
  let busy = false;
  const wrap = h('div', { class: 'cp-wrap' });

  async function refresh() {
    const r = await cmd('copia.estado', {});
    if (r?.ok) { st = r.data; err = ''; } else err = r?.error || 'Sin respuesta del motor de copia';
    // Página nueva servida por un servidor aún sin reiniciar: lo dice tal cual (no es un fallo del agente).
    if (/Orden desconocida: copia\./.test(err)) err = 'Instalado: se activa en el próximo reinicio de CEOPadre';
    paintMini();
    // no se repinta mientras escribes en la ficha (perderías el texto y el foco)
    const typing = document.activeElement?.tagName === 'INPUT' && dlg?.contains(document.activeElement);
    if (dlg?.open && !typing) paintPanel();
  }
  // secciones plegables: siguen abiertas o cerradas aunque la ficha se repinte cada segundo y medio
  const abiertos = new Set(['incidencias']);
  const fold = (key, summary, ...body) => {
    const d = h('details', { class: 'fold', open: abiertos.has(key) }, h('summary', {}, summary), ...body);
    d.addEventListener('toggle', () => { if (d.open) abiertos.add(key); else abiertos.delete(key); });
    return d;
  };
  // Sólo se consulta al motor mientras la tarjeta o la ficha están a la vista (cada consulta lanza un proceso corto).
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (!dlg?.open && !wrap.isConnected) return;
      await refresh().catch(() => {});
      poll();
    }, dlg?.open ? 1500 : 6000);
  }

  // ---------------------------------------------------------------- resumen (una línea de verdad)
  function resumen() {
    if (!st && err.startsWith('Instalado')) return [['Pendiente de reinicio', 'idle'], err];
    if (!st) return [[err ? 'Sin respuesta' : 'Consultando…', err ? 'bad' : 'idle'], err || 'Leyendo el estado del agente'];
    const last = st.historial?.find((r) => r.tipo === 'copia');
    if (st.borrado_pendiente && !st.en_curso) return [['Necesita tu confirmación', 'ask'], 'Detenida por seguridad: iba a apartar muchos elementos como eliminados. Ábrela y revisa.'];
    if (st.en_curso) {
      const p = st.progreso || {};
      const r = p.regulador || {};
      const ahora = Date.now() / 1000;
      const cola = `${bytes(p.bytes_sesion)} transferidos · ${num(st.pendientes?.carpetas)} carpetas pendientes`;
      // «Trabajando» sólo con avance real reciente (bytes o carpetas terminadas); si no, se dice lo que hay
      if (p.hb && ahora - p.hb > 60) return [['Sin señales del proceso', 'warn'], `Última señal ${fecha(new Date(p.hb * 1000).toISOString())} · ${p.fase || ''}`];
      if (!p.avance) return [['Preparando', 'work'], `${p.fase || 'arrancando'} · aún sin archivos copiados`];
      if (ahora - p.avance > 60) return [['Sin avance', 'warn'], `En curso, sin avance desde ${fecha(new Date(p.avance * 1000).toISOString())} · ${p.fase || ''}`];
      if (r.reduciendo) return [['Trabajando con recursos limitados', 'work'], `${r.motivo || 'cediendo recursos'} · ${cola}`];
      return [['Trabajando', 'work'], `${p.fase || 'copiando'} · ${cola}`];
    }
    if (st.autorizada && !st.disco) return [['Esperando al disco', 'wait'], 'Conecta «Tocho Disco Duro»: la copia autorizada continuará sola'];
    if (st.pausada) return [['Pausada', 'idle'], 'Pulsa Continuar para seguir donde quedó'];
    if (last && ['interrumpida', 'error', 'detenida'].includes(last.estado)) return [est(last.estado), last.nota || ''];
    const uc = hecha(st);
    if (!uc) return [['Sin primera copia', 'ask'], st.disco ? 'Disco conectado: lista para la primera copia' : 'Conecta el disco y pulsa «Hacer copia»'];
    const v = st.ultima_verificacion;
    // completada ≠ verificada: una verificación anterior a la última copia no cubre lo copiado después
    const vieja = v && new Date(v.ts) < new Date(uc.ts);
    const verif = !v ? ' · sin verificar' : v.mal ? ' · última verificación FALLIDA' : vieja ? ' · lo último aún sin verificar' : ` · verificada ${fecha(v.ts)}`;
    return [last?.estado === 'completada_con_incidencias' ? est(last.estado) : v?.mal ? ['Verificación fallida', 'bad'] : ['Al día', 'ok'],
      `Última copia completada ${fecha(uc.ts)}${verif} · ${num(st.pendientes?.carpetas)} carpetas con cambios`];
  }

  function paintMini() {
    const [estado, txt] = resumen();
    const c = cifras(st);
    const sinCopia = (st?.adicionales || []).filter((x) => x.error || x.ultima?.estado !== 'completada').map((x) => x.nombre);
    const ver = st?.veredicto;
    const exc = ver?.excepciones?.length ? ` · ${ver.excepciones.length} excepción(es) del origen` : '';
    const veredictoTxt = !ver || st.en_curso ? '' : ver.completa ? ` · COPIA COMPLETA Y VERIFICADA (punto de restauración ${fecha(ver.punto)})${exc}`
      : ` · NO completa: falta ${ver.faltas.map((f) => f.que).join(', ')}${exc}`;
    const desc = (c ? `${txt} · ${lineaCifras(c)}` : txt) + (sinCopia.length ? ` · sin copia completa: ${sinCopia.join(', ')}` : '') + veredictoTxt;
    const accion = st?.en_curso ? { txt: 'Ver progreso', on: abrir }
      : st?.borrado_pendiente ? { txt: 'Revisar', cls: 'primary', on: abrir }
      : st?.pausada ? { txt: 'Continuar', cls: 'primary', on: (b) => orden('copia.continuar', 'Continuando', b) }
        : { txt: 'Hacer copia', cls: 'primary', disabled: busy || !st, on: (b) => orden('copia.hacer', 'Copia autorizada', b) };
    wrap.replaceChildren(miniTarjeta({ id: 'copia-ecoapp', titulo: 'Copia de seguridad ECOAPP', sub: 'Sistema · disco externo', clase: 'cp-mini',
      desc, estado, accion, abrir }));
  }

  async function orden(op, okMsg, btn, params = {}) {
    if (busy) return null;
    busy = true;
    if (btn) btn.disabled = true;
    try {
      const r = await cmd(op, params);
      if (!r?.ok) {
        // función nueva en la página pero el servidor aún no se ha reiniciado: se dice tal cual
        toast(/Orden desconocida: copia\./.test(r?.error || '') ? 'Disponible tras el próximo reinicio de CEOPadre' : r?.error || 'No se pudo', 'bad');
        return null;
      }
      if (okMsg) toast(okMsg, 'ok');
      if (r.data?.historial) st = r.data;
      return r.data;
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
      await refresh().catch(() => {});
      poll();
    }
  }

  // ---------------------------------------------------------------- ficha
  function abrir() {
    if (!dlg) {
      dlg = h('dialog', { class: 'alq-doc cp-dlg', 'aria-label': 'Copia de seguridad ECOAPP' });
      dlg.addEventListener('close', () => poll());
      document.body.append(dlg);
    }
    paintPanel();
    if (!dlg.open) dlg.showModal();
    refresh().catch(() => {});
    poll();
  }

  const fila = (k, v) => h('div', { class: 'cp-row' }, h('span', { class: 'muted' }, k), h('span', {}, v));

  function progreso() {
    const p = st.progreso || {};
    const secs = Math.max(1, Date.now() / 1000 - (p.inicio || Date.now() / 1000));
    const pct = p.total_archivo ? Math.min(100, Math.round((100 * (p.hecho_archivo || 0)) / p.total_archivo)) : null;
    const run = st.historial?.[0] || {};
    if (run.tipo === 'verificacion') {
      return h('section', { class: 'cp-box t-work' }, h('h3', {}, 'Verificación en curso'),
        fila('Archivo', p.archivo || '—'),
        fila('Datos leídos y comparados', bytes(p.bytes_sesion)),
        fila('Velocidad media', `${bytes((p.bytes_sesion || 0) / secs)}/s`),
        h('p', { class: 'muted' }, 'Relee cada archivo de la copia y lo compara con su huella; después comprueba SQLite y restaura cada PGlite en una copia temporal.'));
    }
    return h('section', { class: 'cp-box t-work' }, h('h3', {}, 'Progreso real'),
      fila('Fase', p.fase || '—'),
      fila('Archivo', p.archivo || '—'),
      pct != null ? h('progress', { max: 100, value: pct, 'aria-label': `Archivo actual ${pct} %` }) : null,
      fila('Archivos copiados (esta copia)', num(run.archivos)),
      fila('Datos transferidos (esta sesión)', bytes(p.bytes_sesion)),
      fila('Velocidad media', `${bytes((p.bytes_sesion || 0) / secs)}/s`),
      fila('Tiempo estimado', p.eta_s ? `≈ ${dur(p.eta_s)}` : 'sin estimación fiable todavía (hace falta saber lo pendiente y 1 min de ritmo estable)'),
      fila('Movidos sin copiar · versiones', `${num(run.movidos)} · ${num(run.versiones)}`),
      fila('Carpetas pendientes', num(st.pendientes?.carpetas)));
  }

  function paintPanel() {
    if (!dlg) return;
    if (!st) { dlg.replaceChildren(...[h('h2', {}, 'Copia de seguridad ECOAPP'), h('p', {}, err || 'Consultando…'), cerrarBtn(), dlg.querySelector('#toast')].filter(Boolean)); return; }
    const d = st.disco;
    const j = st.diario || {};
    const e = st.pendientes?.estimacion;
    const last = st.historial?.[0];
    const corriendo = st.en_curso;
    const vCortada = !corriendo && last?.tipo === 'verificacion' && ['interrumpida', 'en_curso'].includes(last.estado) ? last : null;
    const aviso = dlg.querySelector('#toast'); // el aviso de CEOPadre vive dentro del diálogo abierto: se conserva
    dlg.replaceChildren(...[
      h('h2', {}, 'Copia de seguridad ECOAPP'),
      h('p', { class: 'muted' }, `${st.origen} → ${st.destino}`),
      h('section', { class: `cp-box t-${d ? 'ok' : 'wait'}` }, h('h3', {}, 'Disco externo'),
        d ? [fila('Estado', [chip(d.vinculado ? 'Conectado y vinculado' : 'Conectado (se vinculará en la primera copia)', 'ok')]),
          fila('Unidad', `${d.letra}: · ${d.etiqueta} · serie ${Number(d.serie).toString(16).toUpperCase()}`),
          fila('Espacio libre', `${bytes(d.libre)} de ${bytes(d.total)}`),
          diag(d)]
          : fila('Estado', [chip('No conectado', 'wait'), ' Se identifica por etiqueta, número de serie y marca de vinculación, nunca sólo por la letra.']),
        ...(st.discos_rechazados || []).filter((x) => x.etiqueta).map((x) => fila(`Rechazado ${x.letra}:`, [chip('No es el disco vinculado', 'bad'), ` «${x.etiqueta}»: ${x.motivo}. No se escribe nada en él.`]))),
      st.borrado_pendiente ? h('section', { class: 'cp-box t-warn' }, h('h3', {}, 'Detenida por seguridad: necesita tu confirmación'),
        h('p', {}, st.borrado_pendiente.motivo || ''),
        h('p', { class: 'muted' }, 'Nada se ha borrado: lo eliminado sólo se aparta a _versiones. Comprueba que E:\\ECOAPP está bien antes de confirmar; la confirmación vale para UNA copia.'),
        h('div', { class: 'row cp-btns' },
          h('button', { class: 'btn ghost small', type: 'button', disabled: !d?.vinculado, onclick: () => orden('copia.abrir', null, null, { que: 'actual' }) }, 'Revisar la copia'),
          h('button', { class: 'btn small', type: 'button', disabled: busy, onclick: async (ev) => {
            if (await ask({ title: 'Confirmar los borrados', ok: 'Sí, el origen está bien: aplicar', danger: true, help: 'Sólo si los borrados son intencionados. Lo eliminado irá a _versiones (recuperable).' }))
              await orden('copia.confirmar_borrado', 'Confirmado: la copia continúa', ev.currentTarget);
          } }, 'Confirmar borrados'))) : null,
      h('section', { class: `cp-box t-${j.activo ? 'ok' : 'warn'}` }, h('h3', {}, 'Detección de cambios'),
        j.activo ? fila(`Diario USN de ${st.origen.slice(0, 2)}`, [chip('Activo', 'ok'), ` · última lectura ${fecha(j.ultima_ingesta)}`])
          : [fila(`Diario USN de ${st.origen.slice(0, 2)}`, chip('No activo', 'warn')),
            h('p', {}, 'Sin el diario de cambios de Windows cada copia revisa todas las carpetas (lento con 2 millones de archivos). Activarlo es una sola vez y pide permiso de administrador.'),
            h('button', { class: 'btn small', type: 'button', onclick: async (ev) => {
              const ok = await ask({ title: `Activar el diario de cambios de ${st.origen.slice(0, 2)}`, ok: 'Activar', help: 'Windows mostrará su ventana de permiso de administrador. Sólo ejecuta «fsutil usn createjournal» en ese disco (2 GB máximo); no cambia ningún archivo.' });
              if (ok) await orden('copia.activar_diario', 'Acepta la ventana de Windows para activarlo', ev.currentTarget);
            } }, 'Activar diario de cambios')],
        j.uso ? fila('Actividad medida', [`${j.uso.mb_dia} MB/día · el diario (${bytes(j.maximo)}) cubre ${j.uso.dias_de_margen ?? '—'} días`,
          j.uso.aviso ? chip('Diario pequeño para esta actividad', 'warn') : '']) : null,
        j.ultima_completa ? fila('Última revisión completa', `${fecha(j.ultima_completa.ts)} · ${j.ultima_completa.motivo}`) : null),
      veredicto(),
      conjunto(),
      adicionales(),
      rendimiento(corriendo),
      corriendo ? progreso() : null,
      h('section', { class: 'cp-box' }, h('h3', {}, 'Situación'),
        fila('Última copia completada', hecha(st) ? `${fecha(hecha(st).ts)}${st.ultima_completada ? '' : ' (con incidencias)'}` : 'Ninguna todavía'),
        fila('Último resultado', last ? [chip(...est(last.estado)), ` ${last.nota || ''}`] : '—'),
        fila('Última verificación íntegra', st.ultima_verificacion ? [chip(st.ultima_verificacion.mal ? 'Verificación fallida' : 'Verificada', st.ultima_verificacion.mal ? 'bad' : 'ok'),
          hecha(st) && new Date(st.ultima_verificacion.ts) < new Date(hecha(st).ts) ? chip('anterior a la última copia', 'warn') : '',
          ` ${fecha(st.ultima_verificacion.ts)} · ${num(st.ultima_verificacion.ok)} bien, ${num(st.ultima_verificacion.mal)} mal${st.ultima_verificacion.nota ? ` · ${st.ultima_verificacion.nota}` : ''}`] : 'Nunca (completada ≠ verificada)'),
        fila('Pendiente', `${num(st.pendientes?.carpetas)} carpetas con cambios${e?.archivos && st.pendientes?.carpetas ? ` · ≈ ${num(e.archivos)} archivos, ${bytes(e.bytes)}${e.completo ? '' : ' (parcial)'}` : ''}`),
        fila('Versiones guardadas', `${num(st.versiones?.n)} · ${bytes(st.versiones?.bytes)}`),
        st.indice_reconstruido ? fila('Índice', `reconstruido ${fecha(st.indice_reconstruido.ts)} (el anterior estaba dañado y se conserva aparte)`) : null,
        fila('Autorizada', st.autorizada ? (st.pausada ? 'Sí · en pausa' : 'Sí: se reanuda sola tras un corte o al reconectar el disco') : 'No')),
      h('div', { class: 'row cp-btns' },
        h('button', { class: 'btn primary', type: 'button', disabled: corriendo || busy, onclick: (ev) => orden('copia.hacer', d ? 'Copia en marcha' : 'Autorizada: empezará al conectar el disco', ev.currentTarget) }, 'Hacer copia'),
        h('button', { class: 'btn', type: 'button', disabled: !corriendo || busy, onclick: (ev) => orden('copia.pausar', 'Pausando en un punto seguro…', ev.currentTarget) }, 'Pausar'),
        h('button', { class: 'btn', type: 'button', disabled: corriendo || !st.pausada || busy, onclick: (ev) => orden('copia.continuar', 'Continuando', ev.currentTarget) }, 'Continuar'),
        h('button', { class: 'btn', type: 'button', disabled: (!corriendo && !st.autorizada) || busy, onclick: async (ev) => {
          if (await ask({ title: 'Cancelar la copia', ok: 'Cancelar la copia', help: 'Se detiene en un punto seguro. Lo ya copiado sigue siendo válido y la próxima copia continúa desde ahí.' }))
            await orden('copia.cancelar', 'Cancelando en un punto seguro…', ev.currentTarget);
        } }, 'Cancelar de forma segura'),
        h('button', { class: 'btn', type: 'button', disabled: corriendo || !d?.vinculado || busy, onclick: (ev) => orden('copia.verificar', 'Verificación íntegra en marcha', ev.currentTarget) }, vCortada ? `Continuar verificación #${vCortada.id}` : 'Verificar copia')),
      bases(),
      recuperar(d),
      st.incidencias?.length ? fold('incidencias', `Errores e incidencias abiertas · ${st.incidencias.length}`,
        h('ul', { class: 'cp-list' }, st.incidencias.map((x) => h('li', {}, chip(x.tipo, x.tipo.startsWith('copiado') || x.tipo === 'sqlite_en_bruto' ? 'warn' : 'bad'), ` ${x.ruta} — ${x.detalle}`)))) : null,
      fold('historial', 'Ver historial',
        h('ul', { class: 'cp-list' }, (st.historial || []).map((r) => h('li', {}, chip(...est(r.estado)),
          ` #${r.id} ${r.tipo} · ${fecha(r.inicio)}${r.fin ? ` → ${fecha(r.fin)}` : ''} · ${r.modo || ''} · ${num(r.archivos)} archivos, ${bytes(r.bytes)}, ${num(r.movidos)} movidos, ${num(r.versiones)} versiones, ${num(r.adoptados)} ya presentes, ${num(r.listadas)} carpetas leídas${r.arranques > 1 ? ` · ${r.arranques} arranques` : ''}${r.tipo === 'verificacion' ? ` · ${num(r.verif_ok)} bien / ${num(r.verif_mal)} mal` : ''}${r.nota ? ` · ${r.nota}` : ''}`)))),
      cerrarBtn(), aviso].filter(Boolean)); // replaceChildren pinta «null» si se le pasa
  }

  // VEREDICTO: una sola respuesta inequívoca, calculada por el motor con hechos guardados (nunca con suposiciones).
  function veredicto() {
    const v = st.veredicto;
    if (!v) return null;
    const i = v.integridad || {};
    const r = v.restaurable || {};
    const exc = v.excepciones || [];
    const titulo = v.completa ? (exc.length ? `Copia completa y verificada · ${exc.length} excepción(es) del origen` : 'Copia completa y verificada')
      : `La copia NO está completa y verificada · falta${v.faltas.length > 1 ? 'n' : ''} ${v.faltas.length}`;
    return h('section', { class: `cp-box t-${v.completa ? 'ok' : 'warn'}`, 'aria-live': 'polite' }, h('h3', {}, titulo),
      v.completa ? h('p', {}, h('strong', {}, `Punto de restauración: ${fecha(v.punto)} · verificada ${fecha(v.verificada_ts)}`)) : null,
      // integridad (los bytes del USB) y restaurabilidad (las bases se abren) son preguntas distintas: se contestan por separado
      fila('Integridad de lo respaldado', [chip(i.ok ? 'Íntegro' : 'Sin confirmar', i.ok ? 'ok' : 'warn'),
        ` ${num(i.verificados)} de ${num(i.confirmados)} archivos releídos del USB y coinciden (${bytes(i.bytes_verificados)} de ${bytes(i.bytes)})${i.problemas_abiertos ? ` · ${num(i.problemas_abiertos)} problema(s) de la copia abiertos` : ''}`]),
      fila('Restaurabilidad funcional', [chip(r.ok ? 'Probada' : r.pglite_ok + r.excepciones === r.pglite && r.criticas_ok === r.criticas ? 'Probada salvo excepciones' : 'Sin confirmar', r.ok ? 'ok' : 'warn'),
        ` PGlite ${num(r.pglite_ok)} de ${num(r.pglite)} restauradas · bases críticas ${num(r.criticas_ok)} de ${num(r.criticas)} restauradas aparte y abiertas${exc.length ? ` · ${exc.length} excepción(es)` : ''}`]),
      v.faltas.length ? h('div', {}, h('h4', {}, 'Qué falta'),
        h('ul', { class: 'cp-list' }, v.faltas.map((f) => h('li', {}, h('strong', {}, `${f.que}: `), f.por_que, ' ', h('em', {}, f.accion))))) : null,
      exc.length ? h('div', {}, h('h4', {}, 'Excepciones (no son fallos de la copia; no desaparecen hasta que se resuelvan en el origen)'),
        h('ul', { class: 'cp-list' }, exc.map((x) => h('li', {}, chip(x.tipo, 'warn'), ' ', h('strong', {}, `${x.que}: `), x.por_que, ' ', h('em', {}, x.accion))))) : null,
      v.info.length ? h('ul', { class: 'cp-list' }, v.info.map((x) => h('li', { class: 'muted' }, x))) : null);
  }

  // PROGRESO DEL CONJUNTO: siempre a la vista (también con la copia parada), con lo guardado por el motor.
  function conjunto() {
    const a = st.avance;
    if (!a) return null;
    const c = cifras(st);
    const p = a.pendientes || {};
    const inc = a.incidencias || {};
    const u = a.ultimo || {};
    const cp = a.copia;
    const v = a.velocidad || {};
    const ahora = Date.now() / 1000;
    const ge = a.total?.minimo ? '≈ ' : '';
    const parcial = p.exacto ? '' : ` (estimación parcial${p.evaluadas != null ? `: ${num(p.evaluadas)} de ${num(p.carpetas)} carpetas con cambios evaluadas` : ''}; el resto se cuenta al copiarlas)`;
    const finRun = cp && st.historial?.find((r) => r.id === cp.id)?.fin;
    const actividad = u.actividad_ts || u.fin_ts || (finRun ? new Date(finRun).getTime() / 1000 : null);
    const proceso = st.en_curso
      ? (u.senal_ts && ahora - u.senal_ts > 60 ? [chip('Sin señales', 'warn'), ` desde ${cuando(u.senal_ts)} · pid ${u.pid ?? '—'}`]
        : [chip('Trabajando', 'work'), ` pid ${u.pid ?? '—'} · ${u.fase || ''}`])
      : [chip('Parado', 'idle'), cp ? ` no hay proceso de copia · copia #${cp.id}: ${est(cp.estado)[0].toLowerCase()}${finRun ? ` el ${fecha(finRun)}` : ''}` : ' no hay proceso de copia'];
    return h('section', { class: `cp-box t-${st.en_curso ? 'work' : a.pct === 100 ? 'ok' : 'idle'}` }, h('h3', {}, 'Progreso del conjunto'),
      h('p', {}, h('strong', {}, lineaCifras(c))),
      a.verificacion && st.en_curso ? h('progress', { max: 100, value: a.verificacion.pct || 0, 'aria-label': `Verificado ${a.verificacion.pct} %` })
        : a.pct != null ? h('progress', { max: 100, value: a.pct, 'aria-label': `Progreso del conjunto ${a.pct} %` }) : null,
      a.verificacion && st.en_curso ? fila('Verificación en curso', `#${a.verificacion.id}: ${num(a.verificacion.archivos)} de ${num(a.verificacion.de_archivos)} archivos · ${bytes(a.verificacion.bytes)} de ${bytes(a.verificacion.de_bytes)} · ${num(a.verificacion.mal)} no coinciden · recuento ${fecha(a.verificacion.recuento_ts)}`) : null,
      a.carpetas_sesion && st.en_curso ? fila('Carpetas revisadas (esta sesión)', `${num(a.carpetas_sesion.hechas)} de ${num(a.carpetas_sesion.total)}`) : null,
      fila('Total de archivos del origen', a.total ? `${ge}${num(a.total.archivos)}${a.total.minimo ? ' (aproximado: aún no se han evaluado todas las carpetas con cambios)' : ''}` : 'Recuento pendiente: se sabrá con la próxima estimación o al terminar la indexación'),
      fila('Archivos copiados y confirmados', `${num(a.confirmados.archivos)} (temporal con fsync, huella BLAKE2b y publicación anotada) · recuento ${fecha(a.recuento_ts)}`),
      fila('Verificados íntegramente', `${num(a.verificados.archivos)} · ${bytes(a.verificados.bytes)}${a.confirmados.archivos > a.verificados.archivos ? ` · ${num(a.confirmados.archivos - a.verificados.archivos)} pendientes de verificación («Verificar copia»)` : ''}`),
      st.en_curso && u.escribiendo ? fila('Escribiéndose ahora (sin confirmar)', `${num(u.escribiendo)} archivo(s) en temporal`) : null,
      fila('Archivos pendientes', `${p.exacto ? '' : '≥ '}${num(p.archivos)} en ${num(p.carpetas)} carpetas${parcial}`),
      fila('Tamaño total a respaldar', a.total ? `${ge}${bytes(a.total.bytes)}` : 'Recuento pendiente'),
      fila('Respaldado correctamente', bytes(a.confirmados.bytes)),
      fila('Pendiente', `${p.exacto ? '' : '≥ '}${bytes(p.bytes)}`),
      fila('Porcentaje real', a.pct != null ? `${a.pct.toLocaleString('es-ES')} %` : 'No se enseña sin un total exacto (no se inventa)'),
      fila('Velocidad', st.en_curso ? `ahora ${mbs(v.actual_mb_s)} · media de esta sesión ${vel(v.media_sesion_b_s)}${cp?.media_b_s ? ` · media de la copia ${vel(cp.media_b_s)}` : ''}`
        : cp?.media_b_s ? `media de la copia #${cp.id}: ${vel(cp.media_b_s)}${cp.media_incluye_cortes ? ' (incluye el tiempo entre cortes)' : ''}` : '—'),
      fila('Tiempo transcurrido', cp ? `${durTxt(cp.transcurrido_s)}${cp.trabajando_s ? ` · trabajando ${durTxt(cp.trabajando_s)}` : ''}` : '—'),
      fila('Tiempo restante', st.en_curso ? (a.eta_s ? `≈ ${durTxt(a.eta_s)}` : 'sin estimación fiable todavía (hace falta saber lo pendiente y 1 min de ritmo estable)') : c.eta),
      fila('Errores', `${num(inc.fallidos)} fallidos · ${num(inc.omitidos)} omitidos (${num(inc.enlaces)} enlaces que no se siguen, ${num(inc.no_locales)} sólo en la nube) · ${num(inc.reintento)} pendientes de reintento (se reintentan solos en cada copia) · ${num(inc.avisos)} avisos`),
      fold('leyenda', 'Qué significa cada cifra',
        h('ul', { class: 'cp-list' },
          h('li', {}, h('strong', {}, 'Copiado y confirmado: '), 'está en el disco USB, escrito con fsync, con su huella anotada y publicado con un renombrado atómico. Es la copia válida.'),
          h('li', {}, h('strong', {}, 'Verificado: '), 'además se ha releído del USB y coincide con su huella (SQLite: quick_check; PGlite: restauración real). Sólo lo hace «Verificar copia».'),
          h('li', {}, h('strong', {}, 'Omitido: '), 'no se copia a propósito: enlaces y uniones (no se siguen: su contenido se copia en su sitio real si está dentro del origen) y archivos sólo en la nube. Lo de fuera del origen va en «Datos fuera de E:\\ECOAPP».'),
          h('li', {}, h('strong', {}, 'Fallido: '), 'se intentó y no se pudo (bloqueado, sin permiso, antivirus…). Su carpeta queda pendiente y se reintenta sola en cada copia; nunca se da por copiado.'),
          h('li', {}, h('strong', {}, 'Pendiente: '), 'cambios en el origen aún no copiados (nuevos o modificados), sacados del diario de cambios de E:.'),
          h('li', {}, h('strong', {}, 'Excluido: '), 'fuera de la copia por decisión documentada (config «excluir»); no cuenta como fallo.'),
          h('li', {}, h('strong', {}, 'Excepción del origen: '), 'algo copiado fielmente que ya estaba dañado en el proyecto (p. ej. una base que tampoco abre en el origen). No es un fallo de la copia, pero siempre se enseña.'))),
      fila('Último archivo confirmado', u.archivo ? `${u.archivo} · ${cuando(u.archivo_ts)}` : 'No registrado (se guarda a partir de esta versión)'),
      fila('Última actividad real', cuando(actividad)),
      fila('Estado del proceso', proceso));
  }

  // ORÍGENES ADICIONALES: carpetas fuera de E:\ECOAPP que también se respaldan (p. ej. los datos de CEOPadre en el SSD).
  function adicionales() {
    const xs = st.adicionales || [];
    if (!xs.length) return null;
    return h('section', { class: 'cp-box' }, h('h3', {}, 'Datos fuera de E:\\ECOAPP'),
      h('p', { class: 'muted' }, 'Se copian en su propia carpeta del mismo disco al empezar cada copia y se verifican con «Verificar copia».'),
      ...xs.map((x) => {
        const a = x.avance || {};
        const u = x.ultima;
        const v = x.ultima_verificacion;
        const tono = x.error ? 'bad' : x.en_curso ? 'work' : !u ? 'ask' : u.estado === 'completada' ? 'ok' : 'warn';
        return h('div', { class: 'cp-sub' },
          fila(x.nombre, [chip(x.error ? 'Sin respuesta' : x.en_curso ? 'Copiando' : u ? est(u.estado)[0] : 'Aún sin copiar', tono), ` ${x.origen} → ${x.destino || '—'}`]),
          x.error ? fila('Error', x.error) : null,
          fila('Copiado y confirmado', a.confirmados ? `${num(a.confirmados.archivos)} archivos · ${bytes(a.confirmados.bytes)}${u?.fin ? ` · última copia ${fecha(u.fin)}` : ''}` : '—'),
          fila('Verificado', v ? `${fecha(v.ts)} · ${num(v.ok)} bien, ${num(v.mal)} mal` : 'Nunca'),
          (x.incidencias || []).length ? fila('Incidencias', x.incidencias.slice(0, 5).map((i) => `${i.tipo}: ${i.ruta}`).join(' · ')) : null);
      }));
  }

  // RENDIMIENTO: el modo se elige aquí (también en plena copia); lo demás es lo que MIDE el regulador del motor.
  const MODOS = [
    ['inteligente', 'Inteligente', 'Mide la respuesta del disco E:, la CPU y la memoria cada 2 s: va rápido si el PC está libre y cede en cuanto otros trabajan.'],
    ['bajo', 'Bajo consumo', 'Para cuando hay varios CMD de Claude/Codex trabajando: 1 archivo a la vez, como mucho 10 MB/s, CPU y memoria con prioridad baja, y aún cede más si el disco o la CPU se cargan.'],
    ['maximo', 'Máxima velocidad', 'Para con el PC libre: sin límite de ritmo, prioridad normal y tantos hilos como el disco aguante (lo mide). Mismas comprobaciones de integridad.'],
  ];
  const EFECTIVO = { libre: ['A pleno ritmo: el PC está libre', 'ok'], limitado: ['Limitado para no molestar', 'work'], bajo_consumo: ['Bajo consumo', 'work'], maxima_velocidad: ['Máxima velocidad', 'ok'] };
  function rendimiento(corriendo) {
    const modo = st.modo || 'inteligente';
    const r = (corriendo && st.progreso?.regulador) || null;
    const sel = h('div', { class: 'cp-modos', role: 'radiogroup', 'aria-label': 'Modo de rendimiento' }, MODOS.map(([id, txt, ayuda]) =>
      h('button', { class: `btn small ${id === modo ? 'primary' : 'ghost'}`, type: 'button', role: 'radio', 'aria-checked': String(id === modo), title: ayuda,
        disabled: busy, onclick: (ev) => { if (id !== modo) orden('copia.modo', corriendo ? `${txt}: se aplica en un segundo` : `Modo ${txt}`, ev.currentTarget, { modo: id }); } }, txt)));
    const o = r?.origen;
    const dd = r?.destino;
    const pr = r?.procesos;
    return h('section', { class: 'cp-box' }, h('h3', {}, 'Rendimiento'),
      sel, h('p', { class: 'muted' }, MODOS.find((m) => m[0] === modo)?.[2] || ''),
      r ? [
        fila('Funcionando ahora', [chip(...(EFECTIVO[r.efectivo] || [r.efectivo, 'idle'])), r.motivo ? ` ${r.motivo}` : '']),
        fila('Velocidad actual', `${(r.caudal_mb_s ?? 0).toLocaleString('es-ES')} MB/s${r.limite_mb_s != null ? ` · tope ahora ${r.limite_mb_s.toLocaleString('es-ES')} MB/s` : ' · sin tope'}`),
        fila('Transferencias simultáneas', `${num(r.activos)} de ${num(r.hilos)} permitidas${r.en_espera ? ` (${num(r.en_espera)} esperando turno)` : ''}${r.prioridad_baja ? ' · CPU y memoria con prioridad baja' : ' · prioridad normal'}`),
        fila('CPU', r.cpu_total != null ? `${r.cpu_total} % en total · la copia ${r.cpu_copia ?? 0} %` : 'midiendo…'),
        fila('Memoria en uso', r.memoria != null ? `${r.memoria} %` : '—'),
        fila(`Disco de origen (${st.origen.slice(0, 2)})`, o ? `responde en ${o.lat_ms} ms · ${o.mb_s} MB/s · ${num(o.ops_s)} operaciones/s (de todos)` : 'sin medida'),
        fila('Disco externo', dd ? `responde en ${dd.lat_ms} ms · ${dd.mb_s} MB/s` : 'sin medida'),
        pr ? fila('Otros trabajos', `${num(pr['claude.exe'])} Claude · ${num(pr['codex.exe'])} Codex · ${num(pr['node.exe'])} node (informativo: se decide por lo medido)`) : null,
      ] : h('p', { class: 'muted' }, 'Las medidas aparecen mientras hay una copia o verificación en curso.'));
  }
  const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

  // COMPROBAR DISCO: resultado real de escribir, leer, renombrar, fechas y rutas largas en el propio disco.
  function diag(d) {
    const x = st.diagnostico_disco;
    const t = x?.pruebas || {};
    const btn = h('button', { class: 'btn ghost small', type: 'button', disabled: busy || st.en_curso, onclick: async (ev) => {
      const r = await orden('copia.diagnostico', null, ev.currentTarget);
      if (r) toast(r.ok ? 'Disco comprobado: todo correcto' : 'El disco tiene avisos: míralos en la ficha', r.ok ? 'ok' : 'bad');
    } }, x ? 'Volver a comprobar el disco' : 'Comprobar el disco');
    if (!x || x.serie !== Number(d.serie).toString(16).toUpperCase().padStart(8, '0')) return fila('Comprobación', [btn, ' escribe una prueba en _agente y la borra; no copia nada']);
    return [fila('Comprobación', [chip(x.ok ? 'Correcto' : 'Con avisos', x.ok ? 'ok' : 'bad'),
      ` ${fecha(x.ts)} · ${x.sistema_archivos} · escritura ${t.escritura_fsync_MB_s ?? '—'} MB/s · rutas largas ${t.ruta_larga ? 'sí' : 'no'} · fechas exactas ${t.fecha_precisa_100ns ? 'sí' : 'no'} `, btn]),
      ...(x.avisos || []).map((a) => fila('Aviso', a))];
  }

  // BASES DE DATOS: sólo se declara restaurable lo que superó una restauración funcional real en la verificación.
  function bases() {
    const b = st.bases || {};
    if (!b.sqlite && !(b.grupos || []).length) return null;
    return fold('bases', `Bases de datos · ${num(b.sqlite)} SQLite · ${(b.grupos || []).length} PGlite/Postgres`,
      h('p', { class: 'muted' }, 'SQLite: instantánea coherente (API de backup) y quick_check de la copia al verificar. PGlite: el datadir se copia entero y sólo vale si no cambió durante la copia; al verificar se abre una copia temporal con el PGlite del proyecto, se vuelca (dumpDataDir) y se recarga (loadDataDir).'),
      h('ul', { class: 'cp-list' }, (b.grupos || []).map((g) => {
        const r = b.pglite?.[g];
        const ok = b.grupos_coherentes?.[g];
        return h('li', {}, chip(r ? (r.ok ? 'Restauración probada' : 'Restauración FALLIDA') : 'Sin verificar', r ? (r.ok ? 'ok' : 'bad') : 'idle'), ` ${g}`,
          r?.ok ? ` · ${r.tablas} tablas, ${num(r.filas)} filas, volcado ${bytes(r.volcado_bytes)} (${fecha(r.ts)})` : r?.error ? ` · ${r.error}` : '',
          ok ? ` · copia coherente ${fecha(ok)}` : ' · aún sin copia coherente');
      })),
      h('h4', {}, 'Bases críticas: restauración aislada y apertura real en cada verificación'),
      h('ul', { class: 'cp-list' }, [[null, b.criticas_config, b.criticas], ...(st.adicionales || []).map((x) => [x.nombre, x.criticas_config, x.criticas])]
        .flatMap(([quien, rutas, res]) => (rutas || []).map((ruta) => {
          const r = (res || {})[ruta];
          const f = r?.funcional;
          return h('li', {}, chip(r ? (r.ok ? 'Restaurada y abierta' : 'Restauración FALLIDA') : 'Sin probar', r ? (r.ok ? 'ok' : 'bad') : 'idle'), ` ${quien ? `${quien} › ` : ''}${ruta}`,
            r?.ok ? ` · integrity_check ok · ${r.tablas} tablas, ${num(r.filas)} filas${f ? ` · CEOPadre la abre: ${num(f.proyectos)} proyectos, ${num(f.objetivos)} objetivos, ${num(f.rondas)} rondas` : ''} (${fecha(r.ts)})`
              : r?.error ? ` · ${r.error}` : ' · se prueba en la próxima verificación');
        }))));
  }

  // RECUPERAR: buscar por nombre en versiones (eliminados o sustituidos) y en la copia actual; se copia al Escritorio.
  let resultados = null;
  let q = '';
  function recuperar(d) {
    const input = h('input', { type: 'search', placeholder: 'Nombre o parte de la ruta', 'aria-label': 'Buscar archivo para recuperar', value: q });
    input.addEventListener('input', () => { q = input.value; });
    const buscar = async (ev) => {
      const data = await orden('copia.buscar', null, ev?.currentTarget, { texto: q });
      if (data) { resultados = data; paintPanel(); }
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); buscar(); } });
    const item = (label, tipo, id, extra) => h('li', {}, `${label} `, extra, ' ',
      h('button', { class: 'btn ghost small', type: 'button', disabled: !d?.vinculado, onclick: async (ev) => {
        const r = await orden('copia.recuperar', null, ev.currentTarget, { tipo, item: id });
        if (r) toast(`Recuperado en ${r.destino}`, 'ok');
      } }, 'Recuperar'));
    return fold('recuperar', 'Recuperar archivos',
      h('p', { class: 'muted' }, 'Se copia a Escritorio › Recuperado ECOAPP. Nunca sobrescribe ni escribe dentro de E:\\ECOAPP.'),
      h('div', { class: 'row' }, input, h('button', { class: 'btn small', type: 'button', onclick: buscar }, 'Buscar'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: !d?.vinculado, onclick: () => orden('copia.abrir', null, null, { que: 'actual' }) }, 'Abrir la copia'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: !d?.vinculado, onclick: () => orden('copia.abrir', null, null, { que: 'versiones' }) }, 'Abrir versiones')),
      resultados ? h('div', {},
        h('h4', {}, `Versiones anteriores y eliminados · ${resultados.versiones.length}`),
        h('ul', { class: 'cp-list' }, resultados.versiones.map((v) => item(v.ruta, 'version', v.id, h('span', { class: 'muted' }, `${v.motivo} · ${fecha(v.fecha)}${v.carpeta ? ' · carpeta' : ` · ${bytes(v.bytes)}`}`)))),
        h('h4', {}, `En la copia actual · ${resultados.actuales.length}`),
        h('ul', { class: 'cp-list' }, resultados.actuales.map((v) => item(v.ruta, 'actual', v.ruta, h('span', { class: 'muted' }, v.carpeta ? 'carpeta' : bytes(v.bytes)))))) : null);
  }

  const cerrarBtn = () => h('div', { class: 'row alq-doc-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => dlg.close() }, 'Cerrar'));

  paintMini();
  refresh().catch(() => {});
  poll();
  return { minis: () => { if (!timer) poll(); return [{ tono: resumen()[0][1] === 'wait' ? 'ask' : resumen()[0][1], texto: 'copia de seguridad ecoapp backup disco', el: wrap }]; }, abrir };
}
