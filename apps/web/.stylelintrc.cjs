// D1 — los valores de la agenda salen de tokens.css. Estas reglas fallan el build
// para cualquier literal de color, familia, radio, easing o sombra donde el :root
// del prototipo YA define un token. Los `px` en sí son legítimos: los tokens son px.
//
// EXCEPCIONES (el prototipo NO define token para ellas; están listadas en la spec,
// D1): #fff, #141417, los rgba de grilla/sombra/hover, los radios
// 3/4/5/6/7/8/9/10/14px, 50% y 999px, y las sombras bespoke del bloque y del foco.
// No hay excepciones ocultas: lo que no esté acá falla.

// Hex del prototipo sin token (`--display`/paleta no cubren blanco puro ni #141417).
const HEX_SIN_TOKEN = "/#(?!(?:fff|141417)\\b)[0-9a-f]{3,8}\\b/i";
// Colores-función del prototipo sin token. El lookahead deja pasar exactamente
// estos argumentos; cualquier otro rgb()/rgba()/hsl()/hsla() falla.
const RGB_SIN_TOKEN = [
  "0, 0, 0, 0.85",
  "0, 0, 0, 0.38",
  "255, 90, 90, 0.2",
  "255, 255, 255, 0.05",
  "255, 255, 255, 0.09",
  "255, 255, 255, 0.16",
  "255, 255, 255, 0.55",
  "244, 241, 234, 0.022",
  "244, 241, 234, 0.12",
  "254, 65, 0, 0.055",
];
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FUNCIONES_SIN_TOKEN = `/(?:rgba?|hsla?)\\((?!(?:${RGB_SIN_TOKEN.map(escapar).join("|")})\\))[^)]*\\)/`;

// Radios del prototipo sin token (el único tokenizado es --r = 12px).
const RADIOS_SIN_TOKEN =
  "/^(?:0|3px|4px|5px|6px|7px|8px|9px|10px|14px|50%|999px|0 0 9px 9px|none)$/";

// Sombras sin token: bloque, foco, fantasma e inset de la celda de hoy. La única
// sombra tokenizada es --shadow.
const SOMBRAS_SIN_TOKEN = [
  "none",
  "0 0 0 4px rgba(0, 0, 0, 0.85)",
  "inset 0 0 0 1px var(--accent-line)",
  "inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 2px 6px rgba(0, 0, 0, 0.38)",
  "inset 0 2px 0 var(--accent)",
];

module.exports = {
  rules: {
    "declaration-property-value-disallowed-list": {
      // Los colores pueden aparecer en cualquier propiedad: color, background,
      // border-color, box-shadow, custom properties…
      "/.+/": [HEX_SIN_TOKEN, FUNCIONES_SIN_TOKEN],
      // `--ease` es el token de easing; un `ease`/`linear`/`cubic-bezier` suelto falla.
      transition: ["/(?<!var\\(--)(?:ease|linear|cubic-bezier)/"],
    },
    "declaration-property-value-allowed-list": {
      // Toda familia sale de `--display`/`--mono` (o `inherit`).
      "font-family": ["inherit", "var(--display)", "var(--mono)"],
      // Un radio crudo solo se acepta si está en la lista de no-tokenizados.
      "border-radius": ["inherit", "/var\\(/", RADIOS_SIN_TOKEN],
      "box-shadow": ["/var\\(--shadow\\)/", ...SOMBRAS_SIN_TOKEN],
    },
  },
};
