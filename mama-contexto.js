// MAMA UNIVERSAL (T-A, GOAL maestro 18-11): CONTRATO ÚNICO de contexto. Cualquier tarjeta, editor o pantalla dice QUÉ es con
// atributos data-mama-* (tipo, id estable, proyecto, objetivo, versión/huella, acciones disponibles, título); el botón de MAMA lee
// el elemento con el que Antonio estaba y lo manda con su mensaje. Contexto MÍNIMO: sólo identificadores; los datos se consultan
// en el servidor bajo demanda (src/mama.js contextoElemento). Lo usan el navegador (PC y PWA) y el servidor: un solo sitio.
// En el móvil la conversación viaja por el canal cifrado, que sólo lleva texto: el contexto va como SOBRE en la primera línea
// (sellar/separar), y el servidor lo separa antes de guardar. Nada de esto son órdenes: es «de qué estamos hablando».

export const TIPOS = ['pantalla', 'proyecto', 'objetivo', 'trabajo', 'espera', 'agente', 'mensaje', 'borrador', 'decision', 'resultado', 'error',
  'alquiler', 'factura', 'contable'];
const CAMPOS = { id: 120, proyecto: 80, objetivo: 80, version: 80, titulo: 160, pantalla: 40 };
const ID = /^[\p{L}\p{N}:_.\-@#/ ]+$/u; // identificadores y huellas; nunca texto libre largo
const ACCION = /^[a-z][a-z0-9_.]{0,40}$/;

/** Valida y recorta: lo que no cumple el contrato no viaja. null si no hay nada utilizable. */
export function normalizar(x) {
  if (!x || typeof x !== 'object' || !TIPOS.includes(x.tipo)) return null;
  const c = { tipo: x.tipo };
  for (const [k, max] of Object.entries(CAMPOS)) {
    const v = String(x[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    if (v && (k === 'titulo' || ID.test(v))) c[k] = v;
  }
  const acc = (Array.isArray(x.acciones) ? x.acciones : String(x.acciones || '').split(/[\s,]+/)).filter((a) => ACCION.test(a));
  if (acc.length) c.acciones = [...new Set(acc)].slice(0, 8);
  return c;
}

/** Atributos para h(): `h('article', { class, ...marca({ tipo: 'proyecto', id }) })`. */
export function marca(x) {
  const c = normalizar(x);
  if (!c) return {};
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [`data-mama-${k}`, Array.isArray(v) ? v.join(' ') : v]));
}

/** El contexto de un nodo: el elemento marcado más cercano, completado con lo que sabe su pantalla (proyecto/objetivo). */
export function leer(el) {
  const de = (n) => {
    const d = n?.dataset || {};
    return normalizar({ tipo: d.mamaTipo, id: d.mamaId, proyecto: d.mamaProyecto, objetivo: d.mamaObjetivo, version: d.mamaVersion, acciones: d.mamaAcciones, titulo: d.mamaTitulo });
  };
  const cerca = el?.closest?.('[data-mama-tipo]');
  const pant = el?.closest?.('.screen');
  const p = pant ? de(pant) : null;
  let c = de(cerca) || p;
  if (!c) return null;
  const pantalla = pant?.dataset?.mamaId || '';
  // Una pantalla de detalle habla de SU elemento: el objetivo o el proyecto abierto, no de «la pantalla».
  if (c.tipo === 'pantalla' && (c.objetivo || c.proyecto)) c = { ...c, tipo: c.objetivo ? 'objetivo' : 'proyecto', id: c.objetivo || c.proyecto };
  return normalizar({ ...c, proyecto: c.proyecto || p?.proyecto, objetivo: c.objetivo || p?.objetivo, pantalla });
}

/** Frase corta para Antonio: «Proyecto · GEST7», «Borrador · alqmsg-12». */
export const NOMBRE = { pantalla: 'Pantalla', proyecto: 'Proyecto', objetivo: 'Objetivo', trabajo: 'Trabajo', espera: 'Espera', agente: 'Agente', mensaje: 'Mensaje',
  borrador: 'Borrador', decision: 'Decisión', resultado: 'Resultado', error: 'Problema', alquiler: 'Alquiler', factura: 'Factura', contable: 'Contable' };
export function describir(c) {
  if (!c) return '';
  return [NOMBRE[c.tipo] || c.tipo, c.titulo || c.id || ''].filter(Boolean).join(' · ');
}

// Sobre del canal móvil: «⟦mama-ctx {json}⟧» + salto + el mensaje. Sólo se reconoce al principio y con JSON válido del contrato.
const SOBRE = /^⟦mama-ctx (\{[^\n]{2,900}\})⟧\n/;
// §7.3 (19-11): el sobre lleva también la conversación (hilo) del móvil: 'nuevo', el id del PC o el uuid del primer mensaje
// del móvil (0 = principal, no viaja). No es una orden: sólo dice a qué conversación va el mensaje.
const HILO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const hiloValido = (x) => (x === 'nuevo' || (Number.isInteger(x) && x >= 0) || (typeof x === 'string' && HILO_UUID.test(x)) ? x : null);
export const sellar = (texto, c, hilo = null) => {
  const hv = hiloValido(hilo), s = { ...(normalizar(c) || {}), ...(hv !== null && hv !== 0 ? { hilo: hv } : {}) };
  return Object.keys(s).length ? `⟦mama-ctx ${JSON.stringify(s)}⟧\n${texto}` : texto;
};
export function separar(texto) {
  const t = String(texto ?? '');
  const m = SOBRE.exec(t);
  if (!m) return { texto: t, contexto: null };
  let j = null;
  try { j = JSON.parse(m[1]); } catch { j = null; }
  const c = normalizar(j), hilo = j && typeof j === 'object' ? hiloValido(j.hilo) : null;
  return c || hilo !== null ? { texto: t.slice(m[0].length), contexto: c, ...(hilo !== null ? { hilo } : {}) } : { texto: t, contexto: null };
}
