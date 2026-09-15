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

export interface LeadDTO {
  name: string;
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

export const api = {
  getHoy: () => get<HoyData>("crm_core.api.get_hoy"),
  getAgenda: (start: string, end: string) =>
    get<AgendaData>("crm_core.api.get_agenda", { start, end }),
  getMeeting: (name: string) => get<MeetingDetail>("crm_core.api.get_meeting", { name }),
  getLeads: () => get<{ leads: LeadDTO[] }>("crm_core.api.get_leads"),
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
