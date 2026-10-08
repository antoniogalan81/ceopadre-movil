// MANDO REMOTO en el móvil y en el PC (contrato ceopadre-remote/1): pinta la foto que el PC sube de cada proyecto (VideoFactory…)
// y deja órdenes de SU lista cerrada. No conoce VideoFactory: dibuja bloques tipados (texto, storyboard, vídeo, textos
// para copiar, descarga…) y acciones con sus parámetros y su confirmación. Todo el texto entra como texto (nunca HTML).
import { h } from './dom.js';

const FILTER_KEY = (id) => `ceo-remote-filter:${id}`;
const TONES = { you: 'ask', ready: 'ok', busy: 'work', done: 'idle', bad: 'bad' };
// Lo que llega en la foto es dato, no código: sólo enlaces https, colores #hex y números acotados.
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null);
const hexColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : 'var(--idle)');
const MB = (b) => `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`;
// Fecha del contenido (hora local del PC, tal cual la escribe el proyecto: «2026-10-07T21:16:22»).
const fecha = (iso) => { const d = new Date(String(iso || '')); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); };
// Dirección directa (favoritos): #videofactory y #videofactory/<contenido>. El nombre del proyecto, sin acentos ni signos.
export const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const TAB_MAIN = 'Pendientes';

export function remoteUi({ api, ask, toast, show, data, ago, local = false }) {
  let openId = null, openItem = null, urls = new Map(); // objeto del bucket → { url, hasta }
  let tab = TAB_MAIN, pendingRoute = location.hash; // una dirección directa espera a la primera foto
  const remotos = () => data().remotos || [];
  const cur = () => remotos().find((r) => r.id === openId);
  const online = () => data().pc.online;

  // ------------------------------------------------------------ filtro de canales (varios a la vez, recordado)
  const loadSel = (id) => { try { const v = JSON.parse(localStorage.getItem(FILTER_KEY(id)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const saveSel = (id, v) => { try { localStorage.setItem(FILTER_KEY(id), JSON.stringify(v)); } catch { /* sin almacenamiento: dura esta visita */ } };
  function selection(r) {
    const opts = r.datos.filters?.options || [];
    const sel = loadSel(r.id).filter((x) => opts.some((o) => o.id === x));
    return sel.length >= opts.length ? [] : sel; // todos marcados = «Todos»
  }
  const visible = (r, it) => { const s = selection(r); return !s.length || s.includes(it.filter); };

  // ------------------------------------------------------------ enlaces firmados (privados, caducan en 1 h)
  async function signed(objects) {
    const need = objects.filter((o) => !(urls.get(o)?.hasta > Date.now() + 60_000));
    if (need.length) {
      const r = await api.sb.storage.from('ceo-media').createSignedUrls(need, 3600);
      if (r.error) throw new Error(r.error.message);
      for (const x of r.data || []) if (x.signedUrl) urls.set(x.path, { url: x.signedUrl, hasta: Date.now() + 3600_000 });
    }
    return objects.map((o) => urls.get(o)?.url || null);
  }
  // Un archivo `local_only` (sólo el panel del PC) no está en el bucket: en el móvil, como si no existiera.
  const media = (r, key) => { const m = key && r.datos.media?.[key]; return m && (local || m.objects?.length) ? m : null; };
  // En el PC, el propio CEOPadre sirve el archivo por su clave; en el móvil, un enlace firmado del bucket privado.
  const localUrl = (r, key) => `/media/${encodeURIComponent(r.id)}/${encodeURIComponent(key)}`;
  const urlOf = async (r, key) => (local ? localUrl(r, key) : (await signed([media(r, key).objects[0]]))[0]);
  function img(r, key, cls) {
    const m = media(r, key);
    const el = h('img', { class: cls, alt: '', loading: 'lazy', decoding: 'async' });
    if (m) urlOf(r, key).then((u) => { if (u) el.src = u; }).catch(() => {});
    else el.classList.add('blank');
    return el;
  }

  // ------------------------------------------------------------ tarjeta en la oficina
  function counts(r) {
    const g = Object.fromEntries((r.datos.groups || []).map((x) => [x.id, x.items.filter((id) => r.datos.items[id] && visible(r, r.datos.items[id])).length]));
    return g;
  }
  function card(r) {
    const c = r.datos.groups ? counts(r) : {};
    const need = (c.attention || 0) + (c.approved || 0);
    const line = r.datos.groups ? [need ? `${need} te necesita${need === 1 ? '' : 'n'}` : 'Nada te necesita', c.producing ? `${c.producing} produciéndose` : null,
      c.ready ? `${c.ready} listo${c.ready === 1 ? '' : 's'} para publicar` : null].filter(Boolean).join(' · ') : 'Esperando la primera foto del PC…';
    // Con un filtro puesto la tarjeta lo dice: «nada te necesita» sólo vale para lo que se está mirando.
    const sel = r.datos.filters ? selection(r) : [];
    const names = (r.datos.filters?.options || []).filter((o) => sel.includes(o.id)).map((o) => o.name);
    return h('article', { class: `remote-card m-${need ? 'need' : 'idle'}`, 'data-id': `remoto-${r.id}` },
      h('div', { class: 'title' }, h('h3', {}, r.nombre || r.datos.title || 'Proyecto'), h('p', { class: 'muted' }, line),
        names.length ? h('small', { class: 'r-filter' }, `Solo: ${names.join(' + ')}`) : null,
        h('small', { class: 'muted' }, r.error ? `⚠ ${r.error}` : `Foto ${ago(r.at)}`)),
      h('button', { class: 'btn primary small', type: 'button', onclick: () => open(r.id) }, 'Abrir'));
  }
  function paintCards(box) {
    const rs = remotos();
    // Barra superior: un botón por proyecto con mando remoto (hoy VIDEOFACTORY), junto a los controles principales.
    // Sólo se rehace si cambian los proyectos: el repintado periódico no se come un clic ni el foco del teclado.
    const top = document.getElementById('top-remotes');
    const sig = rs.map((r) => `${r.id}|${r.nombre}`).join();
    if (top && top.dataset.sig !== sig) {
      top.dataset.sig = sig;
      top.replaceChildren(...rs.map((r) => h('button', { class: 'btn small remote-top', type: 'button', 'data-remote': slug(r.nombre),
        title: `Abrir el panel de ${r.nombre}`, onclick: () => open(r.id) }, String(r.nombre || r.datos.title || 'Proyecto').toUpperCase())));
    }
    if (pendingRoute) route();
    box.hidden = !rs.length;
    box.replaceChildren(...(rs.length ? [h('div', { class: 'zone-head' }, h('h2', {}, 'Mando remoto')), h('div', { class: 'remote-cards' }, rs.map(card))] : []));
  }

  // ------------------------------------------------------------ pantalla del proyecto
  function open(id, item = null) { openId = id; openItem = item; paint(true); show('p-remote'); window.scrollTo(0, 0); }
  function back() {
    if (openItem) { openItem = null; paint(true); return; }
    openId = null; setHash(); show('p-list');
  }
  // La barra de direcciones dice dónde estás (se puede guardar en favoritos) sin añadir pasos al historial.
  function setHash() {
    const r = openId && cur();
    const want = r ? `#${slug(r.nombre || r.datos.title)}${openItem ? `/${encodeURIComponent(openItem)}` : ''}` : '';
    if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
  }
  /** #videofactory[/contenido] → abre ese panel en cuanto su foto está (si aún no, lo intenta en el siguiente repintado). */
  function route() {
    const m = /^#([a-z0-9]+)(?:\/(.+))?$/.exec(pendingRoute || '');
    if (!m) { pendingRoute = null; return; }
    const r = remotos().find((x) => slug(x.nombre || x.datos?.title) === m[1]);
    if (!r) { if (remotos().length) pendingRoute = null; return; } // ya hay fotos y ninguna es esa: no se queda armada
    pendingRoute = null;
    let item = null;
    try { item = m[2] ? decodeURIComponent(m[2]) : null; } catch { /* dirección mal escrita: la lista */ }
    open(r.id, item && r.datos.items?.[item] ? item : null);
  }
  window.addEventListener('hashchange', () => { if (location.hash.length > 1) { pendingRoute = location.hash; route(); } });

  function banner(r) {
    const out = [];
    if (!online()) out.push(h('p', { class: 'pcline' }, `El PC no está conectado (${data().pc.visto ? `visto ${ago(data().pc.visto)}` : 'aún no visto'}). Ves la última foto (${ago(r.at)}); las acciones no se envían.`));
    if (r.error) out.push(h('p', { class: 'pcline bad' }, `El PC no pudo actualizar este proyecto: ${r.error}. Ves la última foto buena.`));
    return out;
  }

  function filters(r) {
    const opts = r.datos.filters?.options || [];
    if (opts.length < 2) return null;
    const sel = selection(r);
    const set = (next) => { saveSel(r.id, next.length >= opts.length ? [] : next); paint(true); };
    const chip = (label, on, onclick, color) => h('button', { type: 'button', class: 'r-chip', 'aria-pressed': String(on), onclick },
      color ? h('i', { style: `--c:${color}`, 'aria-hidden': 'true' }) : null, label);
    return h('div', { class: 'r-chips', role: 'group', 'aria-label': r.datos.filters.label || 'Filtro' },
      chip('Todos', !sel.length, () => set([])),
      opts.map((o) => chip(`${o.name} · ${o.count ?? ''}`.replace(/ · $/, ''), sel.includes(o.id),
        () => set(sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id]), hexColor(o.color))));
  }

  function row(r, it) {
    return h('button', { type: 'button', class: `r-row t-${TONES[it.tone] || 'idle'}`, onclick: () => { openItem = it.id; paint(true); window.scrollTo(0, 0); } },
      img(r, it.thumb, 'r-thumb'),
      h('span', { class: 'r-what' }, h('b', {}, it.title), h('small', { class: 'muted' }, [it.meta, fecha(it.when)].filter(Boolean).join(' · ')),
        h('span', { class: 'r-state' }, it.state_label), it.note ? h('small', { class: 'r-note' }, it.note) : null),
      it.actions?.length ? h('span', { class: 'r-go', 'aria-hidden': 'true' }, '›') : null);
  }

  function tabs(r) {
    const names = [...new Set((r.datos.groups || []).map((g) => g.tab || TAB_MAIN))];
    if (!names.includes(tab)) tab = TAB_MAIN;
    if (names.length < 2) return null;
    return h('div', { class: 'r-tabs', role: 'group', 'aria-label': 'Vista' }, names.map((n) => h('button', { type: 'button', class: 'r-chip',
      'aria-pressed': String(n === tab), onclick: () => { tab = n; paint(true); } }, n)));
  }

  function list(r) {
    const tabsEl = tabs(r);
    const groups = (r.datos.groups || []).filter((g) => (g.tab || TAB_MAIN) === tab)
      .map((g) => [g, g.items.map((id) => r.datos.items[id]).filter((it) => it && visible(r, it))]).filter(([, xs]) => xs.length);
    return [tabsEl, filters(r), groups.length ? groups.map(([g, xs]) => h('section', { class: 'r-group' },
      h('div', { class: 'zone-head' }, h('h2', {}, g.title), h('span', { class: 'count' }, String(xs.length))), xs.map((it) => row(r, it))))
      : h('p', { class: 'empty' }, 'Nada con este filtro.')];
  }

  // ------------------------------------------------------------ un contenido: bloques y acciones
  const BLOCKS = {
    text: (r, b) => h('section', { class: 'r-block' }, b.title ? h('h3', {}, b.title) : null, h('p', { class: 'r-text' }, b.text)),
    pre: (r, b) => h('section', { class: 'r-block' }, h('h3', {}, b.title), h('pre', { class: 'viewer-text' }, b.text)),
    list: (r, b) => h('section', { class: 'r-block' }, h('h3', {}, b.title), h('ul', {}, b.items.map((x) => h('li', {}, x)))),
    kv: (r, b) => h('section', { class: 'r-block' }, h('h3', {}, b.title), h('dl', { class: 'r-kv' }, b.rows.map(([k, v]) => [h('dt', {}, k),
      h('dd', {}, httpsUrl(v) ? h('a', { href: httpsUrl(v), target: '_blank', rel: 'noopener noreferrer' }, v) : v)]))),
    progress: (r, b) => {
      const of = Math.max(1, Math.min(99, Number(b.of) || 1)), step = Math.max(0, Math.min(of, Number(b.step) || 0));
      return h('section', { class: 'r-block' }, h('h3', {}, `Paso ${step} de ${of} · ${b.label}`),
        h('div', { class: 'r-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(of), 'aria-valuenow': String(step) },
          h('div', { style: `width:${Math.round((step / of) * 100)}%` })), b.warn ? h('p', { class: 'pcline' }, b.warn) : null);
    },
    storyboard: (r, b) => h('section', { class: 'r-block' }, h('h3', {}, `${b.title} · ${b.scenes.length} escenas`), h('ol', { class: 'r-scenes' },
      b.scenes.map((s) => h('li', {}, h('b', {}, [s.n != null ? `Escena ${s.n}` : 'Escena', s.time ? ` · ${s.time}` : ''].join('')),
        s.visual ? h('p', {}, s.visual) : null, s.action ? h('p', { class: 'muted' }, s.action) : null,
        (s.lines || []).map((l) => h('p', { class: 'r-line' }, l)), s.overlay ? h('p', { class: 'muted small' }, `Rótulo: ${s.overlay}`) : null)))),
    video: (r, b) => {
      const m = media(r, b.media);
      const v = h('video', { class: 'r-video', controls: true, playsinline: true, preload: 'metadata' });
      if (m) Promise.all([urlOf(r, b.media), media(r, b.poster) ? urlOf(r, b.poster) : null]).then(([u, p]) => { if (u) v.src = u; if (p) v.poster = p; }).catch(() => {});
      return h('section', { class: 'r-block' }, h('h3', {}, b.title), v, m ? h('small', { class: 'muted' }, MB(m.bytes)) : null);
    },
    copy: (r, b) => h('section', { class: 'r-block r-copy' }, h('div', { class: 'r-copy-head' }, h('h3', {}, b.title),
      httpsUrl(b.open?.url) ? h('a', { class: 'btn ghost small', href: httpsUrl(b.open.url), target: '_blank', rel: 'noopener noreferrer' }, `${b.open.label || 'Abrir'} ↗`) : null),
      b.done ? h('p', { class: 'r-done' }, '✓ Publicado: ', httpsUrl(b.done) ? h('a', { href: httpsUrl(b.done), target: '_blank', rel: 'noopener noreferrer' }, b.done) : b.done) : null,
      b.items.map((x) => h('div', { class: 'r-copy-item' }, h('div', { class: 'r-copy-head' }, h('b', {}, x.label),
        h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => copy(x.text, e.currentTarget, x.label) }, 'Copiar')),
      h('p', { class: 'r-text' }, x.text)))),
    // Galería (p. ej. PORTADAS de VideoFactory): cada imagen con SUS botones; cada botón es una acción CERRADA del contenido
    // (oculta en la lista general) con el parámetro de la imagen ya puesto. Tocar la imagen la amplía.
    gallery: (r, b, it) => h('section', { class: 'r-block r-gallery' }, h('h3', {}, b.title), b.help ? h('p', { class: 'muted' }, b.help) : null,
      local && /^http:\/\/127\.0\.0\.1:\d+\//.test(b.pc_url || '') ? h('a', { class: 'btn ghost small', href: b.pc_url, target: '_blank', rel: 'noopener' }, 'Abrir en el panel de VideoFactory ↗') : null,
      h('div', { class: 'r-gal' }, (b.items || []).map((x) => {
        const pic = img(r, x.media, 'r-gal-img');
        pic.addEventListener('click', () => pic.closest('figure').classList.toggle('big'));
        return h('figure', { class: 'r-gal-item' }, h('div', { class: 'r-gal-pic' }, pic, x.badge ? h('span', { class: 'r-gal-badge' }, x.badge) : null),
          h('figcaption', {}, h('b', {}, x.caption || ''), x.sub ? h('small', { class: 'muted' }, x.sub) : null),
          h('div', { class: 'r-gal-acts' }, (x.actions || []).map((g) => {
            const def = (it.actions || []).find((a) => a.id === g.action);
            if (!def) return null;
            return h('button', { type: 'button', class: `btn small ${g.style === 'primary' ? 'primary' : g.style === 'danger' ? 'ghost-danger' : 'ghost'}`,
              disabled: !online(), onclick: (e) => doAction(r, it, { ...def, fixed: g.fixed || {} }, e.currentTarget) }, g.label);
          })));
      }))),
    download: (r, b) => {
      const m = media(r, b.media);
      if (!m) return null;
      const status = h('small', { class: 'muted', 'aria-live': 'polite' }, `${m.filename} · ${MB(m.bytes)}`);
      // En el PC es el archivo aprobado tal cual, servido por CEOPadre (sin pasar por internet).
      if (local) return h('section', { class: 'r-block' }, h('h3', {}, b.title), b.help ? h('p', { class: 'muted' }, b.help) : null,
        h('a', { class: 'btn primary', href: `${localUrl(r, b.media)}?dl=1`, download: m.filename }, 'Descargar vídeo final'), ' ', status);
      const btn = h('button', { class: 'btn primary', type: 'button', onclick: (e) => download(m, e.currentTarget, status) }, 'Descargar vídeo final');
      return h('section', { class: 'r-block' }, h('h3', {}, b.title), b.help ? h('p', { class: 'muted' }, b.help) : null, btn, status);
    },
  };

  async function copy(text, btn, what) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('textarea', {}); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const l = btn.textContent; btn.textContent = 'Copiado ✓'; setTimeout(() => { btn.textContent = l; }, 1500);
    toast(`Copiado: ${what}`, 'ok');
  }

  /** El vídeo final, idéntico al aprobado: se baja por trozos, se recompone y se comprueba su SHA-256 antes de guardarlo. */
  async function download(m, btn, status) {
    btn.disabled = true;
    try {
      const links = await signed(m.objects);
      const parts = [];
      let got = 0;
      for (const [i, u] of links.entries()) {
        if (!u) throw new Error('enlace no disponible');
        const res = await fetch(u);
        if (!res.ok) throw new Error(`descarga ${res.status}`);
        const buf = await res.arrayBuffer();
        got += buf.byteLength;
        parts.push(buf);
        status.textContent = `Descargando… ${MB(got)} de ${MB(m.bytes)}${m.objects.length > 1 ? ` (parte ${i + 1}/${m.objects.length})` : ''}`;
      }
      const blob = new Blob(parts, { type: m.mime || 'video/mp4' });
      status.textContent = 'Comprobando que es idéntico al aprobado…';
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (sha !== m.sha256 || blob.size !== m.bytes) throw new Error('el archivo descargado no coincide con el aprobado; no se guarda');
      const file = new File([blob], m.filename, { type: blob.type });
      status.textContent = `${m.filename} · ${MB(m.bytes)} · comprobado ✓`;
      if (navigator.canShare?.({ files: [file] })) {
        // Compartir abre la hoja del sistema: «Guardar vídeo», TikTok, Instagram…
        btn.replaceWith(h('button', { class: 'btn primary', type: 'button', onclick: () => navigator.share({ files: [file], title: m.filename }).catch(() => {}) }, 'Guardar o compartir'),
          h('a', { class: 'btn ghost', href: URL.createObjectURL(blob), download: m.filename }, 'Guardar archivo'));
      } else {
        const a = h('a', { href: URL.createObjectURL(blob), download: m.filename });
        document.body.append(a); a.click(); a.remove();
        btn.disabled = false;
      }
    } catch (e) { status.textContent = `No se pudo descargar: ${e.message}`; toast(`No se pudo descargar: ${e.message}`, 'bad'); btn.disabled = false; }
  }

  async function doAction(r, it, a, btn) {
    if (!online()) { toast('El PC no está conectado: la orden no se envía.', 'bad'); return; }
    const fixed = a.fixed || {};
    let params = { ...fixed };
    const fields = (a.params || []).filter((p) => !(p.name in fixed));
    if (fields.length) {
      const got = await ask({ title: a.label, help: it.title, ok: a.label, fields: fields.map((p) => ({ name: p.name, label: p.label, type: p.type,
        required: p.required, options: p.options, placeholder: p.type === 'url' ? 'https://…' : '' })) });
      if (!got) return;
      params = { ...got, ...fixed };
    }
    if (a.confirm && !(await ask({ title: a.confirm.title, help: a.confirm.text, ok: a.confirm.ok || a.label }))) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Enviando…';
    try {
      const res = await api.cmd('remoto.accion', { proyecto: r.id, item: it.id, accion: a.id, params, confirmado: !!a.confirm });
      if (res?.ok) toast(res.data?.mensaje || 'Hecho', 'ok'); else toast(res?.error || 'No se pudo', 'bad');
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  function item(r, it) {
    const acts = (it.actions || []).filter((a) => !a.hidden); // las ocultas viven en su bloque (galería), no en la lista
    return [h('header', { class: 'r-item-head' }, img(r, it.thumb, 'r-thumb big'),
      h('div', {}, h('h2', {}, it.title), h('p', { class: 'muted' }, [it.meta, fecha(it.when)].filter(Boolean).join(' · ')), h('span', { class: `r-state t-${TONES[it.tone] || 'idle'}` }, it.state_label),
        it.note ? h('p', { class: 'r-note' }, it.note) : null)),
    (it.blocks || []).map((b) => BLOCKS[b.type]?.(r, b, it) || null),
    acts.length ? h('div', { class: 'r-actions' }, !online() ? h('p', { class: 'muted small' }, 'PC desconectado: las acciones se activan cuando vuelva.') : null,
      acts.map((a) => h('button', { type: 'button', class: `btn ${a.style === 'danger' ? 'ghost-danger' : a.style === 'primary' ? 'primary' : 'ghost'}`,
        disabled: !online(), onclick: (e) => doAction(r, it, a, e.currentTarget) }, a.label))) : null];
  }

  let painted = '';
  function paint(force = false) {
    const r = cur();
    if (!r) { if (openId) { openId = null; show('p-list'); } return; }
    const it = openItem && r.datos.items?.[openItem];
    if (openItem && !it) openItem = null; // ya no está (publicado, archivado…): vuelve a la lista
    document.getElementById('r-name').textContent = it ? r.nombre : (r.nombre || r.datos.title);
    document.getElementById('r-sub').textContent = `Foto ${ago(r.at)} · ${online() ? 'PC conectado' : 'PC desconectado'}`;
    // Sólo se repinta si cambia la foto, el PC o lo que se mira: el latido (cada 20 s) no corta un vídeo que se está
    // viendo, una descarga en curso ni el botón de guardar de una descarga ya comprobada.
    setHash();
    const sig = `${r.hash}|${r.error}|${online()}|${openItem}|${tab}|${JSON.stringify(selection(r))}`;
    if (!force && sig === painted) return;
    const body = document.getElementById('r-body');
    if (!force && ([...body.querySelectorAll('video')].some((v) => !v.paused) || /Descargando|Comprobando/.test(body.textContent))) return;
    painted = sig;
    body.replaceChildren(...banner(r), ...(r.datos.items ? (it ? item(r, it) : list(r)) : [h('p', { class: 'empty' }, 'Esperando la primera foto del PC…')]).flat(Infinity).filter(Boolean));
  }

  document.getElementById('r-back').addEventListener('click', back);
  return { paintCards, paint: () => { if (openId) paint(); }, isOpen: () => !!openId };
}
