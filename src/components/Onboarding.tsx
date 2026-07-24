import { useState } from "react";

interface OnboardingProps {
  config: {
    projectName: string;
    framework: string;
    language: string;
    packageManager: string;
    linter: string;
  };
}

const Onboarding: React.FC<OnboardingProps> = ({ config }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  const handleDismiss = () => {
    setIsFading(true);
    setTimeout(() => setIsVisible(false), 250);
  };

  if (!isVisible) return null;

  return (
    <div className={`onboarding-overlay ${isFading ? "fade-out" : ""}`} onClick={handleDismiss}>
      <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
        <button className="close-icon-btn" onClick={handleDismiss} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 1L11 11M1 11L11 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="status-badge">🚀 {config.projectName} Ready</div>

        <div className="config-grid">
          <span className="label">Framework</span>
          <span className="value">{config.framework}</span>

          <span className="label">Language</span>
          <span className="value">{config.language}</span>

          <span className="label">Manager</span>
          <span className="value">{config.packageManager}</span>

          <span className="label">Linter</span>
          <span className="value">{config.linter}</span>
        </div>

        <div className="footer-tip">
          Next Step: Edit <code>src/app.tsx</code>
        </div>

        <div className="onboarding-actions">
          <button className="get-started-btn" onClick={() => openLink("https://github.com/sanoojes/spicetify-creator")}>
            Get Started
          </button>
          <button
            className="get-started-btn"
            onClick={() => {
              Spicetify.Platform.History.push("/playlists-manager-app");
              handleDismiss();
            }}
          >
            Go to Custom App
          </button>
          <button className="discord-btn" onClick={() => openLink("https://discord.gg/YGkktjdYV8")}>
            Join Discord
          </button>
          <button className="dismiss-btn" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;

function openLink(url: string, newTab = true) {
  if (!url) return;
  if (newTab) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = url;
  }
}
