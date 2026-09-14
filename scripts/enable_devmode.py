import json, os
site = os.environ.get("FRAPPE_SITE", "crm-test")
sites = "/home/frappe/frappe-bench/sites"
p = f"{sites}/{site}/site_config.json"
c = json.load(open(p))
c["developer_mode"] = 1
json.dump(c, open(p, "w"), indent=2)
print("developer_mode = 1 added to", p)
