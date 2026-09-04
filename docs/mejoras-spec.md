# Spec — Mejoras del sistema (solo evidencia, cero inventos)

**Fecha:** 2026-09-04 · **Alcance:** VPS CX23 + Web + CRM · **Regla:** cada mejora tiene evidencia medida, riesgo de implementación acotado y plan de rollback. Nada especulativo.

## Auditoría de estado (medida 2026-09-04)

| Área | Estado medido |
|---|---|
| Firewall UFW | **INACTIVO** — host expone todos los puertos |
| SSH | `passwordauthentication yes` — root accesible por fuerza bruta |
| fail2ban | **NO instalado** |
| Backup Drive | ✅ corriendo (última: hoy 15:30 OK) pero **sin alerta si falla** |
| Sync Calendar | ✅ corriendo cada 1 min |
| Swap | **1.7GB usados de 4GB** — presión de RAM sostenida (dato objetivo para resize) |
| Disco | **59% (21G/38G)** — creció del 29% en 1 día (imágenes Docker del build) |
| RAM disponible | 1.5Gi — estable |
| SMTP CRM | No configurado → el CRM no envía emails (welcome, notificaciones, reset passwords) |
| Test de restauración | Nunca ejecutado (script existe) |
| Leads fallback | `leads.jsonl` sin proceso de re-importación al CRM si hubo outage |
| Web v1.1 backlog | OG dinámico, JSON-LD, skip-link, Docker 226MB→slim (del final-review del proyecto web) |
| Idioma | Strings hardcodeados Vue minoritarios en inglés |
| Higiene | 1 lead de prueba en CRM, passwords iniciales sin cambiar, sin 2FA |

---

## F1 — Seguridad del server (gratis · riesgo BAJO · ~30 min)
**Evidencia:** firewall inactivo + password SSH habilitado + sin fail2ban = superficie de ataque real.
1. **UFW:** deny incoming, allow 22 (limitado), 80, 443. Verificar antes que Traefik y swarm no usen otros puertos (el routing mesh es interno).
2. **fail2ban** con jail sshd (5 intentos → ban 1h).
3. **SSH sin password:** `PasswordAuthentication no` — SOLO después de confirmar que la key de la Mac funciona (si se rompe, Hetzner console tiene acceso de emergencia → rollback 1 línea).
**Rollback:** cada cambio es 1 línea reversible por consola Hetzner.

## F2 — Limpieza de disco + monitoreo (gratis · riesgo BAJO · ~20 min)
**Evidencia:** disco al 59% y subiendo; imágenes Docker del build + dangling layers.
1. `docker system prune -af` + builder cache → libera varios GB (verificado: el build de crm-mb dejó ~8-10GB de cache).
2. **Alerta si backup/sync fallan:** ping diario a healthchecks.io (gratis, sin cuenta compleja) o ntfy.sh → notificación push al celu si no llega el ping a las 4:00. Sin SMTP necesario.
3. Umbral de disco: alerta al 80%.

## F3 — Higiene de cuentas (gratis · riesgo NULO · ~10 min, lo hace el usuario)
**Evidencia:** passwords iniciales entregadas por chat; sin 2FA.
1. Cambiar passwords de Administrator, joel@, marcos@ (cada uno la suya).
2. Activar 2FA (Frappe: TOTP nativo en My Settings) para los 3 usuarios.
3. Borrar lead de prueba `CRM-LEAD-2026-00004`.

## F4 — SMTP del CRM (gratis · requiere decisión del usuario · ~20 min)
**Evidencia:** el CRM no puede enviar welcome emails, notificaciones de leads asignados ni resets de password.
1. Crear **App Password** de Google para `consultora.marcosbarbosa@gmail.com` (usuario lo hace: myaccount.google.com → Seguridad → Contraseñas de aplicación).
2. Frappe → Email Account → Gmail IMAP+SMTP con esa app password → "Default Outgoing" + notificaciones a joel@/marcos@ cuando entra un lead nuevo.
**Decisión requerida:** qué casilla envía los emails del CRM (propuesta: consultora.marcosbarbosa@gmail.com).

## F5 — Test de restauración real (gratis · riesgo MEDIO controlado · ~40 min)
**Evidencia:** el script `restore-gdrive.sh` nunca se probó; un backup no probado no es un backup.
1. Crear site temporal `restore-test.marcosbarbosagroup.com` (nuevo site en el mismo bench, apuntado a la MISMA BD MaríaDB del stack).
2. Restaurar el backup de ayer desde Drive → verificar leads/usuarios → borrar site de test.
3. Documentar resultado en runbook. **No toca producción** (site aparte).

## F6 — Web v1.1 backlog (gratis · riesgo BAJO · ~2h)
**Evidencia:** final-review del proyecto web (documentado).
1. JSON-LD Organization/Person + OG image estática decente (1h)
2. Docker slim: `output: standalone` ya está; imagen 226MB→~90MB con `--omit=dev` en build final (30 min)
3. Skip-link accesibilidad (10 min)

## F7 — WhatsApp Business en el CRM (REQUIERE DECISIÓN · ~1-2h + costo API)
**Evidencia:** el brochure promete WhatsApp; frappe_whatsapp app es oficial del ecosistema.
Necesita: Meta Business + WhatsApp Cloud API (gratis hasta cierto volumen, requiere verificación de Meta). Diferir hasta que Marcos confirme volumen de uso.

## F8 — Resize CX33 (CUANDO TOQUE · +€4/mes)
**Evidencia:** swap en 1.7GB con 2 usuarios. Criterio del spec: sostenido >500MB = resize. Ya se superó → **recomendado hacer en la próxima facturación mensual o antes de sumar ERPNext/3er usuario**. Dato: hoy funciona, pero cualquier pico (migración, import) va a swap.

---

## Orden de ejecución propuesto
**Hoy (gratis, bajo riesgo): F1 → F2 → F3** · **F4 si decidís el email** · **F6 mañana** · F5/F7/F8 según necesidad.

## Lo que NO se hace (explícito)
- Multitenancy, ERPNext, portal de clientes: requieren decisiones de negocio, no son "mejoras técnicas"
- Cambios al frontend del CRM (fork de Vue): rompería actualizaciones, prohibido por este spec
- Migrar CRM a gestión por Dokploy UI: funciona por SSH, el cambio no aporta valor real
