import subprocess
paths = subprocess.run(["grep", "-rln", "JinjaLoader",
    "/home/frappe/frappe-bench/apps/frappe/frappe/"],
    capture_output=True, text=True).stdout.strip().splitlines()
print("FILES:", paths)

import frappe, inspect
try:
    j = frappe.get_jloader()
    print("jloader class:", type(j))
    print("jloader file:", inspect.getsourcefile(type(j)))
    src = inspect.getsource(type(j))
    print("---- source ----")
    print(src[:2500])
except Exception as e:
    print("ERR:", e)
