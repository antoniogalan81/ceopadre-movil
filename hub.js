// HUB INTELLIGENCE en Agentes (T3, objetivo e4d03012): UNA vista con lo importante primero y el detalle plegado. Todo sale de
// hub.panel (sin IA, sólo lectura): resumen, inventario con filtros (una sola lista), laboratorio de enlaces e historial.
// La misma entrada busca y recibe enlaces; «Preguntar al HUB» abre el panel Consultar de siempre con el HUB elegido.
// Laboratorio (T4): estado REAL del enlace en el registro de investigaciones (o su evaluación previa); al enviarlo con «Preguntar
// al HUB» se devuelve lo vigente, se suma a lo que esté en curso o se lanza UNA investigación. Aquí sólo se lee.
import { h } from './dom.js';

const FILTROS = [['todo', 'Todo'], ['agent', 'Agentes'], ['skill', 'Skills'], ['mcp', 'MCP'], ['repositorio', 'Repositorios'], ['componente', 'Componentes']];
const TIPO_TXT = { agent: 'agente', skill: 'skill', mcp: 'MCP', repositorio: 'repositorio', componente: 'componente' };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const chip = (t, tone = 'idle') => h('span', { class: `a-chip t-${tone}` }, t);
const titulo = (t, extra = '') => h('p', { class: 'ln' }, h('b', {}, t), extra ? ` ${extra}` : '');

export function hubVista({ api, texto = '', consultar }) {
  let tipo = 'todo', pedido = 0, timer = null;
  const entrada = h('input', { type: 'search', class: 'ag-search hub-entrada', placeholder: 'Qué vas a construir, o pega un enlace', 'aria-label': 'Busca qué reutilizar o pega un enlace', enterkeyhint: 'search' });
  entrada.value = texto;
  const cuerpo = h('div', { class: 'hub-cuerpo' }, h('p', { class: 'muted' }, 'Cargando…'));
  const el = h('section', { class: 'hub-vista', 'data-id': 'hub-vista' },
    h('div', { class: 'ag-bar' }, entrada,
      h('button', { class: 'btn primary small', type: 'button', onclick: () => consultar(entrada.value.trim()) }, '💬 Preguntar al HUB')),
    cuerpo);
  entrada.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(cargar, 250); });

  async function cargar() {
    const n = ++pedido;
    const r = await api.cmd('hub.panel', { texto: entrada.value.trim(), tipo }).catch((e) => ({ ok: false, error: e.message }));
    if (n !== pedido) return; // llegó otra búsqueda después
    // Se conservan los plegables que Antonio tenía abiertos.
    const abiertos = new Set([...cuerpo.querySelectorAll('details[open]')].map((x) => x.dataset.k));
    cuerpo.replaceChildren(...(r?.ok ? pintar(r.data) : [h('p', { class: 'bad', role: 'alert' }, r?.error || 'El PC no responde')]).filter(Boolean));
    for (const x of cuerpo.querySelectorAll('details')) if (abiertos.has(x.dataset.k)) x.open = true;
    el.dataset.estado = r?.ok ? r.data.estado : 'ERROR';
  }

  function pintar(x) {
    return [x.motivo ? h('p', { class: 'note hub-motivo', role: 'status' }, x.motivo) : null,
      // Con un enlace, lo primero es el laboratorio; si no, el inventario.
      resumen(x.resumen), ...(x.laboratorio?.enlace ? [laboratorio(x.laboratorio), inventario(x.inventario)] : [inventario(x.inventario), laboratorio(x.laboratorio)]), historial(x.historial)];
  }
  function resumen(s) {
    if (!s) return null;
    const c = s.capacidades;
    const partes = [c ? `${c.agent} agentes · ${c.skill} skills · ${c.mcp} MCP · ${c.otras} otras` : 'sin registro del HUB',
      `${s.componentes} componentes en ${s.repositorios} repositorios`, `índice ${fecha(s.indice_at)}`,
      s.consulta_ms_p95 != null ? `consulta p95 ${s.consulta_ms_p95} ms (${s.consultas})` : null];
    return h('section', { class: 'hub-sec hub-resumen' }, titulo('RESUMEN', partes.filter(Boolean).join(' · ')));
  }
  function inventario(inv) {
    const filtros = h('div', { class: 'hub-filtros', role: 'group', 'aria-label': 'Filtrar el inventario' },
      FILTROS.map(([k, t]) => h('button', { type: 'button', class: 'btn ghost small', 'data-tipo': k, 'aria-pressed': String(k === tipo),
        onclick: () => { tipo = k; void cargar(); } }, t)));
    const items = inv?.items || [];
    return h('section', { class: 'hub-sec' }, titulo('INVENTARIO', inv?.total > items.length ? `${items.length} de ${inv.total}` : `${items.length}`), filtros,
      items.length ? h('ul', { class: 'hub-lista' }, items.map((i) => h('li', {}, h('b', {}, i.nombre), ' ', chip(TIPO_TXT[i.tipo] || i.tipo), i.que ? h('small', { class: 'muted' }, ` ${i.que}`) : null)))
        : h('p', { class: 'empty' }, entrada.value.trim() ? 'Nada del inventario coincide con esto.' : 'Sin elementos en este filtro.'));
  }
  function estadoEnlace(e) {
    const r = e.registro, vivo = r && Date.parse(r.caduca_at) > Date.now();
    if (e.evaluado) return chip(`Ya evaluado · ${e.evaluado.recomendacion}`, e.evaluado.recomendacion === 'ADOPTADA' ? 'ok' : 'idle');
    if (vivo && r.estado === 'EN_CURSO') return chip(`En investigación · ${r.peticiones} peticiones`, 'ask');
    if (vivo && ['HECHA', 'INACCESIBLE'].includes(r.estado)) return chip(r.estado === 'HECHA' ? 'Ya investigado' : 'Inaccesible (registrado)', r.estado === 'HECHA' ? 'ok' : 'idle');
    return chip('Enlace nuevo', 'ask');
  }
  function laboratorio(l) {
    if (!l) return null;
    const e = l.enlace;
    const fila = (x) => h('li', {}, h('b', {}, x.nombre), x.url ? h('small', { class: 'muted hub-url' }, ` ${x.url}`) : null, x.motivo ? h('small', {}, ` — ${x.motivo}`) : null);
    return h('section', { class: 'hub-sec hub-lab' }, titulo('LABORATORIO'),
      e ? h('p', { class: 'ln hub-enlace' }, estadoEnlace(e), ' ', h('span', { class: 'hub-url' }, e.url),
        e.evaluado ? h('small', {}, ` — ${e.evaluado.nombre}: ${e.evaluado.motivo}`)
          : e.registro?.resultado ? h('small', {}, ` — ${e.registro.resultado.resumen || e.registro.resultado.comprobado || ''}`) : null) : null,
      h('p', { class: 'small muted' }, l.nota),
      h('p', { class: 'ln hub-estados' }, chip(`En curso · ${l.en_curso?.length ?? 0}`, l.en_curso?.length ? 'ask' : 'idle'), ' ', chip(`Incorporadas · ${l.incorporadas.length}`, 'ok'), ' ', chip(`Descartadas · ${l.descartadas.length}`)),
      l.incorporadas.length || l.descartadas.length ? h('details', { class: 'fold', 'data-k': 'hub-evaluadas' }, h('summary', {}, 'Ver lo ya evaluado'),
        l.incorporadas.length ? [h('h4', {}, 'Incorporadas'), h('ul', { class: 'hub-lista' }, l.incorporadas.map(fila))] : null,
        l.descartadas.length ? [h('h4', {}, 'Descartadas'), h('ul', { class: 'hub-lista' }, l.descartadas.map(fila))] : null) : null);
  }
  function historial(xs) {
    return h('details', { class: 'fold hub-sec', 'data-k': 'hub-historial' }, h('summary', {}, `Historial de consultas al HUB (${xs?.length || 0})`),
      xs?.length ? h('ul', { class: 'hub-lista' }, xs.map((m) => h('li', {}, h('small', { class: 'muted' }, `${fecha(m.at)} · `), m.texto)))
        : h('p', { class: 'empty' }, 'Aún no has consultado al HUB. Elige «HUB» en Consultar o pulsa «Preguntar al HUB».'));
  }

  void cargar();
  return { el };
}
