# Spec — Backup CRM → Google Drive (gratis)

**Fecha:** 2026-09-04 · **VPS:** CX23 · **Cuenta:** gonzalojoel1@gmail.com (2TB)
**Objetivo:** copia diaria fuera del VPS de lo único irremplazable (BD CRM + archivos del site), $0 costo.

## Alcance
- **Backup diario:** `bench backup --with-files` del site `crm.marcosbarbosagroup.com` + `rclone copy` a Google Drive en carpeta `CRM-MarcosBarbosa-Backups/YYYY-MM-DD/`
- **Retención:** 30 días (carpetas viejas se eliminan solas)
- **Horario:** 03:30 America/Argentina/Cordoba (cron root del VPS)
- **Restauración:** script `restore.sh` con pasos manuales documentados

## Fuera de alcance
Backups de Dokploy/postgres interno, backups de la web (reconstruible desde git), Hetzner Backups (decisión del usuario: no pagar de momento).

## Diseño técnico
- **rclone** instalado en el VPS vía script oficial
- **Auth Google Drive:** flujo headless estándar — `rclone authorize "drive"` en la Mac del usuario (browser) → token pegado en `rclone.conf` del VPS. Scope `drive` (acceso total a la carpeta propia)
- **Script** `scripts/backup/backup-gdrive.sh`: 1) bench backup --with-files 2) detecta último par de archivos .sql.gz/.tar en private/backups 3) rclone copy a GDrive/fecha/ 4) limpia carpetas >30 días 5) log a /var/log/crm-backup.log
- **Idempotente:** si corre 2 veces el mismo día, sobrescribe la misma carpeta
- **Alertas mínimas:** log + código de salida; (fase 2: notificación WhatsApp/TG si falla)

## Riesgos
| Riesgo | Mitigación |
|---|---|
| Token de rclone expira (no debería: drive tokens sin expiración con refresh token) | test mensual manual; restore.sh documenta regeneración |
| Cron no corre (server caído a las 3:30) | corre a la siguiente ejecución; anacron no necesario |
| Quota Drive (2TB, uso actual bajo) | backups ~5-20MB/día comprimidos — despreciable |

## Criterio de éxito
1. Carpeta `CRM-MarcosBarbosa-Backups/<hoy>/` en Drive con .sql.gz + .tar visibles desde la web de Drive
2. Cron instalado (`crontab -l`) + log mostrando ejecución exitosa
3. `restore.sh` probado en seco (dry-run)
