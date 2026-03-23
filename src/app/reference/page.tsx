import Link from "next/link";

const tokens = [
  { name: "primary/500", value: "#0F1114" },
  { name: "primary/hover-light", value: "#F5F4F1" },
  { name: "primary/hover-accent", value: "#E78468" },
  { name: "primary/focus-ring", value: "#161A1D" },
  { name: "dark/900", value: "#FFFFFF" },
  { name: "dark/stroke", value: "#2A3036" },
  { name: "dark/ink", value: "#E5E7EB" },
  { name: "dark/text-on", value: "#F5F7FA" },
  { name: "surface/base", value: "#11161C" },
  { name: "surface/card", value: "#A8B0BA" },
  { name: "text/default", value: "#52565C" },
  { name: "text/muted", value: "#C9754B" }
];

export default function ReferencePage() {
  return (
    <main>
      <div className="hero-actions" style={{ marginTop: 0, marginBottom: 24 }}>
        <Link href="/" className="state-link">
          Back to Home
        </Link>
        <Link href="/playground" className="state-link">
          Go to Playground
        </Link>
      </div>

      <section>
        <div className="label">Interaction Reference</div>
        <h1 className="page-title">Interaction states and implementation guide</h1>
        <p className="subhead">
          A reference section documenting interaction states, typography,
          responsive behavior, color tokens, and implementation decisions for
          the landing page UI.
        </p>
      </section>

      <section className="section">
        <h2>Interaction states and tokens</h2>
        <p className="subhead">
          Hover/focus specs for nav/footer links and CTAs across dark and light
          palettes with WCAG-friendly contrast.
        </p>
        <div className="card-grid">
          <article className="card">
            <h4>Primary CTA states</h4>
            <p>
              Default uses `primary/500`. Hover uses accent + high contrast text.
              Focus uses `primary/focus-ring` in both modes.
            </p>
          </article>
          <article className="card">
            <h4>Secondary CTA states</h4>
            <p>
              Uses a shell-outline style (`#12171D/#2A3036` for dark, `#FFFFFF`
              and `#E5E7EB` for light) with strong focus visibility.
            </p>
          </article>
          <article className="card">
            <h4>Nav/Footer link states</h4>
            <p>
              Dark links transition `#A8B0BA` to `#F5F7FA`; light links
              `#52565C` to `#11161C`, with underline on hover.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <h2>Font usage</h2>
        <p className="subhead">
          All landing page typography uses JetBrains Mono to reinforce a
          coding-forward, technical tone.
        </p>
        <div className="card-grid">
          <article className="card">
            <h4>Typeface</h4>
            <p>
              Primary typeface: JetBrains Mono for headings, body, and UI labels.
            </p>
          </article>
          <article className="card">
            <h4>Weights</h4>
            <p>700 for headlines, 600 for labels, and 400-500 for body text.</p>
          </article>
          <article className="card">
            <h4>Scale</h4>
            <p>H1 52/1.12, H2 36/1.2, H3 26/1.3, body 17/1.7, label 12 + 0.2em.</p>
          </article>
        </div>
      </section>

      <section className="section">
        <h2>Responsive layout guides</h2>
        <p className="subhead">
          Tablet and mobile layout expectations for key sections (hero, cards,
          and footer).
        </p>
        <div className="card-grid">
          <article className="card">
            <h4>Tablet - Landscape</h4>
            <p>Hero stays two-column, cards wrap two-up, and footer stays two columns.</p>
          </article>
          <article className="card">
            <h4>Tablet - Portrait</h4>
            <p>Hero stacks, cards move from two-up to one-up, and footer stacks.</p>
          </article>
          <article className="card">
            <h4>Mobile</h4>
            <p>All sections stack one-up, CTAs become vertical, footer is single column.</p>
          </article>
        </div>
      </section>

      <section className="section">
        <h2>Color tokens</h2>
        <p className="subhead">
          Named swatches for dark and light palettes and core UI states.
        </p>
        <div className="token-grid">
          {tokens.map((token) => (
            <article className="token-swatch" key={token.name}>
              <div
                className="token-chip"
                style={{ background: token.value, borderBottom: "1px solid #E5E7EB" }}
              />
              <div className="token-meta">
                <div className="label">{token.name}</div>
                <div className="mono-value">{token.value}</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Design decisions and formats</h2>
        <p className="subhead">
          Usage guidance for tokens across UI elements and surfaces.
        </p>
        <div className="card-grid">
          <article className="card">
            <h4>CTA and links</h4>
            <p>
              Primary CTA uses `primary/500`, hover uses `primary/hover`, and
              focus ring uses `primary/focus-ring` in both modes.
            </p>
          </article>
          <article className="card">
            <h4>Surfaces and hero</h4>
            <p>
              Surfaces use dark `#0F1114/#161A1D/#1F252D` and light
              `#F5F4F1/#FFFFFF`. Hero mock remains dark for focus and contrast.
            </p>
          </article>
          <article className="card">
            <h4>Spacing and radius</h4>
            <p>
              Spacing scale: 8/12/16/20/28/32/48/64/80. Radius scale: 10
              (buttons), 14-16 (cards), 999 (pills).
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
