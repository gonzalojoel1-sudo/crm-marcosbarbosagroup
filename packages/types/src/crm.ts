/**
 * Premium CRM — core type contracts (Fase 0).
 * These types are the single source of truth consumed by both apps/web
 * (Next.js frontend) and ANY backend consumer of crm_core's REST/RPC surface.
 *
 * License: proprietary (apps/web, packages/*). See LICENSE in repo root.
 *
 * Last review: 2026-09-14.
 */

export type TaskStatus = "Open" | "Done" | "Cancelled";
export type TaskPriority = "Low" | "Medium" | "High";
export type LinkedDocType = "Lead" | "Deal" | "Contact" | "Event";

export interface TaskDTO {
  name: string;
  subject: string;
  due_datetime: string | null;
  status: TaskStatus;
  assignee: string | null;
  priority: TaskPriority;
  linked_doctype: LinkedDocType | null;
  linked_name: string | null;
}

export type EventSource = "manual" | "gcal" | "cal_sidecar";

export interface EventDTO {
  name: string;
  title: string;
  start_utc: string;
  end_utc: string;
  timezone: string;
  attendees: string[];
  meet_link: string | null;
  gcal_id: string | null;
  source: EventSource;
}

/** Discriminated union used by /hoy and palette commands. */
export type HoyItem =
  | ({ kind: "task" } & TaskDTO)
  | ({ kind: "event" } & EventDTO);

/**
 * RPC envelope. Frappe /api/method/* wraps responses in `message`; REST v2
 * wraps in `data`. The frontend `unwrap()` handles both — these types exist
 * to document the surface and validate inputs/responses at compile time.
 */
export interface FrappeRPCEnvelope<T> {
  message: T;
  /** present if frappe.ui* or hook handlers want to surface server hints */
  exc?: string;
}
export interface FrappeRESTEnvelope<T> {
  data: T;
}
