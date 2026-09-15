import { useState } from "react";
import Hoy from "./Hoy";
import Agenda from "./Agenda";
import "./styles.css";

export default function App() {
  const [view, setView] = useState<"agenda" | "hoy">("agenda");

  return (
    <div className="app">
      <div className="glow" aria-hidden />
      <nav className="nav">
        <span className="brand">MB CRM</span>
        <div className="tabs">
          <button className={view === "agenda" ? "on" : ""} onClick={() => setView("agenda")}>
            Agenda
          </button>
          <button className={view === "hoy" ? "on" : ""} onClick={() => setView("hoy")}>
            Hoy
          </button>
        </div>
      </nav>
      {view === "agenda" ? <Agenda /> : <Hoy />}
    </div>
  );
}
