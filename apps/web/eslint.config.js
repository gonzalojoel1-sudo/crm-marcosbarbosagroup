// ESLint de la agenda (y del resto de `apps/web`).
//
// Antes de este archivo (2026-09-26) el repo NO tenía linter de TypeScript: 26
// archivos .tsx/.ts, ~2.900 líneas, y el único `lint` era stylelint sobre
// `src/agenda/**/*.module.css` más el chequeo estático de fidelidad. O sea que
// hooks mal usados, `any` implícitos y deps de `useEffect` Podían entrar sin que
// nada los viera.
//
// Configuración MÍNIMA a propósito: sólo lo que puede ponerse en rojo sin generar
// ruido. Lo que queda en `warn` está pedido con su motivo; nada se apagó en
// silencio.
//
//  · `recommended` de typescript-eslint. Los `any` explícitos quedan en `warn`, no en
//    `error`: el repo los usa a propósito en los bordes de la API (ver `api.ts`) y
//    promoverlos sería cambiar el contrato, no mejorar el linter.
//  · `react-hooks` en `recommended`, en `error`: las reglas de hooks (orden,
//    dependencias, purity) y la de "setState en render" son bugs de estado, no
//    cuestiones de estilo.
//  · `react-refresh` en `warn`: avisa si un módulo exporta algo que no es un
//    componente, la causa típica del fast-refresh que no recarga.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "*.mjs", "_type-smoke.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Hooks en `error`: un `useEffect` con las dependencias equivocadas o un
      // `setState` en el render son bugs de estado, no cuestiones de estilo.
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      // Los `any` explícitos quedan en warn: en `api.ts` y en el mapper de DTO son
      // deliberados (el backend manda la forma y el DTO la-normaliza). Promoverlos
      // a error sería cambiar el contrato, no mejorar el linter.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // El `catch {}` sin binding es intencionado en varios lugares: no usar la
      // excepción no es un error.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Los tests y el shell de E2E usan APIs de Node y variables de Playwright que
    // no están en el set de arriba.
    files: ["e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
