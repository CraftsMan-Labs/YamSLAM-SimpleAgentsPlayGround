import Image from "next/image";
import Link from "next/link";
import craftsmanLogoWhite from "./assets/CraftsmanLabs-white.svg";

type RepoStats = {
  stars: number;
  forks: number;
  language: string;
  license: string;
};

async function getSimpleAgentsRepoStats(): Promise<RepoStats> {
  const fallback: RepoStats = {
    stars: 7,
    forks: 2,
    language: "Rust",
    license: "Apache-2.0"
  };

  try {
    const response = await fetch("https://api.github.com/repos/CraftsMan-Labs/SimpleAgents", {
      headers: {
        Accept: "application/vnd.github+json"
      },
      next: {
        revalidate: 3600
      }
    });

    if (!response.ok) {
      return fallback;
    }

    const payload = (await response.json()) as {
      stargazers_count?: number;
      forks_count?: number;
      language?: string;
      license?: { spdx_id?: string; name?: string };
    };

    return {
      stars: typeof payload.stargazers_count === "number" ? payload.stargazers_count : fallback.stars,
      forks: typeof payload.forks_count === "number" ? payload.forks_count : fallback.forks,
      language: payload.language ?? fallback.language,
      license: payload.license?.spdx_id ?? payload.license?.name ?? fallback.license
    };
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const repoStats = await getSimpleAgentsRepoStats();

  return (
    <main>
      <section className="hero">
        <div className="hero-card">
          <div className="home-topbar">
            <Image
              src={craftsmanLogoWhite}
              alt="CraftsmanLabs logo"
              className="home-logo"
              priority
            />
            <div className="home-top-icons">
              <a
                className="icon-link"
                href="https://www.linkedin.com/in/rishub-c-r/"
                target="_blank"
                rel="noreferrer"
                aria-label="LinkedIn profile"
                title="LinkedIn"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M0 1.15C0 .52.52 0 1.15 0h13.7C15.48 0 16 .52 16 1.15v13.7c0 .63-.52 1.15-1.15 1.15H1.15A1.15 1.15 0 0 1 0 14.85V1.15ZM4.75 13V6.17H2.48V13h2.27ZM3.61 5.2c.79 0 1.28-.52 1.28-1.17-.01-.67-.49-1.17-1.27-1.17-.78 0-1.29.5-1.29 1.17 0 .65.5 1.17 1.27 1.17h.01ZM13.52 13V9.26c0-2-1.06-2.93-2.48-2.93-1.14 0-1.65.63-1.93 1.07v-0.92H6.84c.03.61 0 6.52 0 6.52h2.27V9.36c0-.19.01-.38.07-.52.15-.38.49-.78 1.06-.78.75 0 1.05.58 1.05 1.43V13h2.23Z" />
                </svg>
              </a>
              <a
                className="icon-link"
                href="https://github.com/CraftsMan-Labs"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub organization"
                title="GitHub"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 0a8 8 0 0 0-2.53 15.6c.4.08.54-.17.54-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.5-2.69-.95-.09-.23-.48-.95-.82-1.14-.28-.15-.68-.52 0-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.14.47.55.38A8 8 0 0 0 8 0Z" />
                </svg>
              </a>
            </div>
          </div>
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
                <div className="repo-stat-value">{repoStats.stars}</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">Y</div>
              <div>
                <div className="label">Forks</div>
                <div className="repo-stat-value">{repoStats.forks}</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">R</div>
              <div>
                <div className="label">Primary Lang</div>
                <div className="repo-stat-value">{repoStats.language}</div>
              </div>
            </article>
            <article className="repo-stat">
              <div className="repo-stat-icon">L</div>
              <div>
                <div className="label">License</div>
                <div className="repo-stat-value">{repoStats.license}</div>
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
          <div className="download-grid" style={{ marginTop: 16 }}>
            <a
              className="download-link"
              href="https://www.npmjs.com/package/simple-agents-node"
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-registry">npm</span>
              <strong>simple-agents-node</strong>
            </a>
            <a
              className="download-link"
              href="https://www.npmjs.com/package/simple-agents-wasm"
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-registry">npm</span>
              <strong>simple-agents-wasm</strong>
            </a>
            <a
              className="download-link"
              href="https://pypi.org/project/simple-agents-py/"
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-registry">PyPI</span>
              <strong>simple-agents-py</strong>
            </a>
            <a
              className="download-link"
              href="https://crates.io/crates/simple-agent-type"
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-registry">crates.io</span>
              <strong>simple-agent-type</strong>
            </a>
            <a
              className="download-link"
              href="https://crates.io/crates/simple-agents-core"
              target="_blank"
              rel="noreferrer"
            >
              <span className="download-registry">crates.io</span>
              <strong>simple-agents-core</strong>
            </a>
          </div>
        </div>
      </section>

    </main>
  );
}
