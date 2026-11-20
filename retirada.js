// RETIRADA INMEDIATA (objetivo 53099883, 20-11): lo que Antonio responde desaparece de «lo que te espera» AL PULSAR, en el PC
// y en el móvil, sin esperar al servidor (el bucle del PC se bloquea a veces 2-3 s; en el móvil la orden viaja por Supabase).
// Un solo mecanismo para todas las pantallas: cada respuesta deja una MARCA {tipo, id, zona} y una regla CSS oculta ese
// elemento en cualquier repintado (las tarjetas ya llevan data-mama-tipo/id: contrato T-A). Las marcas se guardan en
// localStorage, así que una recarga no lo hace reaparecer mientras la orden siga viva.
//   EN_VUELO    la orden se está enviando → oculta como mucho 20 s: si nada la confirma (p. ej. se recargó antes de que saliera
//               en el PC, que no tiene cola durable), el pendiente VUELVE: nunca se esconde una decisión que no llegó.
//   ENVIADA     guardada en la cola durable del móvil (ceo_orden) y el PC aún no la ha aplicado → oculta hasta 24 h.
//   CONFIRMADA  el PC la aplicó → oculta hasta que el pendiente deje de llegar en los datos (o 3 min, lo que antes ocurra).
//   Fallo       (el PC la rechaza, no se pudo enviar o caducó) → la marca se quita y el pendiente VUELVE, con lo escrito
//               conservado por run(): la decisión no se pierde en silencio.
const CLAVE = 'ceo-retiradas-v1';
const TTL = { EN_VUELO: 20_000, ENVIADA: 24 * 3_600_000, CONFIRMADA: 3 * 60_000 };
// Órdenes que contestan algo pendiente (las demás —pausar, instrucciones a un trabajo en marcha…— no retiran nada).
export const RESPONDE = new Set(['decision.resolver', 'decision.alternativa', 'decision.responder', 'decision.contestar', 'decision.posponer',
  'espera.hecho', 'espera.resolver', 'negocio.necesidad', 'negocio.responder', 'negocio.lote', 'autorizacion.aprobar', 'bandeja.resolver',
  'trabajo.aprobar', 'trabajo.rechazar']);
export const responde = (op, params) => RESPONDE.has(op) || (op === 'negocio.posponer' && Number(params?.dias) > 0);
// Tipos que sólo existen mientras están pendientes: se ocultan en cualquier sitio. Los demás (un trabajo, una espera) siguen
// existiendo tras responder y pasan a otra sección: sólo se ocultan en la zona donde se respondieron.
const SOLO_PENDIENTE = new Set(['decision', 'autorizacion', 'borrador', 'mensaje']);

let marcas = cargar();
let vigia = null, repaso = null;
function cargar() {
  try { const xs = JSON.parse(localStorage.getItem(CLAVE) || '[]'); return Array.isArray(xs) ? xs.filter((m) => m && m.tipo && m.id) : []; } catch { return []; }
}
function guardar() {
  const ahora = Date.now();
  marcas = marcas.filter((m) => ahora - m.at < (TTL[m.estado] || TTL.EN_VUELO));
  try { localStorage.setItem(CLAVE, JSON.stringify(marcas)); } catch { /* sin almacenamiento: sigue en memoria */ }
  aplicar();
}
const esc = (s) => (globalThis.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
/** Huella corta de un texto (FNV-1a): versión de una tarjeta sin versión propia (el contrato T-A sólo admite identificadores). */
export const huella = (s) => { let h = 2166136261; for (const ch of String(s || '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return (h >>> 0).toString(36); };
// Con versión (la de la tarjeta pulsada), una petición NUEVA del mismo trabajo u objetivo (otra versión) no queda oculta; la
// misma tarjeta repintada SIN versión (ya no pide nada: «Ya lo he hecho» confirmado) sigue oculta hasta que salga de los datos.
export const selector = (m) => `${m.zona ? `#${esc(m.zona)} ` : ''}[data-mama-tipo="${esc(m.tipo)}"][data-mama-id="${esc(m.id)}"]${m.version ? `:is([data-mama-version="${esc(m.version)}"], :not([data-mama-version]))` : ''}`;
// Ocultar por CSSOM (el.style), no con una hoja <style> en línea: la CSP de la web (style-src 'self') la bloquea. Un vigía de
// mutaciones lo reaplica a lo que cualquier repintado vuelva a crear; lo que deja de estar marcado se muestra de nuevo.
function aplicar() {
  if (typeof document === 'undefined') return;
  const ocultar = new Set(marcas.flatMap((m) => [...document.querySelectorAll(selector(m))]));
  for (const el of document.querySelectorAll('[data-retirada]')) if (!ocultar.has(el)) { el.style.removeProperty('display'); el.removeAttribute('data-retirada'); }
  for (const el of ocultar) if (!el.hasAttribute('data-retirada')) { el.style.setProperty('display', 'none', 'important'); el.setAttribute('data-retirada', ''); }
  if (!vigia && typeof MutationObserver !== 'undefined' && document.body) {
    vigia = new MutationObserver((xs) => { if (marcas.length && xs.some((x) => x.addedNodes.length)) aplicar(); });
    vigia.observe(document.body, { childList: true, subtree: true });
  }
}

/** Marca y oculta YA lo que contesta `el` (el botón pulsado o la tarjeta). Devuelve la marca (o null si no hay qué retirar). */
export function retirarDesde(el) {
  const card = el?.closest?.('[data-mama-tipo][data-mama-id]');
  if (!card) return null;
  const tipo = card.dataset.mamaTipo, id = card.dataset.mamaId;
  return retirar({ tipo, id, version: card.dataset.mamaVersion || null, zona: SOLO_PENDIENTE.has(tipo) ? null : card.closest('[id]')?.id || null });
}
/** Marca por referencia (p. ej. desde el panel «Consultar», donde el botón no está dentro de la tarjeta). */
export function retirar({ tipo, id, version = null, zona = null }) {
  if (!tipo || !id) return null;
  const m = { tipo, id: String(id), ...(version ? { version: String(version) } : {}), zona, estado: 'EN_VUELO', at: Date.now() };
  marcas = [...marcas.filter((x) => selector(x) !== selector(m)), m];
  guardar();
  return m;
}
/** Resultado de la orden: confirmada (el PC la aplicó), enviada (sigue viva en la cola) o fallida (el pendiente vuelve). */
export function resolver(m, resultado) {
  if (!m) return;
  if (resultado === 'FALLIDA') marcas = marcas.filter((x) => selector(x) !== selector(m));
  else marcas = marcas.map((x) => (selector(x) === selector(m) ? { ...x, estado: resultado, at: Date.now() } : x));
  guardar();
}
/**
 * Tras pintar datos nuevos: una marca cuyo pendiente ya no llega se borra (el PC ya lo quitó). Mientras el pendiente siga
 * llegando (el PC aún no aplicó la orden, o el móvil ve el último estado conocido) se queda: así no reaparece al recargar.
 */
export function limpiar() {
  const antes = marcas.length;
  marcas = marcas.filter((m) => Date.now() - m.at < 2000 || document.querySelector(selector(m)));
  if (marcas.length !== antes) guardar(); else aplicar();
  // Lo recién marcado no se juzga hasta pasado el margen: se vuelve a mirar entonces aunque no haya otro repintado.
  clearTimeout(repaso);
  if (marcas.some((m) => Date.now() - m.at < 2000)) repaso = setTimeout(limpiar, 2100);
}
/**
 * Cuántos pendientes respondidos que el PC AÚN NO ha aplicado siguen llegando en los datos: se descuentan de «te espera». Una
 * CONFIRMADA ya no cuenta en los números del PC (descontarla otra vez la restaría dos veces mientras se repinta).
 */
export const ocultosEn = (raiz = document) => marcas.filter((m) => m.estado !== 'CONFIRMADA' && raiz.querySelector(selector(m))).length;
export const activas = () => marcas.slice();
if (typeof document !== 'undefined') (document.body ? aplicar() : document.addEventListener('DOMContentLoaded', aplicar, { once: true }));
