import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy · StudyOS",
  description: "How StudyOS collects, uses, and protects your data.",
};

const CONTACT = "harshalvankudre@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" effectiveDate="July 3, 2026">
      <section>
        <p>
          This policy explains what data StudyOS (“we”) collects, why, and the
          choices you have. The short version: we collect what’s needed to run
          your study workspace, we don’t sell your data, and you can delete
          everything yourself at any time.
        </p>
      </section>

      <section>
        <h2>1. Data we collect</h2>
        <ul>
          <li>
            <strong>Account data</strong> — name, email, and sign-in identifiers,
            managed by our authentication provider (Clerk).
          </li>
          <li>
            <strong>Workspace content</strong> — the descriptions you type, the
            workspaces generated for you, edits, and files/images produced by
            AI tools on your behalf.
          </li>
          <li>
            <strong>Billing data</strong> — subscription status and credit
            balance. Card details go directly to Stripe; we never see or store
            them.
          </li>
          <li>
            <strong>Usage data</strong> — counts of AI requests and feature
            events (used for rate limiting, abuse prevention, and improving the
            product). We do not use third-party advertising trackers.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To provide the Service: generate, store, and edit workspaces.</li>
          <li>
            To process AI requests: your prompts and relevant workspace content
            are sent to our AI provider (via OpenRouter) to produce the result
            you asked for. Rendering jobs run in isolated sandboxes (Daytona).
          </li>
          <li>To bill plans and credits (Stripe).</li>
          <li>To keep the Service safe: rate limits, quotas, abuse detection.</li>
          <li>To fix problems, via server logs and error reports.</li>
        </ul>
      </section>

      <section>
        <h2>3. Where your data lives</h2>
        <p>
          Workspace data is stored in a managed Postgres database (Neon, hosted
          on AWS in the United States). Generated images are stored in Google
          Cloud Storage. The application runs on Google Cloud. Data is
          encrypted in transit.
        </p>
      </section>

      <section>
        <h2>4. Sharing</h2>
        <p>
          We share data only with the processors that make the Service work —
          Clerk (auth), Stripe (payments), Neon (database), Google Cloud
          (hosting/storage), OpenRouter (AI processing), Daytona (sandboxed
          rendering) — and only what each needs. We do not sell personal data
          and we do not use your content to train our own models.
        </p>
      </section>

      <section>
        <h2>5. Retention & deletion</h2>
        <ul>
          <li>
            Your data is kept while your account exists so your workspaces stay
            available.
          </li>
          <li>
            <strong>Delete account</strong> (Settings → Danger zone) permanently
            removes your workspaces, edit history, credits, usage records,
            stored images, subscription record, and your authentication
            account. Any active subscription is canceled.
          </li>
          <li>Backups and logs expire on a rolling basis.</li>
        </ul>
      </section>

      <section>
        <h2>6. Your rights</h2>
        <p>
          Depending on where you live (e.g. GDPR in Europe, CCPA in
          California), you may have rights to access, correct, export, or
          delete your personal data, and to object to certain processing.
          Deletion is self-serve (above); for anything else, email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we’ll respond within
          30 days.
        </p>
      </section>

      <section>
        <h2>7. Children</h2>
        <p>
          StudyOS is not directed at children under 13, and we do not knowingly
          collect their data. If you believe a child under 13 has an account,
          contact us and we will delete it.
        </p>
      </section>

      <section>
        <h2>8. Changes</h2>
        <p>
          We’ll update this policy as the Service evolves and announce material
          changes in the app or by email.
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          Privacy questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>
    </LegalLayout>
  );
}
