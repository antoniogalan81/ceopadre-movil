// GENERADO por tools/mama-web-canal.mjs desde focogravital/APP/src/mama/canal.ts (último cambio 234f772). NO EDITAR AQUÍ:
// se cambia en el APP y se regenera; test/mama-web-canal.test.js falla si divergen.
// MAMA T11 · cliente móvil del canal cifrado (contrato CEOPadre/knowledge/mama/CANAL-T10.md).
// Una sola conversación: la de MAMA en el PC. Supabase sólo transporta sobres «c1.» y claves públicas.
//  · Clave del canal y petición de emparejamiento: almacén SEGURO (SecureStore en la app), por usuario.
//  · Historial y cola: almacén normal (AsyncStorage) pero CIFRADOS con la clave del canal y AAD de usuario+par.
//  · Cola persistente: el mensaje se guarda (con su id y su sobre) ANTES de tocar la red; reintento = mismo id y mismo sobre
//    con upsert ignoreDuplicates ⇒ sin duplicados aunque la respuesta se pierda o la app muera a mitad.
//  · Nunca se registra texto en logs: este módulo no escribe en consola; los errores llevan sólo códigos.
//  · Voz (T30): la nota se trocea en sobres «c1.» normales (≤ 40 000 caracteres, el CHECK de T10 no cambia) que se guardan YA
//    CIFRADOS con la clave del canal antes de tocar la red; el audio en claro no se conserva (lo borra quien graba). El PC
//    la transcribe en local (whisper.cpp) y devuelve el texto con `voz` = id de la nota, que sustituye al marcador del chat.
//  · Adjuntos (T31): mismo troceo «c1.» ({rol:'adj', adj, i, n, nombre, mime, bytes, sha256, b64}). Los sobres de salida y el archivo
//    (cifrado con la clave del canal y AAD usuario+par) van a FICHEROS de la app, no a AsyncStorage (≈ 6 MB en total en Android).
//    El PC confirma con un eco `adjunto` y borra las filas al guardarlas; lo que llega del PC se guarda cifrado y sus filas se
//    BORRAN de Supabase en cuanto están en el móvil (borrado al entregarse, RLS del dueño). Huella SHA-256 de punta a punta.
                                                        
import {
  abrir, b64, cifrarLocal, codigoValido, de64, descifrarLocal, macMovil, sellar, sha256hex, solicitarPar, terminarPar, TEXTO_MAX, uuid4, UUID,
} from "./cripto.js";

                                                 
                                                                             
                              
                                                                       
                                                                                
                                                                                                        
                           
 
/** T31: archivo de la conversación. `listo` = el archivo está en el móvil (cifrado) y se puede abrir. */
                                                                                                                                          
                                                                        
                              
                                                                          
                                                 
 

                                                                                    
                                          
                                                                                                         
                                                                                                                            
  
                         
                               
                                                                                                    
                       
    
 
                              
                                                                                                                                 
 
                             
                                                                                                                  
 
/** T31: ficheros privados de la app (en Android, documentDirectory). `borrar` admite una carpeta (borra lo que cuelga). */
                               
                                                                                                                                              
 
                       
                                                                                                                                    
                                         
 

                                                         
                                                                                                                      

export const LOTE = 50, HISTORIAL_MAX = 500, PC_VIVO_MS = 90_000, DISPOSITIVO_MAX = 60;
/** Tope del historial cifrado en un solo valor de AsyncStorage (Android: «Row too big» hacia 2 MB por fila). */
export const LOCAL_MAX_CHARS = 1_000_000;
/** Voz (T30): bytes de audio por sobre (≈ 37 600 caracteres con el JSON y dos base64: por debajo del CHECK ≤ 40 000). */
export const VOZ_TROZO = 21_000, VOZ_MAX_BYTES = 600_000, VOZ_COLA_MAX = 5, VOZ_LOTE = 5, VOZ_SEG_MAX = 300;
export const MIMES_VOZ = ["audio/mp4", "audio/m4a", "audio/aac", "audio/3gpp", "audio/wav", "audio/webm", "audio/ogg"];
/** Adjuntos (T31): MISMOS límites que el PC (src/mama-adjuntos.js). La firma del contenido la comprueba el PC. */
export const ADJ_TROZO = 21_000, ADJ_MAX_BYTES = 5 * 1024 * 1024, ADJ_TROZOS_MAX = Math.ceil(ADJ_MAX_BYTES / ADJ_TROZO), ADJ_COLA_MAX = 3, ADJ_LOTE = 5, ADJ_NOMBRE_MAX = 120;
export const TIPOS_ADJ                         = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic",
  "text/plain": "txt", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc", "application/vnd.ms-excel": "xls",
};
/** Tipo admitido por el declarado o, si viene vacío/genérico, por la extensión. null = no admitido. */
export function tipoAdjunto(mime                           , nombre        )                {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (TIPOS_ADJ[m]) return m;
  if (m && m !== "application/octet-stream") return null;
  const e = String(nombre || "").toLowerCase().split(".").pop();
  if (e === "jpeg") return "image/jpeg";
  return Object.keys(TIPOS_ADJ).find((k) => TIPOS_ADJ[k] === e) || null;
}
/** Nombre para mostrar: sin rutas ni controles y ≤ 120 (el PC lo sanea igual y lo devuelve en el eco). */
export const nombreAdjunto = (n        ) =>
  String(n || "").split(/[\\/]/).pop() .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, ADJ_NOMBRE_MAX) || "adjunto";

export class MamaError extends Error {
  codigo        ;
  constructor(codigo        ) { super(codigo); this.codigo = codigo; }
}
/** Tablas del canal ausentes (migración T10 sin aplicar) → la pantalla lo dice y no reintenta en bucle. */
const noExiste = (e                    ) =>
  !!e && (e.code === "PGRST205" || e.code === "42P01" || /schema cache|does not exist/i.test(e.message || ""));
/** El servidor rechaza ESA fila (CHECK, RLS, formato): reintentarla no sirve; sí al resto de la cola. */
const rechazoDeDatos = (e                    ) => !!e && !noExiste(e) && /^(22|23|42)/.test(e.code || "");

export class MamaCanal {
          canal                                        = null;
          pend                      = null;
          local        = { historial: [], cursor: 0 };
          fase       = "sin_par";
          aviso                = null;
          pcActivo                 = null;
          enCurso                              = null;
          otraVez = false;
          cargado = false;
          capacidad = false; // T31: anunciado en esta sesión que este móvil recoge (y borra) archivos del PC
          gen = 0; // sube en cada olvidar(): un ciclo en vuelo no resucita un emparejamiento cancelado o revocado
                   kCanal        ;
                   kPend        ;
                   kLocal        ;
          kVoz(voz        ) { return `mama.voz.${this.d.uid}.${voz}`; }
  // T31: ficheros por usuario (otra cuenta en el mismo móvil no ve los de ésta).
          fArchivo(id        ) { return `mama-adj/${this.d.uid}/${id}.l1`; }
          fSalida(id        ) { return `mama-adj-salida/${this.d.uid}/${id}.json`; }
          fTrozo(id        , i        ) { return `mama-adj-entrada/${this.d.uid}/${id}/${i}.json`; }

          d      ;
  constructor(d      ) {
    this.d = d;
    if (!UUID.test(d.uid)) throw new MamaError("usuario_invalido");
    // Claves POR USUARIO: otra cuenta en el mismo móvil no ve ni la clave ni el historial de ésta.
    this.kCanal = `mama.canal.${d.uid}`;
    this.kPend = `mama.pend.${d.uid}`;
    this.kLocal = `mama.local.${d.uid}`;
  }
          ahora() { return this.d.ahora ? this.d.ahora() : Date.now(); }
          iso() { return new Date(this.ahora()).toISOString(); }

  instantanea()              {
    const hist = this.local.historial;
    return {
      fase: this.fase, mensajes: hist.map((m) => ({ ...m, cifrado: undefined })),
      pendientes: hist.filter((m) => m.nuevo).length, // por mensaje, no por hora: inmune al desfase de relojes PC/móvil
      enCola: hist.filter((m) => m.estado === "pendiente").length,
      pcActivo: this.pcActivo, aviso: this.aviso,
    };
  }

  async cargar()                       {
    const c = await this.d.seguro.get(this.kCanal);
    const p = await this.d.seguro.get(this.kPend);
    this.canal = null; this.pend = null;
    if (c) {
      try {
        const j = JSON.parse(c);
        if (UUID.test(j.par)) this.canal = { par: j.par, k: de64(j.k) };
      } catch { /* clave ilegible: se trata como sin emparejar */ }
    }
    if (!this.canal && p) { try { this.pend = JSON.parse(p); } catch { this.pend = null; } }
    this.local = { historial: [], cursor: 0 };
    if (this.canal) {
      const s = await this.d.almacen.getItem(this.kLocal);
      if (s) {
        try { this.local = descifrarLocal       (this.canal.k, this.d.uid, this.canal.par, s); }
        catch { this.aviso = "historial_local_ilegible"; } // otra clave/otro usuario/alterado: no se muestra nada
      }
    }
    this.fase = this.canal ? "activo" : this.pend ? "esperando" : "sin_par";
    this.cargado = true;
    return this.instantanea();
  }
          carga                              = null;
          async asegurar() {
    if (this.cargado) return;
    try { await (this.carga ??= this.cargar()); }
    catch (e) { this.carga = null; throw e; } // fallo transitorio (almacén bloqueado): el siguiente intento vuelve a leer
  }
  /** Estado actual (carga del disco una sola vez por instancia; nunca a mitad de un ciclo). */
  async preparar()                       { await this.asegurar(); return this.instantanea(); }

          async guardar() {
    if (!this.canal) return;
    if (this.local.historial.length > HISTORIAL_MAX) {
      // Nunca se recorta un mensaje aún en cola.
      const sobran = this.local.historial.length - HISTORIAL_MAX;
      let quitados = 0;
      const antes = this.local.historial;
      this.local.historial = this.local.historial.filter((m) => (quitados < sobran && m.estado !== "pendiente" ? (quitados++, false) : true));
      await this.olvidarArchivos(antes.filter((m) => !this.local.historial.includes(m))); // T31: su archivo se va con el mensaje
    }
    // Tope por tamaño: se quitan los más antiguos ya entregados (la conversación completa sigue en el PC).
    while (JSON.stringify(this.local).length > (this.d.localMaxChars ?? LOCAL_MAX_CHARS)) {
      const antes = this.local.historial.length;
      let quitar = Math.max(1, Math.floor(antes / 10));
      const previo = this.local.historial;
      this.local.historial = this.local.historial.filter((m) => (quitar > 0 && m.estado !== "pendiente" ? (quitar--, false) : true));
      await this.olvidarArchivos(previo.filter((m) => !this.local.historial.includes(m)));
      if (this.local.historial.length === antes) break;
    }
    await this.d.almacen.setItem(this.kLocal, cifrarLocal(this.canal.k, this.d.uid, this.canal.par, this.local, this.d.rand));
  }

  /** Borra TODO lo de este usuario en el móvil (revocación o «desemparejar»). */
  async olvidar(aviso                = null)                       {
    this.gen++;
    this.capacidad = false;
    for (const m of this.local.historial) if (m.voz && m.estado === "pendiente") await this.d.almacen.removeItem(this.kVoz(m.voz));
    if (this.d.ficheros) for (const dir of ["mama-adj", "mama-adj-salida", "mama-adj-entrada"]) await this.d.ficheros.borrar(`${dir}/${this.d.uid}`); // T31
    this.canal?.k.fill(0);
    await this.d.seguro.del(this.kCanal);
    await this.d.seguro.del(this.kPend);
    await this.d.almacen.removeItem(this.kLocal);
    this.canal = null; this.pend = null;
    this.local = { historial: [], cursor: 0 };
    this.fase = "sin_par"; this.aviso = aviso; this.pcActivo = null;
    return this.instantanea();
  }

  // ------------------------------------------------------------ emparejamiento (§3)

  async emparejar(codigo        , dispositivo = "Móvil")                       {
    await this.asegurar();
    if (!codigoValido(codigo)) throw new MamaError("codigo_invalido");
    if (this.canal) throw new MamaError("ya_emparejado");
    const disp = String(dispositivo || "Móvil").trim().slice(0, DISPOSITIVO_MAX);
    const { fila, pendiente } = await solicitarPar(codigo, this.d.rand);
    pendiente.dispositivo = disp;
    // Se custodia ANTES de enviarla: si la app muere tras el INSERT, al volver se termina con la misma petición.
    await this.d.seguro.set(this.kPend, JSON.stringify(pendiente));
    this.pend = pendiente; this.fase = "esperando"; this.aviso = null;
    const { error } = await this.d.sb.from("mama_par")
      .upsert({ ...fila, dispositivo: disp }, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      if (noExiste(error)) this.fase = "no_disponible";
      else this.aviso = "red"; // se reintenta en sincronizar() con la MISMA fila
    }
    return this.instantanea();
  }

  async cancelarEmparejamiento()                       { await this.asegurar(); return this.olvidar(); }
  /** «Olvidar este móvil» desde la pantalla (p. ej. si la fila del emparejamiento ya no existe en el servidor). */
  async desemparejar()                       { await this.asegurar(); return this.olvidar(); }

          async comprobarPar() {
    const p = this.pend ;
    const g = this.gen;
    const { data, error } = await this.d.sb.from("mama_par").select("estado,pub_pc,mac_pc,motivo").eq("id", p.par);
    if (g !== this.gen) return; // cancelado mientras esperaba
    if (error) { if (noExiste(error)) this.fase = "no_disponible"; else this.aviso = "red"; return; }
    const r = data?.[0];
    if (!r) { // la petición no llegó: se reenvía idéntica
      const { error: e2 } = await this.d.sb.from("mama_par")
        .upsert({ id: p.par, dispositivo: p.dispositivo || "Móvil", pub_movil: p.pubMovil, mac_movil: macMovil(p) }, { onConflict: "id", ignoreDuplicates: true });
      if (e2 && noExiste(e2)) this.fase = "no_disponible";
      else if (e2) this.aviso = "red";
      return;
    }
    if (r.estado === "solicitado") { this.fase = "esperando"; return; }
    if (r.estado !== "aceptado") { await this.olvidar(r.estado === "rechazado" ? `rechazado_${r.motivo || "codigo"}` : "revocado"); return; }
    let k            ;
    try { k = terminarPar(p, r.pub_pc, r.mac_pc); }
    catch { await this.olvidar("respuesta_no_autenticada"); return; }
    if (g !== this.gen) { k.fill(0); return; }
    await this.d.seguro.set(this.kCanal, JSON.stringify({ par: p.par, k: b64(k) }));
    await this.d.seguro.del(this.kPend);
    this.canal = { par: p.par, k }; this.pend = null;
    this.local = { historial: [], cursor: 0 };
    this.fase = "activo"; this.aviso = null;
    await this.guardar();
  }

  // ------------------------------------------------------------ mensajes (§4)

  async enviar(texto        )                       {
    await this.asegurar();
    const t = String(texto ?? "").trim();
    if (!t || t.length > TEXTO_MAX) throw new MamaError("texto_invalido");
    if (!this.canal) throw new MamaError("sin_par");
    const id = uuid4(this.d.rand);
    const cifrado = sellar(this.canal.k, { par: this.canal.par, origen: "movil", id }, { rol: "antonio", texto: t }, this.d.rand);
    const m              = { id, rol: "antonio", texto: t, at: this.iso(), via: "movil", estado: "pendiente", cifrado };
    this.local.historial.push(m);
    try { await this.guardar(); } // en cola y en disco ANTES de la red
    catch (e) { this.local.historial = this.local.historial.filter((x) => x !== m); throw e; } // sin fantasma que se suba
    void this.sincronizar().catch(() => undefined); // la pantalla no espera a la red
    return this.instantanea();
  }

  /**
   * Nota de voz (T30). Se trocea y se sella con la clave del canal; los sobres (ya cifrados) quedan en el almacén ANTES de la red y
   * el marcador del chat queda en la cola. Reintento = mismos ids y mismos sobres (upsert ignoreDuplicates) ⇒ sin duplicados.
   * Quien llama debe borrar su fichero de audio al volver (haya ido bien o mal): aquí no se guarda audio en claro.
   */
  async enviarVoz(audio            , mime        , seg        )                       {
    await this.asegurar();
    if (!this.canal) throw new MamaError("sin_par");
    if (!(audio instanceof Uint8Array) || !audio.length || audio.length > VOZ_MAX_BYTES) throw new MamaError("voz_tamano");
    if (!MIMES_VOZ.includes(mime)) throw new MamaError("voz_formato");
    if (this.local.historial.filter((m) => m.voz && m.estado === "pendiente").length >= VOZ_COLA_MAX) throw new MamaError("voz_cola_llena");
    const s = Math.max(0, Math.min(VOZ_SEG_MAX, Math.round(Number(seg) || 0)));
    const voz = uuid4(this.d.rand);
    const n = Math.ceil(audio.length / VOZ_TROZO);
    const { par, k } = this.canal;
    const sobres = Array.from({ length: n }, (_, i) => {
      const id = uuid4(this.d.rand);
      const datos = { rol: "voz", voz, i, n, mime, seg: s, b64: b64(audio.subarray(i * VOZ_TROZO, (i + 1) * VOZ_TROZO)) };
      return { id, cifrado: sellar(k, { par, origen: "movil", id }, datos, this.d.rand) };
    });
    // El marcador lleva el id del PRIMER trozo: su acuse del PC («recibido») sirve para toda la nota.
    const m              = { id: sobres[0].id, rol: "antonio", texto: `🎙 Nota de voz (${s} s)`, at: this.iso(), via: "movil", estado: "pendiente", voz, seg: s };
    await this.d.almacen.setItem(this.kVoz(voz), JSON.stringify(sobres));
    this.local.historial.push(m);
    try { await this.guardar(); }
    catch (e) { this.local.historial = this.local.historial.filter((x) => x !== m); await this.d.almacen.removeItem(this.kVoz(voz)); throw e; }
    void this.sincronizar().catch(() => undefined);
    return this.instantanea();
  }

  /**
   * Adjunto (T31). Se trocea y se sella con la clave del canal; los sobres (ya cifrados) y una copia cifrada del archivo quedan en
   * ficheros de la app ANTES de la red; el marcador del chat queda en la cola. Reintento = mismos ids y sobres ⇒ sin duplicados.
   */
  async enviarAdjunto(datos            , nombre        , mime                )                       {
    await this.asegurar();
    if (!this.canal) throw new MamaError("sin_par");
    const fx = this.d.ficheros;
    if (!fx) throw new MamaError("sin_ficheros");
    if (!(datos instanceof Uint8Array) || !datos.length || datos.length > ADJ_MAX_BYTES) throw new MamaError("adj_tamano");
    const tipo = tipoAdjunto(mime, nombre);
    if (!tipo) throw new MamaError("adj_tipo");
    if (this.local.historial.filter((m) => m.adjunto && m.via === "movil" && m.estado === "pendiente").length >= ADJ_COLA_MAX) throw new MamaError("adj_cola_llena");
    const limpio = nombreAdjunto(nombre), adj = uuid4(this.d.rand), huella = sha256hex(datos);
    const n = Math.ceil(datos.length / ADJ_TROZO);
    const { par, k } = this.canal;
    const sobres = Array.from({ length: n }, (_, i) => {
      const id = uuid4(this.d.rand);
      const d = { rol: "adj", adj, i, n, nombre: limpio, mime: tipo, bytes: datos.length, sha256: huella, b64: b64(datos.subarray(i * ADJ_TROZO, (i + 1) * ADJ_TROZO)) };
      return { id, cifrado: sellar(k, { par, origen: "movil", id }, d, this.d.rand) };
    });
    const m              = { id: sobres[0].id, rol: "antonio", texto: `📎 ${limpio}`, at: this.iso(), via: "movil", estado: "pendiente",
      adjunto: { id: adj, nombre: limpio, mime: tipo, bytes: datos.length, sha256: huella, listo: true } };
    try {
      await fx.escribir(this.fArchivo(adj), cifrarLocal(k, this.d.uid, par, { b64: b64(datos) }, this.d.rand));
      await fx.escribir(this.fSalida(adj), JSON.stringify(sobres));
      this.local.historial.push(m);
      await this.guardar();
    } catch (e) {
      this.local.historial = this.local.historial.filter((x) => x !== m);
      await fx.borrar(this.fArchivo(adj)); await fx.borrar(this.fSalida(adj));
      throw e;
    }
    void this.sincronizar().catch(() => undefined);
    return this.instantanea();
  }

  /** El archivo de un adjunto, descifrado y con su huella comprobada, para abrirlo o guardarlo (T31). null si aún no está. */
  async abrirAdjunto(id        )                                                                      {
    await this.asegurar();
    const a = this.local.historial.find((x) => x.adjunto?.id === id)?.adjunto;
    if (!this.canal || !this.d.ficheros || !a?.listo) return null;
    const s = await this.d.ficheros.leer(this.fArchivo(id));
    if (!s) return null;
    const datos = de64(descifrarLocal                 (this.canal.k, this.d.uid, this.canal.par, s).b64);
    if (a.sha256 && sha256hex(datos) !== a.sha256) return null;
    return { datos, nombre: a.nombre, mime: a.mime };
  }

          async olvidarArchivos(ms               ) {
    if (!this.d.ficheros) return;
    for (const m of ms) if (m.adjunto?.id && !this.local.historial.some((x) => x.adjunto?.id === m.adjunto .id)) await this.d.ficheros.borrar(this.fArchivo(m.adjunto.id));
  }

  async marcarVisto()                       {
    let cambio = false;
    for (const m of this.local.historial) if (m.nuevo) { delete m.nuevo; cambio = true; }
    if (cambio) await this.guardar();
    return this.instantanea();
  }

  /** Espera al ciclo de red en curso (el que lanzó enviar) sin forzar otro. */
  async enVuelo()                       { if (this.enCurso) return this.enCurso; await this.asegurar(); return this.instantanea(); }

  /** Un ciclo: emparejamiento → revocación → subida de la cola → recepción → acuses → latido del PC. Nunca dos a la vez. */
  sincronizar()                       {
    if (this.enCurso) { this.otraVez = true; return this.enCurso; }
    this.enCurso = (async () => {
      try {
        do { this.otraVez = false; await this.ciclo(); } while (this.otraVez);
        return this.instantanea();
      } finally { this.enCurso = null; }
    })();
    return this.enCurso;
  }

          async ciclo() {
    await this.asegurar();
    if (this.pend && !this.canal) { await this.comprobarPar(); return; }
    if (!this.canal) return;
    this.aviso = null;
    try {
      if (!(await this.parVigente())) return;
      await this.subir();
      await this.subirVoz();
      await this.subirAdjuntos();
      await this.anunciarCapacidad();
      await this.recibir();
      await this.borrarEntregadas();
      await this.acuses();
      await this.latido();
      if (this.fase === "no_disponible") this.fase = "activo";
    } catch (e) {
      if (e instanceof MamaError && e.codigo === "no_disponible") this.fase = "no_disponible";
      else this.aviso = "red"; // la cola sigue en disco: el próximo ciclo reintenta con los mismos ids
    }
  }

          falla(error                    ) {
    if (!error) return;
    throw new MamaError(noExiste(error) ? "no_disponible" : "red");
  }

          async parVigente() {
    const { data, error } = await this.d.sb.from("mama_par").select("estado").eq("id", this.canal .par);
    this.falla(error);
    const estado = data?.[0]?.estado;
    if (estado === "aceptado") return true;
    // SÓLO una revocación explícita borra la clave y la cola. Sin fila visible (sesión rara, carrera) no se destruye nada:
    // se avisa y Antonio puede «Olvidar este móvil» a mano.
    if (estado === "revocado") await this.olvidar("revocado");
    else this.aviso = "par_no_visible";
    return false;
  }

          async subir() {
    const cola = this.local.historial.filter((m) => m.estado === "pendiente" && m.cifrado);
    if (!cola.length) return;
    const fila = (m             ) => ({ id: m.id, par_id: this.canal .par, origen: "movil", cifrado: m.cifrado });
    const opts = { onConflict: "id", ignoreDuplicates: true };
    const { error } = await this.d.sb.from("mama_mensaje").upsert(cola.map(fila), opts);
    if (error && !rechazoDeDatos(error)) this.falla(error);
    if (!error) for (const m of cola) { m.estado = "enviado"; delete m.cifrado; }
    else {
      // Una fila inválida no bloquea la cola: se sube de una en una y sólo ésa queda «no aceptado».
      for (const m of cola) {
        const { error: e } = await this.d.sb.from("mama_mensaje").upsert(fila(m), opts);
        if (e && !rechazoDeDatos(e)) { await this.guardar(); this.falla(e); }
        m.estado = e ? "rechazado" : "enviado";
        delete m.cifrado;
      }
    }
    await this.guardar();
  }

          async subirVoz() {
    const cola = this.local.historial.filter((m) => m.voz && m.estado === "pendiente");
    const opts = { onConflict: "id", ignoreDuplicates: true };
    for (const m of cola) {
      const clave = this.kVoz(m.voz );
      const s = await this.d.almacen.getItem(clave);
      let sobres                                           = null;
      try { sobres = s ? JSON.parse(s) : null; } catch { sobres = null; }
      if (!sobres?.length) { m.estado = "rechazado"; await this.guardar(); continue; } // sobres perdidos: no hay nada que subir
      let rechazada = false;
      for (let i = 0; i < sobres.length && !rechazada; i += VOZ_LOTE) {
        const filas = sobres.slice(i, i + VOZ_LOTE).map((f) => ({ id: f.id, par_id: this.canal .par, origen: "movil", cifrado: f.cifrado }));
        const { error } = await this.d.sb.from("mama_mensaje").upsert(filas, opts);
        if (error && rechazoDeDatos(error)) rechazada = true;
        else this.falla(error); // red: la nota sigue en cola con los MISMOS sobres
      }
      m.estado = rechazada ? "rechazado" : "enviado";
      await this.guardar();                   // primero el estado…
      await this.d.almacen.removeItem(clave); // …luego los sobres: un corte entre medias deja basura cifrada, nunca una nota perdida
    }
  }

          async subirAdjuntos() {
    const fx = this.d.ficheros;
    if (!fx) return;
    const cola = this.local.historial.filter((m) => m.adjunto && m.via === "movil" && m.estado === "pendiente");
    const opts = { onConflict: "id", ignoreDuplicates: true };
    for (const m of cola) {
      const clave = this.fSalida(m.adjunto .id);
      let sobres                                           = null;
      try { const s = await fx.leer(clave); sobres = s ? JSON.parse(s) : null; } catch { sobres = null; }
      if (!sobres?.length) { m.estado = "rechazado"; await this.guardar(); continue; }
      let rechazada = false;
      for (let i = 0; i < sobres.length && !rechazada; i += ADJ_LOTE) {
        const filas = sobres.slice(i, i + ADJ_LOTE).map((f) => ({ id: f.id, par_id: this.canal .par, origen: "movil", cifrado: f.cifrado }));
        const { error } = await this.d.sb.from("mama_mensaje").upsert(filas, opts);
        if (error && rechazoDeDatos(error)) rechazada = true;
        else this.falla(error); // red: sigue en cola con los MISMOS sobres
      }
      m.estado = rechazada ? "rechazado" : "enviado";
      await this.guardar();       // primero el estado…
      await fx.borrar(clave);     // …luego los sobres (la copia cifrada del archivo se queda para abrirlo)
    }
  }

  /** T31: el PC sólo sube archivos a un móvil que lo anuncia (la 1.2.5 no los borraría). Una vez por sesión y por emparejamiento;
   *  un PC antiguo lo rechaza («formato») sin efecto y la siguiente sesión lo repite. El PC borra la fila al leerla. */
          async anunciarCapacidad() {
    if (this.capacidad || !this.d.ficheros) return;
    const { par, k } = this.canal ;
    const id = uuid4(this.d.rand);
    const cifrado = sellar(k, { par, origen: "movil", id }, { rol: "capacidad", adjuntos: 1 }, this.d.rand);
    const { error } = await this.d.sb.from("mama_mensaje").upsert({ id, par_id: par, origen: "movil", cifrado }, { onConflict: "id", ignoreDuplicates: true });
    if (error && !rechazoDeDatos(error)) this.falla(error);
    this.capacidad = true;
  }

  /** Un trozo de un adjunto del PC: se guarda tal cual (sobre ya cifrado) y su fila se apunta para borrarla. */
          async trozoEntrante(f                                 , d     ) {
    const fx = this.d.ficheros;
    const L = this.local;
    if (!fx || !UUID.test(String(d.adj)) || !TIPOS_ADJ[d.mime]) return;
    const { n, i, bytes } = d;
    if (!Number.isInteger(n) || n < 1 || n > ADJ_TROZOS_MAX || !Number.isInteger(i) || i < 0 || i >= n || !Number.isInteger(bytes) || bytes < 1 || bytes > ADJ_MAX_BYTES) return;
    if (!/^[0-9a-f]{64}$/.test(String(d.sha256))) return;
    (L.borrar ??= []).push(f.id);
    const m = L.historial.find((x) => x.adjunto?.id === d.adj);
    if (m?.adjunto?.listo || m?.adjunto?.fallido) return; // ya lo tenía: sólo se borra la fila
    const e = ((L.entrantes ??= {})[d.adj] ??= { n, ids: Array(n).fill(null) });
    if (e.n !== n) return;
    await fx.escribir(this.fTrozo(d.adj, i), JSON.stringify({ id: f.id, cifrado: f.cifrado }));
    e.ids[i] = f.id;
    if (e.ids.every(Boolean)) await this.ensamblar(d.adj, { nombre: nombreAdjunto(d.nombre), mime: d.mime, bytes, sha256: String(d.sha256) });
  }

          async ensamblar(id        , meta                                                                 ) {
    const fx = this.d.ficheros , { par, k } = this.canal ;
    const e = this.local.entrantes [id];
    const partes               = [];
    let ok = true;
    for (let i = 0; i < e.n && ok; i++) {
      try {
        const s = await fx.leer(this.fTrozo(id, i));
        const f = s ? JSON.parse(s) : null;
        const d = abrir                                         (k, { par, origen: "pc", id: f.id }, f.cifrado);
        if (d.adj !== id || d.i !== i) ok = false; else partes.push(de64(d.b64));
      } catch { ok = false; }
    }
    const total = partes.reduce((s, p) => s + p.length, 0);
    const datos = new Uint8Array(total);
    let o = 0;
    for (const p of partes) { datos.set(p, o); o += p.length; }
    ok = ok && total === meta.bytes && sha256hex(datos) === meta.sha256;
    if (ok) await fx.escribir(this.fArchivo(id), cifrarLocal(k, this.d.uid, par, { b64: b64(datos) }, this.d.rand));
    await fx.borrar(`mama-adj-entrada/${this.d.uid}/${id}`);
    delete this.local.entrantes [id];
    let m = this.local.historial.find((x) => x.adjunto?.id === id);
    if (!m) { // el mensaje con el nombre aún no ha llegado: se crea con los datos del trozo
      m = { id: `adj-${id}`, rol: "mama", texto: `📎 ${meta.nombre}`, at: this.iso(), via: "pc", nuevo: true, adjunto: { id, nombre: meta.nombre, mime: meta.mime, bytes: meta.bytes } };
      this.local.historial.push(m);
    }
    m.adjunto = { ...m.adjunto , sha256: meta.sha256, listo: ok, ...(ok ? {} : { fallido: true }) };
  }

  /** Borrado al entregarse: las filas de adjuntos ya guardadas en el móvil se borran de Supabase (RLS del dueño). */
          async borrarEntregadas() {
    const ids = this.local.borrar || [];
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += LOTE) {
      const { error } = await this.d.sb.from("mama_mensaje").delete().in("id", ids.slice(i, i + LOTE));
      this.falla(error); // red: la lista sigue guardada y se reintenta (borrar dos veces no hace daño)
    }
    this.local.borrar = [];
    await this.guardar();
  }

          async recibir() {
    const { par, k } = this.canal ;
    for (;;) {
      const { data, error } = await this.d.sb.from("mama_mensaje").select("id,seq,cifrado")
        .eq("par_id", par).eq("origen", "pc").gt("seq", this.local.cursor).order("seq", { ascending: true }).limit(LOTE);
      this.falla(error);
      const filas                                                 = data || [];
      if (!filas.length) return;
      const ya = new Set(this.local.historial.flatMap((m) => (m.eco ? [m.id, m.eco] : [m.id])));
      for (const f of filas) {
        if (ya.has(f.id)) continue; // reintento del PC: mismo id determinista
        try {
          const d = abrir                                                                                                         (k, { par, origen: "pc", id: f.id }, f.cifrado);
          if (d.rol === "adj") { await this.trozoEntrante(f, d); continue; } // T31: trozo de un archivo del PC
          if (!["antonio", "mama", "sistema"].includes(d.rol) || typeof d.texto !== "string") continue;
          const a = d.adjunto && UUID.test(String(d.adjunto.id)) ? d.adjunto : undefined;
          const marca = a ? this.local.historial.find((m) => m.adjunto?.id === a.id && m.via === "movil") : undefined;
          if (marca && d.rol === "antonio") { // T31: el PC guardó el archivo del móvil (eco con el nombre saneado)
            Object.assign(marca, { estado: "recibido"               , eco: f.id, adjunto: { ...marca.adjunto , nombre: nombreAdjunto(a .nombre) || marca.adjunto .nombre } });
            continue;
          }
          if (marca && a?.fallido) marca.estado = "rechazado"; // no se pudo guardar: el aviso del PC dice por qué
          const yaTrozos = a ? this.local.historial.find((m) => m.adjunto?.id === a.id && m.id === `adj-${a.id}`) : undefined;
          if (yaTrozos && !a .fallido) { Object.assign(yaTrozos, { id: f.id, rol: d.rol, texto: d.texto, at: typeof d.at === "string" ? d.at : yaTrozos.at }); continue; }
          const nota = typeof d.voz === "string" ? this.local.historial.find((m) => m.voz === d.voz && m.via === "movil") : undefined;
          if (nota && d.rol === "antonio") { // T30: la transcripción local sustituye al marcador de la nota
            Object.assign(nota, { texto: d.texto, estado: "recibido"               , transcrita: true, eco: f.id });
            continue;
          }
          if (nota && d.rol === "sistema") nota.estado = "rechazado"; // no se pudo transcribir: el aviso del PC dice por qué
          this.local.historial.push({
            id: f.id, rol: d.rol, texto: d.texto, at: typeof d.at === "string" ? d.at : this.iso(), via: "pc",
            ...(d.rol !== "antonio" ? { nuevo: true } : {}),
            ...(Array.isArray(d.inciertos) && d.inciertos.length ? { inciertos: d.inciertos.map(String) } : {}),
            ...(a && !a.fallido && TIPOS_ADJ[a.mime] ? { adjunto: { id: a.id, nombre: nombreAdjunto(a.nombre), mime: a.mime, bytes: Number(a.bytes) || 0, listo: false } } : {}),
          });
        } catch { /* sobre alterado o movido de fila: no se muestra */ }
      }
      this.local.cursor = filas[filas.length - 1].seq;
      this.local.historial.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      await this.guardar();
      if (filas.length < LOTE) return;
    }
  }

          async acuses() {
    const todos = this.local.historial.filter((m) => m.via === "movil" && m.estado === "enviado");
    let cambio = false;
    for (let i = 0; i < todos.length; i += LOTE) {
      const sin = todos.slice(i, i + LOTE);
      const { data, error } = await this.d.sb.from("mama_mensaje").select("id,recibido_en,error").in("id", sin.map((m) => m.id));
      this.falla(error);
      for (const r of data || []) {
        if (!r.recibido_en) continue;
        const m = sin.find((x) => x.id === r.id);
        if (m) { m.estado = r.error ? "rechazado" : "recibido"; cambio = true; }
      }
    }
    if (cambio) await this.guardar();
  }

          async latido() {
    const { data, error } = await this.d.sb.from("mama_pc").select("visto_en").limit(1);
    this.falla(error);
    const v = data?.[0]?.visto_en ? Date.parse(data[0].visto_en) : NaN;
    this.pcActivo = Number.isFinite(v) ? this.ahora() - v < PC_VIVO_MS : false;
  }
}
