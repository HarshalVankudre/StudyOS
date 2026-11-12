import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { getI18n } from "@/lib/i18n/server";
import { RETENTION } from "@/lib/ops/retention";
import { supportEmail } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.privacyTitle, description: dict.meta.privacyDescription };
}

/*
 * Factual statements here follow the code: what is stored (prisma/schema),
 * what account deletion erases (lib/account/erase-user-data.ts), what the
 * daily retention job prunes (lib/ops/retention.ts), what "Download my data"
 * contains (lib/account/export-user-data.ts) and where AI requests go
 * (lib/ai/provider.ts). Change them together.
 */
export default async function PrivacyPage() {
  const { dict, locale } = await getI18n();
  const contact = supportEmail();
  const mail = <a href={`mailto:${contact}`}>{contact}</a>;

  return (
    <LegalLayout title="Privacy Policy" effectiveDate="2026-11-12" dict={dict} locale={locale}>
      <section>
        <p>
          This policy explains what data StudyOS (“we”) collects, why, and the
          choices you have. The short version: we collect what’s needed to run
          your study workspace, we don’t sell your data, and you can download
          or delete everything yourself at any time.
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
            workspaces generated for you, your edits, your conversations with
            the AI assistant, your daily study plans, your study history (which
            flashcards and quizzes you practised and when), and images produced
            by AI tools on your behalf.
          </li>
          <li>
            <strong>Study material</strong> — the text of lecture slides, notes,
            readings and syllabi you upload or paste. For uploaded files we keep
            the extracted text, page by page, so that flashcards and questions
            can show the passage they cite; we do not keep the original file.
          </li>
          <li>
            <strong>Calendar links</strong> — the links of calendar feeds you
            connect to import deadlines (for example from Canvas, Moodle,
            Blackboard, Brightspace or Google Calendar), stored encrypted, and
            the deadlines imported from them. If you subscribe to your deadlines
            from another calendar app, we also store the private link that app
            uses.
          </li>
          <li>
            <strong>Billing data</strong> — subscription status, credit balance
            and history, and records of payments and refunds (amounts and Stripe
            reference numbers). Card details go directly to Stripe; we never see
            or store them.
          </li>
          <li>
            <strong>Usage data</strong> — counts of AI requests and feature
            events (used for rate limiting, abuse prevention, study streaks, and
            improving the product). We do not use third-party advertising
            trackers.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To provide the Service: generate, store, and edit workspaces.</li>
          <li>
            To process AI requests: when you build a workspace, make study
            material, or message the AI assistant, the text needed for that
            request (your prompt, relevant workspace content, and the text of
            the material or syllabus pages you chose) is sent to our AI provider
            to produce the result you asked for. By default that provider is
            OpenRouter, which passes the request to the company that runs the
            model; the Service can also be configured to send requests to
            Anthropic directly. Rendering jobs run in isolated sandboxes
            (Daytona) when that feature is enabled.
          </li>
          <li>
            To import and sync deadlines: our servers fetch the calendar links
            you connected. Those links are never sent to the AI provider.
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
          encrypted in transit, and connected calendar links are additionally
          encrypted in the database.
        </p>
      </section>

      <section>
        <h2>4. Sharing</h2>
        <p>
          We share data only with the processors that make the Service work —
          Clerk (auth), Stripe (payments), Neon (database), Google Cloud
          (hosting/storage), OpenRouter and the model provider it routes a
          request to, or Anthropic when configured (AI processing), Daytona
          (sandboxed rendering) — and only what each needs. We do not sell
          personal data and we do not use your content to train our own models.
          What an AI provider retains from a request is governed by that
          provider’s terms.
        </p>
      </section>

      <section>
        <h2>5. Retention & deletion</h2>
        <ul>
          <li>
            Your data is kept while your account exists so your workspaces stay
            available, except for the automatic clean-up below.
          </li>
          <li>
            Workspaces you move to the trash are deleted for good after{" "}
            {RETENTION.trashedWorkspaceDays} days. The AI assistant’s
            conversation history is kept for up to{" "}
            {RETENTION.agentChatMessageDays} days (at most the latest{" "}
            {RETENTION.agentChatMaxPerWorkspace} messages per workspace), and
            the history used to undo AI edits for up to{" "}
            {RETENTION.workspaceChangeDays} days.
          </li>
          <li>
            <strong>Download my data</strong> (Settings → Your data) gives you a
            copy of what StudyOS stores for you — workspaces, study material,
            assistant conversations, study history, plans, connected calendars,
            credits and subscription status — as one JSON file. Pages,
            tables and whole workspaces can also be exported as Markdown, CSV or
            a .zip from the workspace.
          </li>
          <li>
            <strong>Delete account</strong> (Settings → Danger zone) permanently
            removes your workspaces, uploaded study material, connected calendar
            links, assistant conversations, daily plans, study history, edit
            history, credits, usage records, stored images, subscription record,
            and your authentication account. Any active subscription is
            canceled immediately. We keep a record that the account was deleted
            (its identifier and the date) so it is never billed or re-created
            by mistake, and the records of past payments and refunds.
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
          Downloading your data and deleting your account are self-serve
          (above); for anything else, email {mail} and we’ll respond within
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
        <p>Privacy questions: {mail}.</p>
      </section>
    </LegalLayout>
  );
}
