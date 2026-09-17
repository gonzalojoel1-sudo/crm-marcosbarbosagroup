declare global {
  interface Window {
    CSRF?: string;
  }
}

const CSRF = window.CSRF || "";

export interface TaskDTO {
  name: string;
  subject: string;
  due_datetime: string | null;
  priority: string;
}

export interface EventDTO {
  name: string;
  subject: string;
  starts_on: string;
  ends_on: string;
  all_day: boolean;
  who?: string;
  email?: string;
}

export interface HoyData {
  today: string;
  overdue: TaskDTO[];
  tasks_today: TaskDTO[];
  events_today: EventDTO[];
  count: number;
}

export interface AgendaData {
  start: string;
  end: string;
  events: EventDTO[];
  tasks: TaskDTO[];
}

export interface DealDTO {
  name: string;
  title: string;
  status: string;
  org: string;
  contact: string;
  owner: string;
  value: number | null;
  currency: string;
  date: string | null;
  next_step: string;
  probability: number | null;
  lead: string;
  has_quote: boolean;
}

export type BillingType = "Único" | "Mensual" | "Trimestral" | "Anual";
export type QuoteStatus = "Borrador" | "Enviado" | "Aceptado" | "Rechazado" | "Vencido" | "Anulado";
export type IvaMode = "sumar" | "incluido" | "exento";

export interface QuoteItemDTO {
  description: string;
  billing_type: BillingType;
  qty: number;
  rate: number;
  discount_percentage: number;
  net_amount: number;
}

export interface QuoteTotalsDTO {
  one_time_net: number;
  one_time_iva: number;
  one_time_gross: number;
  recurring_net: number;
  recurring_iva: number;
  recurring_gross: number;
  discount: number;
}

export interface QuoteDTO {
  name: string;
  version: number;
  status: QuoteStatus;
  currency: string;
  iva_mode: IvaMode;
  vertical: string;
  valid_until: string;
  conditions: string;
  notes: string;
  recurring_summary: string;
  is_editable: boolean;
  totals: QuoteTotalsDTO;
  items: QuoteItemDTO[];
}

export interface DealDetail {
  name: string;
  title: string;
  org: string;
  contact: string;
  value: number | null;
  currency: string;
  date: string;
  next_step: string;
  probability: number | null;
  status: string;
  owner: string;
  lead: string;
  quote: QuoteDTO | null;
}

export interface DealInput {
  contact?: string;
  deal_value?: string;
  expected_closure_date?: string;
  next_step?: string;
  probability?: string;
  status?: string;
}

export interface LeadDTO {  name: string;
  who: string;
  email: string;
  mobile_no: string;
  organization: string;
  source: string;
  status: string;
  meeting: string | null;
}

export interface MeetingComment {  name: string;
  content: string;
  when: string;
  by: string;
}

export interface MeetingTask {
  name: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

export interface MeetingDetail {  name: string;
  subject: string;
  who: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_no: string;
  organization: string;
  status: string;
  source: string;
  meeting: string | null;
  notes: string;
  description: string;
  comments: MeetingComment[];
  tasks: MeetingTask[];
}

async function handle<T>(r: Response): Promise<T> {
  if (r.status === 403) {
    window.location.href = "/login";
    throw new Error("forbidden");
  }
  if (!r.ok) throw new Error(await r.text());
  const json = await r.json();
  return json.message as T;
}

async function get<T>(method: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return handle<T>(await fetch(`/api/method/${method}${qs}`, { credentials: "include" }));
}

async function post<T>(method: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(`/api/method/${method}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": CSRF },
      body: JSON.stringify(body),
    }),
  );
}

async function postBlob(method: string, body: unknown): Promise<Blob> {
  const r = await fetch(`/api/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": CSRF },
    body: JSON.stringify(body),
  });
  if (r.status === 403) {
    window.location.href = "/login";
    throw new Error("forbidden");
  }
  if (!r.ok) throw new Error(await r.text());
  return await r.blob();
}

export const api = {
  getHoy: () => get<HoyData>("crm_core.api.get_hoy"),
  getAgenda: (start: string, end: string) =>
    get<AgendaData>("crm_core.api.get_agenda", { start, end }),
  getMeeting: (name: string) => get<MeetingDetail>("crm_core.api.get_meeting", { name }),
  getLeads: () => get<{ leads: LeadDTO[] }>("crm_core.api.get_leads"),
  getDeals: () =>
    get<{ deals: DealDTO[]; stages: string[]; leads: LeadDTO[]; verticals: string[] }>(
      "crm_core.api.get_deals",
    ),
  getReminders: () =>
    get<{ meetings: EventDTO[]; overdue: number; now: string }>("crm_core.api.get_reminders"),
  moveDeal: (name: string, status: string) =>
    post<{ ok: boolean }>("crm_core.api.move_deal", { name, status }),
  deleteDeal: (name: string) => post<{ ok: boolean }>("crm_core.api.delete_deal", { name }),
  getDeal: (name: string) => get<DealDetail>("crm_core.api.get_deal", { name }),
  updateDeal: (name: string, fields: DealInput) =>
    post<{ ok: boolean }>("crm_core.api.update_deal", { name, ...fields }),
  createDeal: (payload: { title: string; lead?: string } & DealInput) =>
    post<{ name: string; title: string; status: string }>("crm_core.api.create_deal", payload),
  saveQuote: (
    deal: string,
    items: Array<{
      description: string;
      billing_type: BillingType;
      qty: number;
      rate: number;
      discount_percentage: number;
    }>,
    opts: { ivaMode: IvaMode; validUntil?: string; conditions?: string; currency?: string; vertical?: string },
  ) =>
    post<{ name: string; version: number; status: string }>("crm_core.api.save_quote", {
      deal,
      items,
      iva_mode: opts.ivaMode,
      valid_until: opts.validUntil ?? null,
      conditions: opts.conditions ?? null,
      currency: opts.currency ?? null,
      vertical: opts.vertical ?? null,
    }),
  sendQuote: (quoteName: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.send_quote", { name: quoteName }),
  acceptQuote: (quoteName: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.accept_quote", { name: quoteName }),
  rejectQuote: (quoteName: string, reason: string) =>
    post<{ ok: boolean; status: string }>("crm_core.api.reject_quote", { name: quoteName, reason }),
  newQuoteVersion: (deal: string) =>
    post<{ name: string; version: number }>("crm_core.api.new_quote_version", { deal }),
  quotePdf: (quoteName: string) => postBlob("crm_core.api.quote_pdf", { name: quoteName }),
  convertLeadToDeal: (lead: string, status?: string) =>
    post<{ name: string; title: string; status: string }>("crm_core.api.convert_lead_to_deal", {
      lead,
      status,
    }),
  createLead: (p: {
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile_no?: string;
    organization?: string;
    source?: string;
    notes?: string;
  }) => post<{ name: string; existing: boolean }>("crm_core.api.create_lead", p),
  addTask: (title: string, reference_name?: string, due_date?: string) =>
    post<MeetingTask>("crm_core.api.add_task", { title, reference_name, due_date }),
  updateLead: (
    name: string,
    fields: { email?: string; mobile_no?: string; organization?: string; status?: string },
  ) => post<{ ok: boolean }>("crm_core.api.update_lead", { name, ...fields }),
  addNote: (name: string, text: string) =>
    post<MeetingComment>("crm_core.api.add_note", { name, text }),
  toggleTask: (name: string) => post<{ status: string }>("crm_core.api.toggle_task", { name }),
  quickAdd: (subject: string) =>
    post<{ name: string; subject: string }>("crm_core.api.quick_add_task", { subject }),
  complete: (name: string) => post<{ ok: boolean }>("crm_core.api.complete_task", { name }),
  createEvent: (subject: string, starts_on: string, ends_on: string) =>
    post<{ name: string; subject: string }>("crm_core.api.create_event", {
      subject,
      starts_on,
      ends_on,
    }),
};
