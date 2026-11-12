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
};
const est = (s) => ESTADO[s] || [s, 'idle'];

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
      return [['Copiando', 'work'], `${p.fase || 'trabajando'} · ${bytes(p.bytes_sesion)} transferidos · ${num(st.pendientes?.carpetas)} carpetas pendientes`];
    }
    if (st.autorizada && !st.disco) return [['Esperando al disco', 'wait'], 'Conecta «Tocho Disco Duro»: la copia autorizada continuará sola'];
    if (st.pausada) return [['Pausada', 'idle'], 'Pulsa Continuar para seguir donde quedó'];
    if (last && ['interrumpida', 'error', 'detenida'].includes(last.estado)) return [est(last.estado), last.nota || ''];
    if (!st.ultima_completada) return [['Sin primera copia', 'ask'], st.disco ? 'Disco conectado: lista para la primera copia' : 'Conecta el disco y pulsa «Hacer copia»'];
    const v = st.ultima_verificacion;
    // completada ≠ verificada: una verificación anterior a la última copia no cubre lo copiado después
    const vieja = v && st.ultima_completada && new Date(v.ts) < new Date(st.ultima_completada.ts);
    const verif = !v ? ' · sin verificar' : v.mal ? ' · última verificación FALLIDA' : vieja ? ' · lo último aún sin verificar' : ` · verificada ${fecha(v.ts)}`;
    return [last?.estado === 'completada_con_incidencias' ? est(last.estado) : v?.mal ? ['Verificación fallida', 'bad'] : ['Al día', 'ok'],
      `Última copia completada ${fecha(st.ultima_completada.ts)}${verif} · ${num(st.pendientes?.carpetas)} carpetas con cambios`];
  }

  function paintMini() {
    const [estado, desc] = resumen();
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
      corriendo ? progreso() : null,
      h('section', { class: 'cp-box' }, h('h3', {}, 'Situación'),
        fila('Última copia completada', st.ultima_completada ? fecha(st.ultima_completada.ts) : 'Ninguna todavía'),
        fila('Último resultado', last ? [chip(...est(last.estado)), ` ${last.nota || ''}`] : '—'),
        fila('Última verificación íntegra', st.ultima_verificacion ? [chip(st.ultima_verificacion.mal ? 'Verificación fallida' : 'Verificada', st.ultima_verificacion.mal ? 'bad' : 'ok'),
          st.ultima_completada && new Date(st.ultima_verificacion.ts) < new Date(st.ultima_completada.ts) ? chip('anterior a la última copia', 'warn') : '',
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
        h('button', { class: 'btn', type: 'button', disabled: corriendo || !d?.vinculado || busy, onclick: (ev) => orden('copia.verificar', 'Verificación íntegra en marcha', ev.currentTarget) }, 'Verificar copia')),
      bases(),
      recuperar(d),
      st.incidencias?.length ? fold('incidencias', `Errores e incidencias abiertas · ${st.incidencias.length}`,
        h('ul', { class: 'cp-list' }, st.incidencias.map((x) => h('li', {}, chip(x.tipo, x.tipo.startsWith('copiado') || x.tipo === 'sqlite_en_bruto' ? 'warn' : 'bad'), ` ${x.ruta} — ${x.detalle}`)))) : null,
      fold('historial', 'Ver historial',
        h('ul', { class: 'cp-list' }, (st.historial || []).map((r) => h('li', {}, chip(...est(r.estado)),
          ` #${r.id} ${r.tipo} · ${fecha(r.inicio)}${r.fin ? ` → ${fecha(r.fin)}` : ''} · ${r.modo || ''} · ${num(r.archivos)} archivos, ${bytes(r.bytes)}, ${num(r.movidos)} movidos, ${num(r.versiones)} versiones, ${num(r.adoptados)} ya presentes, ${num(r.listadas)} carpetas leídas${r.arranques > 1 ? ` · ${r.arranques} arranques` : ''}${r.tipo === 'verificacion' ? ` · ${num(r.verif_ok)} bien / ${num(r.verif_mal)} mal` : ''}${r.nota ? ` · ${r.nota}` : ''}`)))),
      cerrarBtn(), aviso].filter(Boolean)); // replaceChildren pinta «null» si se le pasa
  }

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
      })));
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
