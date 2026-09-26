#!/usr/bin/env python3
# Sync Google Calendar (agendas/reservas) -> Frappe CRM
# Cron: * * * * *  (cada minuto) - corre en el VPS
# v2: crea tabEvent además de CRM Lead (compatible con crm_core S2)
# Estado: /var/lib/crm-gcal-sync/processed.json (event ids ya sincronizados)
import json, os, sys, time, urllib.parse, urllib.request

CFG = json.load(open("/etc/crm-gcal-sync/config.json"))
STATE_DIR = "/var/lib/crm-gcal-sync"
STATE = os.path.join(STATE_DIR, "processed.json")
LOCK = "/tmp/crm-gcal-sync.lock"

def api(method, url, data=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=headers or {}, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=20).read())

def get_access_token():
    data = urllib.parse.urlencode({
        "client_id": CFG["client_id"], "client_secret": CFG["client_secret"],
        "refresh_token": CFG["refresh_token"], "grant_type": "refresh_token"}).encode()
    tok = json.loads(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=data, timeout=20).read())
    return tok["access_token"]

def crm_create_lead(payload):
    return api("POST", f"{CFG['crm_url']}/api/resource/CRM%20Lead", {"data": json.dumps(payload)},
        {"Content-Type": "application/json", "Authorization": f"token {CFG['api_key']}:{CFG['api_secret']}"})

def crm_create_event(payload):
    return api("POST", f"{CFG['crm_url']}/api/resource/Event", {"data": json.dumps(payload)},
        {"Content-Type": "application/json", "Authorization": f"token {CFG['api_key']}:{CFG['api_secret']}"})

# Find existing CRM Lead by email (for linking Event -> Lead via custom_crm_lead)
def find_lead_by_email(email):
    """Look up lead by email via REST API."""
    try:
        r = api("GET",
                f"{CFG['crm_url']}/api/resource/CRM%20Lead?filters=" + urllib.parse.quote(json.dumps([["email", "=", email]])) + "&limit_page_length=1",
                headers={"Authorization": f"token {CFG['api_key']}:{CFG['api_secret']}"})
        if r.get("data"):
            return r["data"][0]["name"]
    except Exception:
        pass
    return None

# Find existing Event by google_calendar_event_id
def find_event_by_gcal_id(gcal_id):
    try:
        r = api("GET",
                f"{CFG['crm_url']}/api/resource/Event?filters=" + urllib.parse.quote(json.dumps([["google_calendar_event_id", "=", gcal_id]])) + "&limit_page_length=1",
                headers={"Authorization": f"token {CFG['api_key']}:{CFG['api_secret']}"})
        if r.get("data"):
            return r["data"][0]["name"]
    except Exception:
        pass
    return None

# lock simple para no solapar corridas
try:
    fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode())
except FileExistsError:
    sys.exit(0)

try:
    processed = set(json.load(open(STATE))) if os.path.exists(STATE) else set()
    os.makedirs(STATE_DIR, exist_ok=True)

    tok = get_access_token()
    hdr = {"Authorization": f"Bearer {tok}"}
    import datetime
    now = datetime.datetime.utcnow()
    time_min = (now - datetime.timedelta(days=CFG.get("lookback_days", 7))).strftime("%Y-%m-%dT%H:%M:%SZ")
    time_max = (now + datetime.timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")

    events = api("GET", "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + urllib.parse.urlencode({
        "timeMin": time_min, "timeMax": time_max, "singleEvents": "true", "maxResults": 250,
        "eventTypes": "default", "orderBy": "updated"}), headers=hdr)

    created_leads, created_events, skipped = 0, 0, 0
    for ev in events.get("items", []):
        eid = ev["id"]
        if eid in processed: skipped += 1; continue
        summary = ev.get("summary", "")
        # solo eventos de la agenda (title del booking) con invitados
        if CFG.get("title_filter") and CFG["title_filter"].lower() not in summary.lower(): processed.add(eid); continue
        attendees = [a for a in ev.get("attendees", []) if not a.get("self") and not a.get("organizer")]
        if not attendees: processed.add(eid); continue
        guest = attendees[0]
        email = guest.get("email", "")
        name = guest.get("displayName") or email.split("@")[0].replace(".", " ").title()
        start = ev.get("start", {}).get("dateTime", ev.get("start", {}).get("date", ""))
        end = ev.get("end", {}).get("dateTime", ev.get("end", {}).get("date", ""))
        start_dt = start[:19].replace("T", " ") if start else ""
        end_dt = end[:19].replace("T", " ") if end else start_dt

        # 1) Create CRM Lead (for tracking)
        lead_name_field = name.split(" ")[0]
        last_name = " ".join(name.split(" ")[1:]) or "-"
        lead_payload = {
            "first_name": lead_name_field, "last_name": last_name,
            "email": email, "mobile_no": guest.get("phoneNumber", "") or "",
            "source": "Agenda Reunión", "notes": f"Reunión agendada: {summary}\nCuando: {start}\nEventId: {eid}",
            "custom_meeting_datetime": start_dt, "custom_event_id": eid,
        }
        try:
            crm_create_lead(lead_payload)
            created_leads += 1
        except Exception as ex:
            print(f"[{time.strftime('%F %T')}] WARN lead create: {ex}")

        # 2) Create or update tabEvent (linked to Lead)
        existing_event = find_event_by_gcal_id(eid)
        crm_lead = find_lead_by_email(email)

        if existing_event:
            # Skip - already synced (in future: update if gcal_updated changed)
            processed.add(eid)
            continue

        # Determine category heuristically from summary
        summary_lower = summary.lower()
        if any(k in summary_lower for k in ["ministerio", "iglesia"]):
            categoria = "Ministerial"
        elif any(k in summary_lower for k in ["software", "app", "demo", "web"]):
            categoria = "Software"
        elif any(k in summary_lower for k in ["constructora", "kruger", "agenda marcos", "consulta"]):
            categoria = "Consultora"
        elif any(k in summary_lower for k in ["personal", "block", "profundo"]):
            categoria = "Personal"
        else:
            categoria = "Trabajo"

        event_payload = {
            "subject": summary,
            "starts_on": start_dt,
            "ends_on": end_dt,
            "all_day": 0,
            "google_calendar_event_id": eid,
            "custom_crm_lead": crm_lead,
            "custom_crm_categoria": categoria,
            "custom_sync_estado": "Sincronizada",
        }
        try:
            crm_create_event(event_payload)
            created_events += 1
        except Exception as ex:
            print(f"[{time.strftime('%F %T')}] WARN event create: {ex}")

        processed.add(eid)
        print(f"[{time.strftime('%F %T')}] synced: {summary} @ {start} (lead={email}, event=created)")

    json.dump(sorted(processed), open(STATE, "w"))
    print(f"[{time.strftime('%F %T')}] sync ok - leads: {created_leads}, events: {created_events}, ya vistos: {skipped}")
finally:
    os.unlink(LOCK)
