// Región viva única y PERSISTENTE. Se monta una sola vez en `document.body`,
// fuera de cualquier subárbol que React re-renderice: en el prototipo el nodo
// vivía dentro de `render()` y el anuncio se perdía al repintar. Acá el nodo no
// lo administra React, así que sobrevive a todos los re-renders.
let node: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (node && node.isConnected) return node;
  const existente = document.getElementById("agx-announcer");
  if (existente) {
    node = existente;
    return node;
  }
  node = document.createElement("div");
  node.id = "agx-announcer";
  node.className = "sr-only";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-atomic", "true");
  document.body.appendChild(node);
  return node;
}

// Limpiar y reescribir en el frame siguiente hace que un mensaje idéntico
// repetido se vuelva a leer.
export function announce(text: string): void {
  const a = ensure();
  a.textContent = "";
  requestAnimationFrame(() => {
    a.textContent = text;
  });
}
