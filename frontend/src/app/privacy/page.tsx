export const metadata = {
 title: "Privacy Policy | FigureOut",
 description: "FigureOut privacy policy for website and Chrome extension",
};

export default function PrivacyPage() {
 return (
    <div className="col-narrow pb-16 pt-[clamp(24px,4.5vh,46px)]">
      <h1 className="mb-6 text-2xl font-medium text-[var(--ink)]">Privacy Policy</h1>
      <p className="mb-4 text-xs text-[var(--muted)]">Last updated: 2026-03-24</p>

      <div className="space-y-6 text-sm leading-relaxed text-[var(--ink)]">
        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Overview</h2>
          <p>FigureOut (figureout.tw) is a PVC figure secondhand price intelligence platform. This policy covers both the website and the FigureOut Price Reporter Chrome extension.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Data We Collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Price reports</strong>: When you submit a price report, we store the price, currency, condition, platform, date, and optional notes you provide.</li>
            <li><strong>Figure submissions</strong>: When you submit a new figure, we store the figure details you provide.</li>
            <li><strong>Error reports</strong>: When you report an issue, we store the description and optional contact info you provide.</li>
            <li><strong>Page views</strong>: We track anonymous page view counts. No personal identifiers are stored.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Chrome Extension</h2>
          <p>The FigureOut Price Reporter extension:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Only connects to the figureout.tw API</li>
            <li>Does NOT read, collect, or transmit any browsing data</li>
            <li>Does NOT access Facebook or any other website content</li>
            <li>Does NOT collect personal information, cookies, or login credentials</li>
            <li>Only sends data you explicitly submit through the extension form</li>
            <li>Opens as a side panel and does not inject any code into web pages</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Data We Do NOT Collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>No personal identification information</li>
            <li>No IP addresses stored permanently</li>
            <li>No cookies for tracking</li>
            <li>No third-party analytics or advertising trackers</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Data Usage</h2>
          <p>All submitted price data is used solely to calculate and display secondhand market prices for PVC figures. Data is aggregated and displayed publicly on figureout.tw.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Data Retention</h2>
          <p>Price reports and listings are retained indefinitely as part of the historical price database. Error reports are deleted after resolution.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-[var(--ink)]">Contact</h2>
          <p>For privacy concerns or data deletion requests, please contact us through the error report form on any figure page.</p>
        </section>
      </div>
    </div>
  );
}
