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

async function handle<T>(r: Response): Promise<T> {
  if (r.status === 403) {
    window.location.href = "/login";
    throw new Error("forbidden");
  }
  if (!r.ok) throw new Error(await r.text());
  const json = await r.json();
  return json.message as T;
}

async function get<T>(method: string): Promise<T> {
  return handle<T>(await fetch(`/api/method/${method}`, { credentials: "include" }));
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
  quickAdd: (subject: string) =>
    post<{ name: string; subject: string }>("crm_core.api.quick_add_task", { subject }),
  complete: (name: string) => post<{ ok: boolean }>("crm_core.api.complete_task", { name }),
};
