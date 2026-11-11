// Construcción de nodos sin HTML: todo el texto entra como texto (nunca innerHTML). Compartido por app.js y map.js.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    // Estilo por CSSOM (la CSP sin 'unsafe-inline' bloquea el atributo style, no esto): sólo variables y medidas propias.
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

/**
 * LENGUAJE CLARO para las vistas principales (sin IA, sin inventar nada): quita lo que sólo entiende un programador —
 * comandos, rutas, hashes, identificadores, fragmentos de código— y deja la frase. El texto completo sigue en el detalle
 * (y en el «title» de cada línea). Si al limpiar no queda nada útil, devuelve el original.
 */
export function claro(t) {
  const s0 = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s0) return s0;
  // «ejecutando un comando: cd /e/… && npm test» → «ejecutando un comando» (si lo de después es una orden, no una descripción)
  const act = /^(ejecutando un comando|leyendo|editando|escribiendo un archivo|buscando(?: en la web)?|consultando la web|con un subagente|planificando|usando \S+):\s*(.+)$/i.exec(s0);
  if (act && /[\\/$|=;{}<>"'`]|^(cd|npm|node|git|python|powershell|grep|cat|ls|sed|curl|timeout|until|for|L=)\b/i.test(act[2])) return act[1];
  const s = s0
    .replace(/`([^`]*)`/g, (_, c) => (/[\\/=;{}()$|<>]/.test(c) ? '' : c))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/(?:[A-Za-z]:\\|\/[a-z]\/|~\/)[^\s,;)]*/g, '')
    .replace(/\b[\w.-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g, '')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, '')
    .replace(/\(\s*[,;·]?\s*\)/g, '').replace(/\s+([,.;:)])/g, '$1').replace(/([(:])\s*[,;]+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return s.length >= 12 ? s : s0;
}
