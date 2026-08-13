import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>Standalone Vite findings cell</h1>
      <p>Intentional MFDoctor misconfig for the Vite adapter demo.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
