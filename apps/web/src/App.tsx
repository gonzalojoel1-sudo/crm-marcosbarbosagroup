import { useState } from "react";
import Hoy from "./Hoy";
import Agenda from "./Agenda";
import Leads from "./Leads";
import MeetingDrawer from "./MeetingModal";
import Logo from "./Logo";
import "./styles.css";

type View = "agenda" | "hoy" | "contactos";

export default function App() {
  const [view, setView] = useState<View>("agenda");
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);

  return (
    <div className="app">
      <div className="glow" aria-hidden />
      <nav className="nav">
        <span className="brand">
          <Logo size={24} />
          <span className="brand-name">Marcos Barbosa Group</span>
        </span>
        <div className="tabs">
          <button className={view === "agenda" ? "on" : ""} onClick={() => setView("agenda")}>
            Agenda
          </button>
          <button className={view === "hoy" ? "on" : ""} onClick={() => setView("hoy")}>
            Hoy
          </button>
          <button className={view === "contactos" ? "on" : ""} onClick={() => setView("contactos")}>
            Contactos
          </button>
        </div>
      </nav>
      {view === "agenda" ? (
        <Agenda onOpenMeeting={setOpenMeeting} />
      ) : view === "hoy" ? (
        <Hoy onOpenMeeting={setOpenMeeting} />
      ) : (
        <Leads onOpen={setOpenMeeting} />
      )}
      {openMeeting ? <MeetingDrawer name={openMeeting} onClose={() => setOpenMeeting(null)} /> : null}
    </div>
  );
}
