// Base64 <-> texto UTF-8. btoa/atob solo entienden Latin-1, así que
// pasamos por bytes con TextEncoder/TextDecoder para no romper acentos ni eñes.

export function utf8ABase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

export function base64AUtf8(b64: string): string {
  const binario = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
