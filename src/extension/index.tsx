import "@/extension/app.css";
import { createRoot } from "react-dom/client";
// you can use aliases too ! (checkout tsconfig.app.json)
import Onboarding from "@/components/Onboarding";

const config = {
  projectName: "playlists-manager-app",
  framework: "react",
  language: "ts",
  packageManager: "bun",
  linter: "biome",
};

function main() {
  // Create a container for the React application
  // We append this to document.body to ensure it sits above the Spotify UI
  const container = document.createElement("div");
  container.id = "spicetify-onboarding-root";
  document.body.appendChild(container);

  const root = createRoot(container);

  // Render the Onboarding UI
  root.render(<Onboarding config={config} />);
}

main();
