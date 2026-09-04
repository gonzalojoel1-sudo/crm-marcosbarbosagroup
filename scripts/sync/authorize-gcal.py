#!/usr/bin/env python3
# One-time: obtener refresh token con scope calendar.readonly
# Uso (en la Mac): python3 authorize-gcal.py <client_id> <client_secret>
import base64, http.server, json, sys, threading, urllib.parse, urllib.request, webbrowser

CLIENT_ID, CLIENT_SECRET = sys.argv[1], sys.argv[2]
PORT = 53683
SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
REDIRECT = f"http://127.0.0.1:{PORT}"
auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
    "client_id": CLIENT_ID, "redirect_uri": REDIRECT, "response_type": "code",
    "scope": SCOPE, "access_type": "offline", "prompt": "consent"})
code_holder = {}

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if not code_holder.get("code"): code_holder["code"] = q.get("code", [""])[0]
        self.send_response(200); self.end_headers()
        self.wfile.write("<h1>Autorizado! Cerrá esta pestaña.</h1>".encode("utf-8"))
    def log_message(self, *a): pass

srv = http.server.HTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
print("Abriendo browser para autorizar con gonzalojoel1@gmail.com ...")
webbrowser.open(auth_url)
print(f"Si no abre, entrá manualmente a:\n{auth_url}")
for _ in range(300):
    if code_holder.get("code"): break
    import time; time.sleep(1)
srv.shutdown()

data = urllib.parse.urlencode({
    "code": code_holder["code"], "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT, "grant_type": "authorization_code"}).encode()
try:
    tok = json.loads(urllib.request.urlopen("https://oauth2.googleapis.com/token", data).read())
except urllib.error.HTTPError as e:
    print("GOOGLE ERROR BODY:", e.read().decode())
    raise
print("\nREFRESH_TOKEN:", tok.get("refresh_token"))
print("\n(Si refresh_token viene vacio, reejecutar con prompt=consent - ya esta asi)")
