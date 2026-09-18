import { useState } from "react";
import Hoy from "./Hoy";
import Agenda from "./Agenda";
import Leads from "./Leads";
import Pipeline from "./Pipeline";
import MeetingDrawer from "./MeetingModal";
import Reminder from "./Reminder";
import Logo from "./Logo";
// El prototipo aprobado es la autoridad de la paleta de la AGENDA. tokens.css
// define los tokens en `[data-agenda]`, no en `:root`: el `:root` de styles.css
// queda intacto y el resto del CRM conserva su paleta (D2). El orden de imports
// ya no decide la cascada (el atributo gana sobre la herencia de `:root`), pero
// se mantiene para que la agenda cargue después del shell.
import "./styles.css";
import "./agenda/tokens.css";

type View = "agenda" | "hoy" | "contactos" | "pipeline";

export default function App() {
  const [view, setView] = useState<View>("agenda");
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);

  const tab = (v: View, label: string) => (
    <button className={view === v ? "on" : ""} onClick={() => setView(v)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <div className="glow" aria-hidden />
      <nav className="nav">
        <span className="brand">
          <Logo size={24} />
          <span className="brand-name">Marcos Barbosa Group</span>
        </span>
        <div className="tabs">
          {tab("agenda", "Agenda")}
          {tab("hoy", "Hoy")}
          {tab("contactos", "Contactos")}
          {tab("pipeline", "Negocios")}
        </div>
      </nav>
      {view === "agenda" ? (
        <Agenda onOpenMeeting={setOpenMeeting} />
      ) : view === "hoy" ? (
        <Hoy onOpenMeeting={setOpenMeeting} />
      ) : view === "contactos" ? (
        <Leads onOpen={setOpenMeeting} />
      ) : (
        <Pipeline />
      )}
      {openMeeting ? <MeetingDrawer name={openMeeting} onClose={() => setOpenMeeting(null)} /> : null}
      <Reminder onOpen={setOpenMeeting} />
    </div>
  );
}
