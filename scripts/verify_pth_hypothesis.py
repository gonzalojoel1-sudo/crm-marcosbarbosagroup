import sys
# Hypothesis: the .pth should point to the PARENT (apps/crm_core), not apps/crm_core/crm_core
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core")
try:
    import crm_core
    print("PARENT path -> OK:", crm_core.__file__)
    import crm_core.mbcrm.doctype.task.task as m
    print("mbcrm.doctype.task.task -> OK:", m.Task)
except Exception as e:
    print("PARENT path -> FAIL:", type(e).__name__, e)

# Counter-check: the WRONG path (what I had)
for i in sys.path[:]:
    if "crm_core/crm_core" in i:
        sys.path.remove(i)
sys.path.insert(0, "/home/frappe/frappe-bench/apps/crm_core/crm_core")
try:
    import crm_core as cc2
    print("SUB path -> OK:", cc2.__file__)
except Exception as e:
    print("SUB path -> FAIL (as expected):", type(e).__name__, e)
