// GENERADO por tools/mama-web-canal.mjs desde focogravital/APP/src/mama/cripto.ts (último cambio fae0381). NO EDITAR AQUÍ:
// se cambia en el APP y se regenera; test/mama-web-canal.test.js falla si divergen.
// MAMA T11 · extremo MÓVIL del canal cifrado. Contrato: E:\ECOAPP\CEOPadre\knowledge\mama\CANAL-T10.md (§3 y §4).
// Funciones puras con @noble (JS auditado, MIT): el aleatorio se inyecta (en la app, expo-crypto; en pruebas, node:crypto),
// así no dependen de globales de Hermes (crypto, TextEncoder/TextDecoder, atob/btoa).
import { chacha20poly1305 } from "../noble/ciphers/chacha.js";
import { x25519 } from "../noble/curves/ed25519.js";
import { hkdf } from "../noble/hashes/hkdf.js";
import { hmac } from "../noble/hashes/hmac.js";
import { scryptAsync } from "../noble/hashes/scrypt.js";
import { sha256 } from "../noble/hashes/sha2.js";

                                                  
                                    

export const TEXTO_MAX = 4000;
const CIFRADO = /^c1\.[A-Za-z0-9+/]+={0,2}$/;
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------- utilidades sin globales

export function utf8(s        )             {
  const out           = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function deUtf8(b            )         {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    const n = x < 0x80 ? 1 : x >= 0xf0 ? 4 : x >= 0xe0 ? 3 : x >= 0xc0 ? 2 : 0;
    if (!n || i + n > b.length) throw new Error("utf8");
    let c = n === 1 ? x : x & (0xff >> (n + 1));
    for (let j = 1; j < n; j++) {
      if ((b[i + j] & 0xc0) !== 0x80) throw new Error("utf8");
      c = (c << 6) | (b[i + j] & 63);
    }
    s += String.fromCodePoint(c);
    i += n;
  }
  return s;
}

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** T31: huella SHA-256 en hexadecimal (la misma que el PC guarda y comprueba en src/mama-adjuntos.js). */
export function sha256hex(b            )         {
  return Array.from(sha256(b), (x) => x.toString(16).padStart(2, "0")).join("");
}
export function b64(b            )         {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63];
    s += i + 1 < b.length ? ABC[(n >> 6) & 63] : "=";
    s += i + 2 < b.length ? ABC[n & 63] : "=";
  }
  return s;
}
export function de64(s        )             {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) throw new Error("base64");
  const limpio = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let bits = 0, acc = 0, o = 0;
  for (const ch of limpio) {
    acc = (acc << 6) | ABC.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

const hex = (b            ) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function uuid4(rand           )         {
  const h = rand(16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = hex(h);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const iguales = (a            , b            ) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; // tiempo constante
  return d === 0;
};

// ---------------------------------------------------------------- emparejamiento (§3)

/** Normaliza el código como lo hace el PC: mayúsculas, sin espacios ni guiones, O→0, I/L→1. */
export const normalizarCodigo = (c        ) =>
  String(c || "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
export const codigoValido = (c        ) => /^[0-9A-HJKMNP-TV-Z]{10}$/.test(normalizarCodigo(c));

                                                                                                              

/** MAC de la petición, recalculable desde lo custodiado para reenviar EXACTAMENTE la misma fila. */
export const macMovil = (p              ) =>
  b64(hmac(sha256, de64(p.kc), utf8(`mama-par-v1|movil|${p.par}|${p.pubMovil}`)));

/** Petición del móvil: lo que se inserta en `mama_par` y lo que hay que custodiar hasta la respuesta del PC. */
export async function solicitarPar(codigo        , rand           ) {
  const par = uuid4(rand);
  const kc = await scryptAsync(utf8(normalizarCodigo(codigo)), utf8(`mama-par-v1|${par}`), { N: 16384, r: 8, p: 1, dkLen: 32 });
  const sk = rand(32);
  const pubMovil = b64(x25519.getPublicKey(sk));
  const macMovil = b64(hmac(sha256, kc, utf8(`mama-par-v1|movil|${par}|${pubMovil}`)));
  const pendiente               = { par, sk: b64(sk), kc: b64(kc), pubMovil };
  sk.fill(0);
  return { fila: { id: par, pub_movil: pubMovil, mac_movil: macMovil }, pendiente };
}

/** Respuesta del PC → clave del canal K. Lanza si el MAC no cuadra (posible suplantación) o el secreto es nulo. */
export function terminarPar(p              , pubPc        , macPc        )             {
  if (!B64_32.test(pubPc || "") || !B64_32.test(macPc || "")) throw new Error("respuesta del PC con formato inválido");
  const kc = de64(p.kc);
  const esperado = hmac(sha256, kc, utf8(`mama-par-v1|pc|${p.par}|${p.pubMovil}|${pubPc}`));
  if (!iguales(esperado, de64(macPc))) throw new Error("respuesta del PC no autenticada");
  const sk = de64(p.sk);
  const compartido = x25519.getSharedSecret(sk, de64(pubPc));
  sk.fill(0);
  try {
    if (compartido.every((x) => x === 0)) throw new Error("clave pública de orden bajo");
    return hkdf(sha256, compartido, kc, utf8(`mama-canal-v1|${p.par}|${p.pubMovil}|${pubPc}`), 32);
  } finally { compartido.fill(0); kc.fill(0); }
}

// ---------------------------------------------------------------- sobres (§4)

                                                                  
const aad = ({ par, origen, id }      ) => utf8(`mama-c1|${par}|${origen}|${id}`);

export function sellar(k            , f      , datos         , rand           )         {
  const nonce = rand(12);
  const ct = chacha20poly1305(k, nonce, aad(f)).encrypt(utf8(JSON.stringify(datos)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce); out.set(ct, 12);
  return `c1.${b64(out)}`;
}
export function abrir         (k            , f      , s        )    {
  if (!CIFRADO.test(String(s))) throw new Error("formato");
  const raw = de64(String(s).slice(3));
  if (raw.length < 29) throw new Error("formato");
  return JSON.parse(deUtf8(chacha20poly1305(k, raw.subarray(0, 12), aad(f)).decrypt(raw.subarray(12))));
}

// ---------------------------------------------------------------- almacén local cifrado (historial y cola en el móvil)
// Mismo algoritmo con otra AAD: un sobre local no se confunde con uno del canal, ni con el de otro usuario o emparejamiento.
const aadLocal = (uid        , par        ) => utf8(`mama-local-v1|${uid}|${par}`);
export function cifrarLocal(k            , uid        , par        , datos         , rand           )         {
  const nonce = rand(12);
  const ct = chacha20poly1305(k, nonce, aadLocal(uid, par)).encrypt(utf8(JSON.stringify(datos)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce); out.set(ct, 12);
  return `l1.${b64(out)}`;
}
export function descifrarLocal         (k            , uid        , par        , s        )    {
  if (!String(s).startsWith("l1.")) throw new Error("formato");
  const raw = de64(String(s).slice(3));
  return JSON.parse(deUtf8(chacha20poly1305(k, raw.subarray(0, 12), aadLocal(uid, par)).decrypt(raw.subarray(12))));
}
