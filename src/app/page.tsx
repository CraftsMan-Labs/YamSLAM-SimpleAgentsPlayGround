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
            flows with custom JS/TS helper functions,
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
            Powered by SimpleAgents Node runtime
          </h3>
          <p style={{ marginTop: 12, color: "#e5e7eb" }}>
            Requests run through the YamSLAM server runtime using
            `simple-agents-node`, with your BYOK credentials forwarded per
            request.
          </p>
        </div>
      </section>

    </main>
  );
}
