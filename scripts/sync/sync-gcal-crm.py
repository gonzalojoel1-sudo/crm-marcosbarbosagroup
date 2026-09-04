#!/usr/bin/env python3
# Sync Google Calendar (agendas/reservas) -> Frappe CRM
# Cron: * * * * *  (cada minuto) - corre en el VPS
# Estado: /var/lib/crm-gcal-sync/processed.json (event ids ya sincronizados)
import json, os, time, urllib.parse, urllib.request

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

# lock simple para no solapar corridas
try:
    fd = os.open(LOCK, os.O_CREAT | os.O_EXCL)
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

    created, skipped = 0, 0
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
        lead = {
            "first_name": name.split(" ")[0], "last_name": " ".join(name.split(" ")[1:]) or "-",
            "email": email, "mobile_no": guest.get("phoneNumber", "") or "",
            "source": "Agenda Reunión", "notes": f"Reunión agendada: {summary}\nCuando: {start}\nEventId: {eid}",
            "custom_meeting_datetime": start, "custom_event_id": eid,
        }
        crm_create_lead(lead)
        created += 1
        processed.add(eid)
        print(f"[{time.strftime('%F %T')}] lead creado: {email} ({summary} @ {start})")

    json.dump(sorted(processed), open(STATE, "w"))
    print(f"[{time.strftime('%F %T')}] sync ok - creados: {created}, ya vistos: {skipped}")
finally:
    os.unlink(LOCK)
