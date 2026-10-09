// MANDO REMOTO en el móvil y en el PC (contrato ceopadre-remote/1): pinta la foto que el PC sube de cada proyecto (VideoFactory…)
// y deja órdenes de SU lista cerrada. No conoce VideoFactory: dibuja bloques tipados (texto, storyboard, vídeo, textos
// para copiar, descarga…) y acciones con sus parámetros y su confirmación. Todo el texto entra como texto (nunca HTML).
import { h } from './dom.js';
import { zip } from './zip.js';

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
const STALE_DAYS = 7;
const KIND_LABEL = { you: 'Te necesita', old: 'Antigua: ¿sigue vigente?', run: 'En marcha', wait: 'Espera automática', error: 'Error', done: '' };

export function remoteUi({ api, ask, toast, show, data, ago, local = false, ai = null }) {
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
  // Qué necesita cada contenido AHORA, como lo dice el proyecto (`need`); sin él, por su tono. Sólo «you» es «te necesita».
  // Uno que te pide algo pero lleva más de STALE_DAYS sin moverse NO se cuenta como pendiente: se enseña aparte como
  // «antiguo» (¿sigue vigente?), con su botón para archivarlo si ya no vale.
  function kindOf(it) {
    const k = it.need?.kind || { you: 'you', ready: 'you', busy: 'run', done: 'done', bad: 'error' }[it.tone] || 'done';
    return k === 'you' && stale(it) ? 'old' : k;
  }
  const stale = (it) => { const t = Date.parse(String(it.when || '')); return Number.isFinite(t) && Date.now() - t > STALE_DAYS * 86400_000; };
  const reasonOf = (it) => it.need?.reason || it.note || it.state_label || '';
  function needs(r) {
    const seen = new Set(), by = { you: [], old: [], run: [], wait: [], error: [] };
    for (const g of r.datos.groups || []) {
      if ((g.tab || TAB_MAIN) !== TAB_MAIN) continue;
      for (const id of g.items) {
        const it = r.datos.items[id];
        if (!it || seen.has(id) || !visible(r, it)) continue;
        seen.add(id);
        by[kindOf(it)]?.push(it);
      }
    }
    return by;
  }
  function card(r) {
    const n = r.datos.groups ? needs(r) : null;
    const you = n?.you || [];
    // Una sola cosa: la instrucción concreta («Elige la portada de «La persiana…»»); varias: cuántas y la primera.
    const first = you[0] ? `${reasonOf(you[0])} · «${you[0].title}»` : '';
    const line = n ? [you.length === 1 ? `Te necesita: ${first}` : you.length ? `${you.length} te necesitan · ${first}` : 'Nada te necesita ahora',
      n.error.length ? `${n.error.length} con error` : null, n.run.length ? `${n.run.length} en marcha` : null,
      n.wait.length ? `${n.wait.length} en espera automática` : null,
      n.old.length ? `${n.old.length} antigua${n.old.length === 1 ? '' : 's'} sin tocar (¿siguen vigentes?)` : null].filter(Boolean).join(' · ') : 'Esperando la primera foto del PC…';
    const need = you.length + (n?.error.length || 0);
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

  // Qué pide AHORA y por qué, en una frase (o, si ya no pide nada, la nota del proyecto).
  function needLine(it) {
    const k = kindOf(it);
    if (k === 'done') return it.note ? h('small', { class: 'r-note' }, it.note) : null;
    return h('small', { class: `r-need k-${k}` }, `${KIND_LABEL[k]}: ${k === 'old' ? `sin moverse desde ${fecha(it.when)}. ${reasonOf(it)}` : reasonOf(it)}`);
  }
  function row(r, it) {
    return h('button', { type: 'button', class: `r-row t-${TONES[it.tone] || 'idle'}`, onclick: () => { openItem = it.id; paint(true); window.scrollTo(0, 0); } },
      img(r, it.thumb, 'r-thumb'),
      h('span', { class: 'r-what' }, h('b', {}, it.title), h('small', { class: 'muted' }, [it.meta, fecha(it.when)].filter(Boolean).join(' · ')),
        h('span', { class: 'r-state' }, it.state_label), needLine(it)),
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
    // Accesos del PC (p. ej. el panel de VideoFactory): sólo en el PC y sólo a 127.0.0.1; en el móvil no existen.
    const links = local ? (r.datos.links || []).filter((l) => /^http:\/\/127\.0\.0\.1:\d+\//.test(l.url || '')) : [];
    const linkBar = links.length ? h('p', { class: 'r-links' }, links.map((l) => h('a', { class: 'btn ghost small', href: l.url, target: '_blank', rel: 'noopener' }, `${l.label} ↗`))) : null;
    return [linkBar, tabsEl, filters(r), groups.length ? groups.map(([g, xs]) => h('section', { class: 'r-group' },
      h('div', { class: 'zone-head' }, h('h2', {}, g.title), h('span', { class: 'count' }, String(xs.length))), xs.map((it) => row(r, it))))
      : h('p', { class: 'empty' }, 'Nada con este filtro.')];
  }

  // ------------------------------------------------------------ TEXTOS de publicación (VideoFactory vf.pack_copy)
  // Cada campo se edita a mano o con IA; la orden lleva la huella de lo que se vio en cada red (si cambió entre medias, el
  // proyecto lo rechaza: nada se pisa en silencio). Editar nunca aprueba ni publica; aprobar es otro botón.
  const SCOPES = [{ value: 'both', label: 'Instagram y TikTok' }, { value: 'instagram', label: 'Solo Instagram' }, { value: 'tiktok', label: 'Solo TikTok' }];
  const baseFor = (e, k, scope) => JSON.stringify(Object.fromEntries(Object.entries(e.all_hashes || {})
    .filter(([p, hs]) => k in hs && (scope === 'both' || p === scope)).map(([p, hs]) => [p, hs[k]])));
  const multi = (e, k) => Object.values(e.all_hashes || {}).filter((hs) => k in hs).length > 1;

  async function send(r, it, accion, params, btn) {
    if (!online()) { toast('El PC no está conectado: la orden no se envía.', 'bad'); return null; }
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    try {
      const res = await api.cmd('remoto.accion', { proyecto: r.id, item: it.id, accion, params, confirmado: true });
      if (res?.ok) toast(res.data?.mensaje || 'Hecho', 'ok'); else toast(res?.error || 'No se pudo', 'bad');
      return res?.ok ? res.data : null;
    } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  /** Diferencias por palabras como nodos (nunca HTML): tachado lo que se fue, subrayado lo que llegó. */
  function wordDiff(a, b) {
    const x = String(a || '').split(/(\s+)/), y = String(b || '').split(/(\s+)/);
    if (x.length * y.length > 250000) return [h('del', {}, a), ' ', h('ins', {}, b)];
    const m = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) m[i][j] = x[i] === y[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { out.push(x[i]); i++; j++; } else if (j < y.length && (i >= x.length || m[i][j + 1] >= m[i + 1][j])) { out.push(h('ins', {}, y[j])); j++; } else { out.push(h('del', {}, x[i])); i++; }
    }
    return out;
  }

  function fieldRow(r, it, e, k, readOnly = false) {
    const label = e.labels?.[k] || k, panel = h('div', { class: 'r-fpanel' });
    const exc = e.exceptions?.[k];
    const vers = e.versions?.[k] || [];
    const approvable = (k === 'pinned_comment' || k === 'story') && e.fields[k];
    const toggle = (fill) => { if (panel.childNodes.length) { panel.replaceChildren(); return; } panel.replaceChildren(...fill()); };
    return h('div', { class: 'r-field' }, h('div', { class: 'r-copy-head' }, h('b', {}, label),
      approvable ? h('span', { class: `r-state t-${e.approved?.[k] ? 'ok' : 'ask'}` }, e.approved?.[k] ? 'Aprobado' : 'Sin aprobar') : null),
    exc ? h('p', { class: 'muted small' }, `Excepción solo en esta red: ${exc.why}`) : null,
    h('p', { class: 'r-text' }, e.fields[k] || '(vacío)'),
    h('div', { class: 'r-fbtns' },
      readOnly ? null : h('button', { class: 'btn ghost small', type: 'button', disabled: !online(), onclick: () => editField(r, it, e, k) }, 'Editar'),
      ai && !readOnly ? h('button', { class: 'btn accent small', type: 'button', disabled: !online(),
        onclick: () => ai.open({ tipo: 'remoto', proyecto: r.id, item: it.id, plataforma: e.platform, campo: k }) }, 'Editar con IA') : null,
      vers.length > 1 ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => toggle(() => versionList(r, it, e, k, readOnly)) }, `Versiones (${vers.length})`) : null,
      vers.length > 1 && (it.actions || []).some((a) => a.id === 'learn_copy') ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(),
        onclick: (ev) => learnFrom(r, it, e, k, ev.currentTarget) }, 'Aprender de la corrección') : null,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => toggle(() => {
        const o = e.original?.[k] || '';
        return [h('p', { class: 'muted small' }, o === e.fields[k] ? 'Original (sin cambios):' : 'Original comparado con el vigente:'), h('p', { class: 'r-text r-diff' }, ...(o === e.fields[k] ? [o] : wordDiff(o, e.fields[k])))];
      }) }, 'Original'),
      approvable && !readOnly && !e.approved?.[k] ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(), onclick: (ev) => approveText(r, it, e, k, ev.currentTarget) }, 'Aprobar') : null),
    panel);
  }

  function versionList(r, it, e, k, readOnly = false) {
    const vers = e.versions[k];
    return [h('ol', { class: 'r-versions' }, vers.map((v, i) => h('li', {},
      h('small', { class: 'muted' }, `${v.n ? `Versión ${v.n}` : 'Original'} · ${fecha(v.at)} · ${v.by}${i === 0 ? ' · la vigente' : ''}`),
      h('p', { class: 'r-text r-diff' }, ...(i === 0 ? [v.text] : wordDiff(v.text, e.fields[k]))),
      i && !readOnly ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(), onclick: async (ev) => {
        const scope = e.exceptions?.[k] ? e.platform : 'both';
        if (!(await ask({ title: 'Recuperar esta versión', help: `${v.text}\n\nSe aplica a ${scope === 'both' ? 'Instagram y TikTok' : 'esta red'}. Si estaba aprobado, habrá que volver a aprobarlo. No se publica nada.`, ok: 'Recuperar' }))) return;
        await send(r, it, 'restore_text', { platform: e.platform, field: k, scope, n: String(v.n), base: baseFor(e, k, scope) }, ev.currentTarget);
      } }, 'Recuperar esta versión') : null))),
    h('p', { class: 'muted small' }, 'Tachado: lo que tenía esa versión y ya no está. Subrayado: lo que tiene ahora el texto vigente.')];
  }

  async function editField(r, it, e, k) {
    const both = multi(e, k);
    const got = await ask({ title: `Editar ${e.labels?.[k] || k}`, help: 'Guardar no aprueba ni publica: si el texto estaba aprobado, habrá que volver a aprobarlo.', ok: 'Guardar',
      fields: [{ name: 'value', label: e.labels?.[k] || k, type: 'textarea', value: e.fields[k], required: k === 'description' },
        ...(both ? [{ name: 'scope', label: 'Aplicar a', type: 'choice', options: SCOPES.filter((s) => s.value === 'both' || s.value in e.all_hashes), value: e.exceptions?.[k] ? e.platform : 'both' },
          { name: 'note', label: 'Si es solo para una red: por qué (queda documentado)', type: 'text', required: false }] : []),
        { name: 'why', label: 'Por qué lo cambias (opcional; solo esto cuenta como motivo tuyo)', type: 'text', required: false },
        { name: 'learn', label: 'Aprende esto (Claude analiza la corrección; lo puntual no se convierte en regla)', type: 'checkbox' }] });
    if (!got) return;
    const scope = both ? got.scope || 'both' : e.platform;
    const done = await send(r, it, 'edit_text', { field: k, scope, value: got.value, base: baseFor(e, k, scope), note: got.note || '' });
    if (done && got.learn && got.value.trim() !== String(e.fields[k] || '').trim()) {
      toast('Claude está analizando la corrección (≈1 min)…', 'ok');
      await send(r, it, 'learn_copy', { platform: e.platform, field: k, original: e.fields[k] || '', approved: got.value, instructions: got.why || '' });
    }
  }

  async function learnFrom(r, it, e, k, btn) {
    const older = (e.versions?.[k] || []).slice(1);
    const got = await ask({ title: `Aprender de la corrección · ${e.labels?.[k] || k}`, ok: 'Aprender',
      help: `Texto vigente:\n${e.fields[k]}\n\nClaude compara la versión elegida con la vigente; una corrección puntual no se convierte en regla y nada de lo publicado cambia.`,
      fields: [{ name: 'from', label: 'Corrección desde', type: 'choice', value: String(older.at(-1)?.n ?? ''),
        options: older.map((v) => ({ value: String(v.n), label: `${v.n ? `Versión ${v.n}` : 'Original'} · ${String(v.text).slice(0, 60)}` })) },
      { name: 'why', label: 'Por qué lo cambiaste (opcional; solo esto cuenta como motivo tuyo)', type: 'text', required: false }] });
    if (!got) return;
    const from = older.find((v) => String(v.n) === got.from);
    if (!from) return;
    toast('Claude está analizando la corrección (≈1 min)…', 'ok');
    await send(r, it, 'learn_copy', { platform: e.platform, field: k, original: from.text, approved: e.fields[k], instructions: got.why || '' }, btn);
  }

  // Cada red por su cuenta: registro de publicación, ANULAR REGISTRO (nunca el post de la red), no publicar aquí, comentario/story.
  const EXTRA = { pinned_comment: 'Comentario fijado', story: 'Story' };
  function networkPart(r, it, b) {
    const n = b.network;
    if (!n) return null;
    const def = (id) => (it.actions || []).find((a) => a.id === id);
    const rec = n.record;
    return h('div', { class: 'r-net' },
      rec ? h('p', { class: 'r-done' }, `✓ Publicado${rec.at ? ` · ${fecha(rec.at)}` : ''}`, httpsUrl(rec.url) ? [' · ', h('a', { href: httpsUrl(rec.url), target: '_blank', rel: 'noopener noreferrer' }, 'ver post')] : rec.post_id ? ` · id ${rec.post_id}` : '') : null,
      n.skipped ? h('p', { class: 'muted small' }, `No se publicará en esta red (decisión tuya${n.skipped.reason ? `: ${n.skipped.reason}` : ''}).`) : null,
      Object.entries(n.extras || {}).map(([w, st]) => h('div', { class: 'r-copy-head' }, h('span', {}, `${EXTRA[w] || w}: `, h('b', {}, st)),
        def('mark_extra') && rec && st === 'aprobado' ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(),
          onclick: (ev) => send(r, it, 'mark_extra', { platform: n.platform, what: w, done: 'yes' }, ev.currentTarget) }, w === 'story' ? 'Marcar story publicada' : 'Marcar comentario fijado') : null,
        def('mark_extra') && st === 'publicado' ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(),
          onclick: (ev) => send(r, it, 'mark_extra', { platform: n.platform, what: w, done: 'no' }, ev.currentTarget) }, 'Anular marca') : null)),
      (n.actions || []).length ? h('div', { class: 'r-fbtns' }, n.actions.map((a) => {
        const d = def(a.action);
        return d ? h('button', { class: `btn small ${a.style === 'danger' ? 'ghost-danger' : 'ghost'}`, type: 'button', disabled: !online(),
          onclick: (ev) => doAction(r, it, d, ev.currentTarget) }, a.label) : null;
      })) : null,
      (n.annulled || []).length ? h('details', { class: 'fold' }, h('summary', {}, `Registros de publicación anulados (${n.annulled.length})`),
        h('ul', { class: 'r-rules' }, n.annulled.map((x) => h('li', {}, h('small', {}, [fecha(x.at), x.by, x.url, x.note].filter(Boolean).join(' · ')))))) : null);
  }

  async function approveText(r, it, e, what, btn) {
    const text = what === 'caption' ? e.text : e.fields[what];
    if (!(await ask({ title: what === 'caption' ? 'Aprobar el texto completo' : `Aprobar ${e.labels?.[what] || what}`, help: `${text}\n\nAprobar no publica nada.`, ok: 'Aprobar' }))) return;
    await send(r, it, 'approve_text', { platform: e.platform, what, hash: what === 'caption' ? e.caption_hash : e.hash[what] }, btn);
  }

  // ------------------------------------------------------------ DESCARGAR portadas (el archivo original, comprobado)
  /** Bytes del archivo tal cual: en el PC lo sirve CEOPadre desde el disco; en el móvil, por enlaces firmados del bucket
   *  privado (caducan en 1 h). Si hay huella, se comprueba antes de entregar nada. */
  async function fetchVerified(r, key) {
    const m = media(r, key);
    if (!m) throw new Error('archivo no disponible');
    const bufs = [];
    if (local) {
      const res = await fetch(localUrl(r, key));
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      bufs.push(await res.arrayBuffer());
    } else {
      for (const u of await signed(m.objects)) {
        if (!u) throw new Error('enlace no disponible');
        const res = await fetch(u);
        if (!res.ok) throw new Error(`descarga ${res.status}`);
        bufs.push(await res.arrayBuffer());
      }
    }
    const data = new Uint8Array(await new Blob(bufs).arrayBuffer());
    if (m.sha256) {
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (sha !== m.sha256 || data.length !== m.bytes) throw new Error('el archivo descargado no coincide con el original; no se guarda');
    }
    return { name: m.filename, data, mime: m.mime || 'application/octet-stream' };
  }

  function deliver(file) {
    const f = new File([file.data], file.name, { type: file.mime });
    if (!local && navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f], title: file.name }).catch(() => {});
    const a = h('a', { href: URL.createObjectURL(f), download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    return null;
  }

  async function downloadCovers(r, keys, btn, zipName) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Descargando…';
    try {
      const files = [];
      for (const k of keys) files.push(await fetchVerified(r, k));
      if (files.length === 1) deliver(files[0]);
      else deliver({ name: zipName, data: new Uint8Array(await zip(files).arrayBuffer()), mime: 'application/zip' });
      toast(files.length === 1 ? `${files[0].name}: original comprobado ✓` : `${files.length} portadas originales comprobadas ✓ (ZIP)`, 'ok');
    } catch (e) { toast(`No se pudo descargar: ${e.message}`, 'bad'); } finally { btn.disabled = false; btn.textContent = label; }
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
    copy: (r, b, it) => {
      const e = b.edit, has = (id) => (it?.actions || []).some((a) => a.id === id);
      const editable = !!(e?.fields && !b.done && has('edit_text'));
      const pf = e?.platform;
      return h('section', { class: 'r-block r-copy' }, h('div', { class: 'r-copy-head' }, h('h3', {}, b.title),
        (e?.state_label || b.network?.state_label) ? h('span', { class: `r-state t-${b.network?.record ? 'ok' : e?.approved?.caption ? 'ok' : 'ask'}` }, b.network?.record ? 'Publicado' : e?.state_label || b.network.state_label) : null,
        httpsUrl(b.open?.url) ? h('a', { class: 'btn ghost small', href: httpsUrl(b.open.url), target: '_blank', rel: 'noopener noreferrer' }, `${b.open.label || 'Abrir'} ↗`) : null),
      b.network ? networkPart(r, it, b) : b.done ? h('p', { class: 'r-done' }, '✓ Publicado: ', httpsUrl(b.done) ? h('a', { href: httpsUrl(b.done), target: '_blank', rel: 'noopener noreferrer' }, b.done) : b.done) : null,
      (e?.qa || []).length ? h('ul', { class: 'r-qa' }, e.qa.map((q) => h('li', { class: q.level === 'error' ? 'bad' : '' }, q.msg))) : null,
      b.items.map((x, i) => h('div', { class: 'r-copy-item' }, h('div', { class: 'r-copy-head' }, h('b', {}, x.label),
        i === 0 && editable && !e.approved?.caption ? h('button', { class: 'btn primary small', type: 'button', disabled: !online(),
          onclick: (ev) => approveText(r, it, e, 'caption', ev.currentTarget) }, 'APROBAR TEXTO') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: (ev) => copy(x.text, ev.currentTarget, x.label) }, 'Copiar')),
      h('p', { class: 'r-text' }, x.text))),
      e?.fields ? h('details', { class: 'fold r-fields' }, h('summary', {}, editable ? `Editar los textos de ${pf === 'tiktok' ? 'TikTok' : 'Instagram'}` : 'Textos publicados, versiones y aprender'),
        Object.keys(e.fields).map((k) => fieldRow(r, it, e, k, !editable))) : null);
    },
    // Lo aprendido del canal (VideoFactory copy_editorial): se puede leer y REVERTIR. Revertir no borra: deja de aplicarse.
    learned: (r, b, it) => {
      const can = (it?.actions || []).some((a) => a.id === 'revert_learning');
      const rev = (id, what) => (can ? h('button', { class: 'btn ghost small', type: 'button', disabled: !online(), onclick: async (ev) => {
        const ok = await ask({ title: 'Revertir lo aprendido', help: `«${what}» dejará de aplicarse en los textos nuevos (queda en el historial).`, ok: 'Revertir',
          fields: [{ name: 'reason', label: 'Por qué (opcional)', type: 'text', required: false }] });
        if (ok) await send(r, it, 'revert_learning', { id, reason: ok.reason }, ev.currentTarget);
      } }, 'Revertir') : null);
      return h('section', { class: 'r-block' }, h('details', { class: 'fold' }, h('summary', {}, `${b.title} · ${b.rules.length} reglas${b.candidates.length ? ` · ${b.candidates.length} pendientes` : ''}`),
        b.identity ? h('p', {}, h('b', {}, 'Quién habla: '), b.identity) : null,
        // Medido, no puntuado: correcciones que necesitó cada vídeo y reglas que hubo que volver a corregir.
        b.metrics ? h('p', { class: 'muted small' }, `${b.metrics.videos_corrected} vídeo(s) corregidos · ${Object.values(b.metrics.changes_per_video || {}).reduce((x, y) => x + y, 0)} cambios de Antonio · errores que volvieron: ${Object.entries(b.metrics.repeated_errors || {}).map(([k, n]) => `${k} (${n})`).join(', ') || 'ninguno'}. ${b.metrics.note}`) : null,
        h('ul', { class: 'r-rules' }, b.rules.map((x) => h('li', {}, h('p', {}, x.text), h('small', { class: 'muted' }, [x.origin || '', x.repeats ? `· hubo que corregirlo ${x.repeats} vez/veces más` : ''].join(' ')), rev(x.id, x.text)))),
        b.candidates.length ? [h('h4', {}, 'Pendientes de confirmar (no se aplican todavía)'), h('ul', { class: 'r-rules' }, b.candidates.map((x) => h('li', {},
          h('p', {}, x.text), h('small', { class: 'muted' }, `${x.motive === 'inferido' ? 'inferida por la IA' : x.motive || ''} · visto en ${x.evidence} vídeo(s)`), rev(x.id, x.text))))] : null,
        b.examples.length ? [h('h4', {}, 'Correcciones guardadas'), h('ul', { class: 'r-rules' }, b.examples.map((x) => h('li', {},
          h('small', {}, `${x.date} · ${x.field}${x.platform ? ` · ${x.platform}` : ''} · ${x.changes} cambio(s)`), rev(x.id, `la corrección ${x.id}`))))] : null));
    },
    // Galería (p. ej. PORTADAS de VideoFactory): cada imagen con SUS botones; cada botón es una acción CERRADA del contenido
    // (oculta en la lista general) con el parámetro de la imagen ya puesto. Tocar la imagen la amplía.
    gallery: (r, b, it) => {
      const picked = new Set();
      const dls = (b.items || []).filter((x) => x.download && media(r, x.download));
      const multiBtn = h('button', { class: 'btn ghost small', type: 'button', disabled: true,
        onclick: (ev) => downloadCovers(r, [...picked], ev.currentTarget, `${it.id}-portadas.zip`) }, 'Descargar seleccionadas');
      const paintMulti = () => { multiBtn.disabled = !picked.size; multiBtn.textContent = picked.size > 1 ? `Descargar ${picked.size} portadas (ZIP)` : 'Descargar seleccionadas'; };
      return h('section', { class: 'r-block r-gallery' }, h('h3', {}, b.title), b.help ? h('p', { class: 'muted' }, b.help) : null,
      dls.length > 1 ? h('p', { class: 'r-dlbar' }, h('button', { class: 'btn ghost small', type: 'button', onclick: (ev) => downloadCovers(r, dls.map((x) => x.download), ev.currentTarget, `${it.id}-portadas.zip`) },
        `Descargar todas (${dls.length}, ZIP)`), ' ', multiBtn) : null,
      local && /^http:\/\/127\.0\.0\.1:\d+\//.test(b.pc_url || '') ? h('a', { class: 'btn ghost small', href: b.pc_url, target: '_blank', rel: 'noopener' }, 'Abrir en el panel de VideoFactory ↗') : null,
      h('div', { class: 'r-gal' }, (b.items || []).map((x) => {
        const pic = img(r, x.media, 'r-gal-img');
        pic.addEventListener('click', () => pic.closest('figure').classList.toggle('big'));
        return h('figure', { class: 'r-gal-item' }, h('div', { class: 'r-gal-pic' }, pic, x.badge ? h('span', { class: 'r-gal-badge' }, x.badge) : null),
          h('figcaption', {}, h('b', {}, x.caption || ''), x.sub ? h('small', { class: 'muted' }, x.sub) : null),
          x.download && media(r, x.download) ? h('div', { class: 'r-gal-dl' },
            h('button', { class: 'btn primary small', type: 'button', onclick: (ev) => downloadCovers(r, [x.download], ev.currentTarget) }, 'DESCARGAR'),
            dls.length > 1 ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (ev) => { if (ev.target.checked) picked.add(x.download); else picked.delete(x.download); paintMulti(); } }), ' Seleccionar') : null,
            h('small', { class: 'muted' }, MB(media(r, x.download).bytes))) : null,
          h('div', { class: 'r-gal-acts' }, (x.actions || []).map((g) => {
            const def = (it.actions || []).find((a) => a.id === g.action);
            if (!def) return null;
            return h('button', { type: 'button', class: `btn small ${g.style === 'primary' ? 'primary' : g.style === 'danger' ? 'ghost-danger' : 'ghost'}`,
              disabled: !online(), onclick: (e) => doAction(r, it, { ...def, fixed: g.fixed || {} }, e.currentTarget) }, g.label);
          })));
      })));
    },
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
        needLine(it))),
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
