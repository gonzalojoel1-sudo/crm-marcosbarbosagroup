// E2E del embudo: presupuesto (ítems + total) y conversión de lead a negocio.
// Temporal: se borra al terminar (la limpieza de datos la hace scripts/_clean.py).
const BASE = "https://crm.marcosbarbosagroup.com";
const TOKEN = process.env.TOKEN;

async function call(method, body) {
  const r = await fetch(`${BASE}/api/method/crm_core.api.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${TOKEN}`,
      "X-Frappe-CSRF-Token": "x",
    },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t).message;
}
async function get(method, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}/api/method/crm_core.api.${method}?${qs}`, {
    headers: { Authorization: `token ${TOKEN}` },
  });
  return (await r.json()).message;
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "OK  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);

const res = { deals: [] };

// 1. Estado base: todos los leads visibles
const before = await get("get_deals", {});
ok("leads sin negocio listados", Array.isArray(before.leads), `(${before.leads.length} leads)`);
ok("etapas en orden", before.stages.length === 9, before.stages.join(" → "));

// 2. Crear negocio de prueba
const deal = await call("create_deal", { title: "ZZ Prueba Embudo", contact: "Ana Test" });
res.deals.push(deal.name);
ok("negocio creado", Boolean(deal.name), deal.name);

// 3. Presupuesto con ítems (cant × precio × (1 - desc))
const items = [
  { description: "Consultoría", qty: 2, rate: 100000, discount_percentage: 10 },
  { description: "Implementación", qty: 1, rate: 500000, discount_percentage: 0 },
];
const expected = 2 * 100000 * 0.9 + 1 * 500000;
const q = await call("save_quote", { name: deal.name, items });
ok("presupuesto guardado", q.count === 2, `${q.count} ítems · total ${q.total}`);
ok("total calculado", Math.abs(q.total - expected) < 0.01, `esperado ${expected}`);

// 4. Se relee y persiste
const d = await get("get_deal", { name: deal.name });
ok("ítems persistidos", d.items.length === 2, d.items.map((i) => i.description).join(", "));
ok("total persistido", Math.abs(d.total - expected) < 0.01, String(d.total));
ok("valor del negocio = total", Math.abs((d.value ?? 0) - expected) < 0.01, String(d.value));

// 5. Convertir un lead en negocio
const lead = await call("create_lead", { first_name: "Zz", last_name: "Prueba", organization: "Zz Org" });
const conv = await call("convert_lead_to_deal", { lead: lead.name });
res.deals.push(conv.name);
ok("lead convertido a negocio", Boolean(conv.name), conv.title);
const cd = await get("get_deal", { name: conv.name });
ok("negocio ligado al lead", cd.lead === lead.name, `${cd.lead} · contacto ${cd.contact}`);

// 6. El lead ya no figura como "sin negocio"
const after = await get("get_deals", {});
ok("lead salió de la bandeja", !after.leads.some((l) => l.name === lead.name));

console.log("\nLIMPIAR:  deals =", res.deals.join(" "), " lead =", lead.name);
