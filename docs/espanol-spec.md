# Spec — CRM 100% Español

**Fecha:** 2026-09-04 · **Site:** crm.marcosbarbosagroup.com · **Idioma sistema:** es ✅

## 1. Problema (medido)
Frappe CRM `es.po`: **1107 de 1782 strings sin traducir (62%)**. El frontend Vue los muestra en inglés vía `__()` → `translated_messages` (inyectado por `crm/www/crm.py:get_messages_for_boot()`).

## 2. Mecanismo de traducción (verificado)
- Backend: frappe fusiona `crm/locale/es.po` + registros del doctype **Translation** (BD) → payload `translated_messages` en la página del CRM
- Frontend Vue: `__()` busca en `translatedMessages` (translation.js) → fallback inglés
- **Doctype Translation = persistente en volumen (BD)** → sobrevive redeploys sin rebuild de imagen. Mecanismo elegido.

## 3. Solución
1. Extraer los 1107 msgid vacíos → traducir al español con prioridad:
   - **P0 (obligatorio):** UI visible al usuario — navegación, botones, tabs, acciones, formularios, Kanban, mensajes comunes (~500-700 strings)
   - **P1:** mensajes de error/API/admin (~200-400)
   - **P2 (quedan en inglés, documentado):** strings dev-only, placeholders sin uso, formatos de fecha en inglés duros
2. Insertar por lotes en doctype `Translation` (lang=es) vía bench console
3. `bench clear-cache` + verificación del payload
4. `User.language = es` explícito para Administrator, joel@, marcos@
5. Limitación documentada: strings hardcoded en Vue sin `__()` no son traducibles por este mecanismo (requeriría fork del frontend)

## 4. Reglas de traducción
- Preservar placeholders `{0}` `{1}` EXACTOS
- Preservar `\n` y puntuación final
- Tono: vos/tuteo argentino profesional consistente con el sitio (ej: "Guardar", "Crear cliente", "Eliminar")
- Términos CRM: Lead=Lead/Oportunidad→"Lead", Deal="Negocio" (negociable: "Trato"), Task="Tarea", Note="Nota"

## 5. Riesgos
| Riesgo | Mitigación |
|---|---|
| Traducción rompe placeholders | Verificación programática: {N} del msgid presentes en msgstr |
| Duplicados en Translation doctype | Check `frappe.db.exists` antes de insertar |
| Cache stale | `bench clear-cache` tras insertar |
| Colisión con futuro update de crm app | Translation doctype tiene prioridad sobre po; si un update trae traducciones oficiales, las DB ganan (comportamiento estándar frappe) |

## 6. Criterio de éxito
- Payload `translated_messages` del sitio contiene los strings P0 en español
- Usuario ve UI en español al recargar (verificación visual del usuario)
- Sin errores en bench/console tras clear-cache

## Ejecución (2026-09-04)
- 512 traducciones insertadas en doctype Translation (persisten en volumen BD)
- Campos del doctype en v15.120: `source_text` / `translated_text` (NO source_data/translated de v14)
- Cache de traducciones: `frappe.translate.clear_cache()` (el clear_cache general NO limpia esta clave hget)
- User.language = es explícito para Administrator, joel@, marcos@
- Verificado: `get_all_translations("es")` → 7090 pares, 6/6 checks P0
- Backup de las traducciones: `docs/translations-es.json`
- Limitación conocida: strings hardcodeados en Vue sin `__()` siguen en inglés (minoritarios)
