// VENTANAS (V3.9): UN comportamiento para todos los <dialog> modales de CEOPadre (PC y móvil), sin código por página.
//  · Pulsar FUERA de la ventana = lo mismo que Escape = «Volver/Cerrar»: se lanza el evento `cancel` de la ventana, así
//    cada una aplica su protección de siempre (borrador guardado, conversación conservada, «Cancelar» en un visor que
//    pedía confirmar). Si nadie lo impide, se cierra sin valor de retorno: NUNCA es aceptar, aprobar, ejecutar ni borrar.
//  · Sólo la ventana de ARRIBA: las de debajo son inertes (top layer del navegador), así que el clic no llega a ellas ni a
//    la página de detrás (además se detiene aquí).
//  · El clic tiene que EMPEZAR y TERMINAR fuera: seleccionar texto dentro y soltar fuera no cierra nada.
//  · Una ventana que no deba cerrarse así lleva data-fuera="no" (ninguna lo necesita hoy).
// El foco vuelve solo al elemento que abrió la ventana (comportamiento nativo de <dialog>).

const fuera = (d, e) => {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

/** Cierra como «Volver»: respeta a quien escuche `cancel` (puede impedirlo o cerrar a su manera). */
export function volver(d) {
  if (!d?.open) return;
  if (d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
}

export function ventanasUniversales(doc = document) {
  let desde = null;
  doc.addEventListener('pointerdown', (e) => {
    const d = e.target;
    desde = d instanceof HTMLDialogElement && d.open && fuera(d, e) ? d : null;
  }, true);
  doc.addEventListener('click', (e) => {
    const d = e.target;
    const ok = d instanceof HTMLDialogElement && d.open && d === desde && d.dataset.fuera !== 'no' && fuera(d, e);
    desde = null;
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    volver(d);
  }, true);
}

// Borradores de las hojas de pregunta (ask): lo escrito y cerrado sin aceptar (fuera, Escape o Volver) vuelve al reabrir
// la misma pregunta. Sólo en memoria de esta pestaña; nunca contraseñas.
const borradores = new Map();
export const borrador = {
  leer: (clave) => borradores.get(clave) || null,
  guardar: (clave, valores) => { if (Object.values(valores).some((v) => String(v || '').trim())) borradores.set(clave, valores); else borradores.delete(clave); },
  borrar: (clave) => borradores.delete(clave),
};
