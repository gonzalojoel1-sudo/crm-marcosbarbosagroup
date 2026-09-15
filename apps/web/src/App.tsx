import { useState } from "react";
import Hoy from "./Hoy";
import Agenda from "./Agenda";
import MeetingModal from "./MeetingModal";
import Logo from "./Logo";
import "./styles.css";

export default function App() {
  const [view, setView] = useState<"agenda" | "hoy">("agenda");
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);

  return (
    <div className="app">
      <div className="glow" aria-hidden />
      <nav className="nav">
        <span className="brand">
          <Logo size={24} />
          Marcos Barbosa Group
        </span>
        <div className="tabs">
          <button className={view === "agenda" ? "on" : ""} onClick={() => setView("agenda")}>
            Agenda
          </button>
          <button className={view === "hoy" ? "on" : ""} onClick={() => setView("hoy")}>
            Hoy
          </button>
        </div>
      </nav>
      {view === "agenda" ? (
        <Agenda onOpenMeeting={setOpenMeeting} />
      ) : (
        <Hoy onOpenMeeting={setOpenMeeting} />
      )}
      {openMeeting ? <MeetingModal name={openMeeting} onClose={() => setOpenMeeting(null)} /> : null}
    </div>
  );
}
