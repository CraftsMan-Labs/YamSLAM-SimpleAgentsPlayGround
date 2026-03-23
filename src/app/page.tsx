import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-card">
          <div className="label">YamSLAM</div>
          <h1 className="page-title">YAML playground for SimpleAgents</h1>
          <p className="subhead">
            Bring your own OpenAI-compatible URL, API key, and model. Run YAML
            flows fully in your browser with custom JS/TS helper functions,
            visualized execution, and a compact chat workspace.
          </p>
          <div className="hero-actions">
            <Link href="/playground" className="btn-primary">
              Open Playground
            </Link>
            <Link href="/reference" className="btn-secondary">
              Open Interaction Reference
            </Link>
          </div>
        </div>
        <div className="hero-mock">
          <div className="label" style={{ color: "#a8b0ba" }}>
            Preview
          </div>
          <h3 style={{ marginTop: 12, color: "#f5f7fa" }}>
            Browser-only execution, no server key relay
          </h3>
          <p style={{ marginTop: 12, color: "#e5e7eb" }}>
            The provider key stays in your session. YamSLAM sends requests
            directly from your browser to your chosen OpenAI-compatible endpoint.
          </p>
        </div>
      </section>

      <section className="section">
        <h2>Interaction reference summary</h2>
        <p className="subhead">
          The full interaction reference lives on a dedicated route for cleaner
          navigation. This landing page keeps a short summary and quick links.
        </p>
        <div className="card-grid">
          <article className="card">
            <h4>States and tokens</h4>
            <p>
              CTA and navigation hover/focus behaviors are tokenized for dark and
              light palettes with visible focus treatment.
            </p>
          </article>
          <article className="card">
            <h4>Typography system</h4>
            <p>
              JetBrains Mono drives all headings, body, and labels to keep a
              coding-forward technical tone.
            </p>
          </article>
          <article className="card">
            <h4>Responsive expectations</h4>
            <p>
              Tablet and mobile behavior is predefined for hero, cards, and
              footer alignment rules.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
