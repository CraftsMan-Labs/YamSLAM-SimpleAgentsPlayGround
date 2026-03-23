import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-card">
          <div className="label">YamSLAM</div>
          <h1 className="page-title">SimpleAgents Playground - YamSLAM</h1>
          <p className="subhead">
            SimpleAgents lets anyone vibe-code LLM agents and ship them
            production-ready with a Rust-first core, Python/Node/Go bindings,
            multi-provider support, YAML workflows, validation,
            tracing/replay, resilience, structured outputs, and eval-ready tooling.
          </p>
          <div className="repo-stats" aria-label="SimpleAgents repository stats">
            <article className="repo-stat">
              <div className="repo-stat-icon">*</div>
              <div>
                <div className="label">Stars</div>
                <div className="repo-stat-value">7</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">Y</div>
              <div>
                <div className="label">Forks</div>
                <div className="repo-stat-value">2</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">R</div>
              <div>
                <div className="label">Primary Lang</div>
                <div className="repo-stat-value">Rust</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">L</div>
              <div>
                <div className="label">License</div>
                <div className="repo-stat-value">Apache-2.0</div>
              </div>
            </article>
          </div>
          <div className="hero-actions">
            <Link href="/playground" className="btn-primary">
              Open Playground
            </Link>
            <a
              href="https://docs.simpleagents.craftsmanlabs.net/"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              Open Docs
            </a>
          </div>
          <div className="hero-actions" style={{ marginTop: 12 }}>
            <a
              href="https://www.linkedin.com/in/rishub-c-r/"
              target="_blank"
              rel="noreferrer"
              className="social-link"
            >
              <span className="social-badge">in</span>
              LinkedIn
            </a>
            <a
              href="https://github.com/CraftsMan-Labs"
              target="_blank"
              rel="noreferrer"
              className="social-link"
            >
              <span className="social-badge">GH</span>
              CraftsMan-Labs
            </a>
            <a
              href="https://github.com/CraftsMan-Labs/SimpleAgents"
              target="_blank"
              rel="noreferrer"
              className="social-link"
            >
              <span className="social-badge">Star</span>
              Project GitHub
            </a>
          </div>
          <p className="subhead" style={{ marginTop: 12 }}>
            If you like this project, please star it. Feel free to reach out.
          </p>
        </div>
        <div className="hero-mock">
          <div className="label" style={{ color: "#a8b0ba" }}>
            Preview
          </div>
          <h3 style={{ marginTop: 12, color: "#f5f7fa" }}>
            Powered by SimpleAgents WASM runtime
          </h3>
          <p style={{ marginTop: 12, color: "#e5e7eb" }}>
            Requests run directly in-browser using `simple-agents-wasm` with
            your BYOK credentials.
          </p>
        </div>
      </section>

    </main>
  );
}
