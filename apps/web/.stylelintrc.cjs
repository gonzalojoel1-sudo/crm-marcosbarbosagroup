// Guarda de tokens de la agenda (spec D1). Falla el build (severity error) para
// cualquier valor crudo donde ya hay un token. Los `px` son legítimos: los
// tokens son px, así que no se tocan.
//
// Dos literales de color del prototipo todavía no tienen token: `#fff` (texto
// sobre bloque sólido, index.html:207) y `#141417` (base del color-mix del
// fantasma, index.html:1679). `#a0431c` es el fallback muerto que Task 5 borra.
// Se exceptúan por valor; cualquier otro hex (p. ej. `#ff0000`) falla.
const HEX_SIN_TOKEN = "/#(?!(?:fff|a0431c|141417)\\b)/i";

module.exports = {
  rules: {
    "declaration-property-value-disallowed-list": {
      "/.+/": [HEX_SIN_TOKEN],
      // `--r` es el único radio tokenizado (12px); el resto (9px, 8px, 999px…)
      // no tiene token.
      "border-radius": ["/\\b12px\\b/"],
      // `--ease` es el token de easing; un `ease`/`linear`/`cubic-bezier` suelto
      // falla. El lookbehind deja pasar `var(--ease)`.
      transition: ["/(?<!var\\(--)(?:ease|linear|cubic-bezier)/"],
    },
    "declaration-property-value-allowed-list": {
      // Toda familia sale de `--display`/`--mono` (o `inherit`).
      "font-family": ["inherit", "var(--display)", "var(--mono)"],
    },
  },
};
