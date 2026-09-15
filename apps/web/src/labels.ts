// Etiquetas en español. Los valores guardados en la base (etapas, estados,
// fuentes) se mantienen tal cual; acá solo se traducen para mostrar.

const STAGE: Record<string, string> = {
  Qualification: "Calificación",
  Diagnóstico: "Diagnóstico",
  Análisis: "Análisis",
  Estrategia: "Estrategia",
  Implementación: "Implementación",
  Seguimiento: "Seguimiento",
  Escalamiento: "Escalamiento",
  Won: "Ganado",
  Lost: "Perdido",
};

const LEAD_STATUS: Record<string, string> = {
  New: "Nuevo",
  Contacted: "Contactado",
  Qualified: "Calificado",
  Nurture: "En seguimiento",
  Unqualified: "No calificado",
  Junk: "Descartado",
  Converted: "Convertido",
};

const LEAD_SOURCE: Record<string, string> = {
  Website: "Sitio web",
  Referido: "Referido",
  Reference: "Referencia",
  LinkedIn: "LinkedIn",
  WhatsApp: "WhatsApp",
  "Cold Calling": "Llamada en frío",
  "Agenda Reunión": "Reunión agendada",
  Campaign: "Campaña",
};

const TASK_STATUS: Record<string, string> = {
  Backlog: "Pendiente",
  Todo: "Por hacer",
  "In Progress": "En curso",
  Done: "Hecha",
  Canceled: "Cancelada",
};

const PRIORITY: Record<string, string> = {
  Low: "Baja",
  Medium: "Media",
  High: "Alta",
};

function make(map: Record<string, string>) {
  return (v: string | null | undefined) => (v ? (map[v] ?? v) : "");
}

export const stageLabel = make(STAGE);
export const leadStatusLabel = make(LEAD_STATUS);
export const leadSourceLabel = make(LEAD_SOURCE);
export const taskStatusLabel = make(TASK_STATUS);
export const priorityLabel = make(PRIORITY);
