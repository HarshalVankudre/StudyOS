import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/LegalLayout";
import { getI18n } from "@/lib/i18n/server";
import { operatorDetails } from "@/lib/legal/operator";
import { RETENTION } from "@/lib/ops/retention";
import { supportEmail } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.privacyTitle, description: dict.meta.privacyDescription, alternates: { canonical: "/privacy" } };
}

/*
 * Factual statements here follow the code: what is stored (prisma/schema),
 * what account deletion erases (lib/account/erase-user-data.ts), what the
 * daily retention job prunes (lib/ops/retention.ts), what "Download my data"
 * contains (lib/account/export-user-data.ts) and where AI requests go
 * (lib/ai/provider.ts: a bare claude-* model id goes to Anthropic directly,
 * anything else to OpenRouter; the text covers both configurations).
 * Notifications: which push services may receive a message
 * (lib/notifications/endpoint.ts), that it is encrypted for the device
 * (lib/notifications/webpush.ts, RFC 8291) and when a device's subscription
 * is dropped (lib/notifications/channels.ts, service.ts). Feedback and focus
 * sessions: the Feedback and FocusSession models (app/app/feedback-actions.ts,
 * app/app/focus-actions.ts). Images go to Google Cloud Storage and renders to
 * Daytona only when ASSETS_BUCKET / AGENT_SANDBOX are set (lib/ops/env.ts).
 * The controller line comes from the legal notice settings
 * (lib/legal/operator.ts). Change them together.
 *
 * Where things run is a fact of the deployment, not the code: the app, its
 * APIs and AI routes, the database and the scheduled jobs on our own server at
 * Hetzner (Helsinki, Finland); the public pages also on Vercel, which has no
 * database (lib/ops/site-split.ts). Update sections 3 to 5 when that changes.
 */
export default async function PrivacyPage() {
  const { dict, locale } = await getI18n();
  const contact = supportEmail();
  const mail = <a href={`mailto:${contact}`}>{contact}</a>;
  const operator = operatorDetails();

  return (
    <LegalLayout title="Privacy Policy" effectiveDate="2026-11-13" dict={dict} locale={locale}>
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
            <strong>Focus sessions</strong> — when you use the focus timer: the
            day and time you started, how long you focused, whether the session
            ran to the end, and the course or plan item you started it from, if
            any.
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
            <strong>Notifications</strong> — if you turn on reminders on a
            device: the push subscription your browser creates for it (a
            delivery address, called an endpoint, and two encryption keys) and
            a short device label such as “Chrome · Windows”; your reminder
            choices, time zone and language; and a log of the reminders we sent.
          </li>
          <li>
            <strong>Feedback</strong> — messages you send us with “Send
            feedback” in the app: the message, its kind (for example a bug or an
            idea), the page you sent it from, your language, and whether you
            agreed to be contacted about it.
          </li>
          <li>
            <strong>Shared pages</strong> — if you share a page, the private
            link, when it was turned on or off, and how often it was viewed.
            Anyone with the link sees the current content of that one page
            (never your grades, other pages or account). Visitors who report a
            shared page send a reason and an optional message; we do not store
            who they are.
          </li>
          <li>
            <strong>Invites</strong> — your personal invite code, and if you
            joined through someone’s invite: which account invited you, when,
            and whether the bonus was granted. The person who invited you sees
            only counts, never who you are. When the bonus is due we check with
            Clerk that your email address is verified and is not the
            inviter’s; we do not store email addresses for this. When an invite
            bonus is granted, we keep a pseudonymous fingerprint of the email
            address it went to (a keyed cryptographic hash of the address with
            capitals, dots and +tags removed) and whether it was for the invited
            friend or the inviter, never the address itself or your account. We
            keep it after you delete your account, so one mailbox can earn the
            invite bonus only once.
          </li>
          <li>
            <strong>Why you left</strong> — if you answer the optional question
            when you delete your account, we keep your answer (the reason you
            picked and anything you wrote), whether you had Free or Pro, and
            roughly how long you had the account (for example “under a week”),
            without your name, email or account.
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
          <li>
            <strong>Request data</strong> — like any website, the servers that
            deliver StudyOS receive your IP address and the details of each
            request (such as the page and your browser type), and record them in
            server logs.
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
            to produce the result you asked for. Depending on how the Service is
            configured, that provider is Anthropic, which runs the Claude models
            and receives the request directly, or OpenRouter, which passes the
            request to the company that runs the chosen model. Rendering jobs
            run in isolated sandboxes (Daytona) only when that feature is
            enabled.
          </li>
          <li>
            To import and sync deadlines: our servers fetch the calendar links
            you connected. Those links are never sent to the AI provider.
          </li>
          <li>
            To send the reminders you turned on: our server hands each one to
            the push service run by your browser’s maker (Google, Mozilla, Apple
            or Microsoft, depending on the browser), which delivers it to your
            device. The message is encrypted so that only your device can read
            it.
          </li>
          <li>
            To email the reminders you turned on, if you chose email as well as
            or instead of push: your daily plan, upcoming deadlines and exams,
            your streak and weekly recap, which can include the names of your
            courses and assignments. They go to the verified email address of
            your account through our email provider, which processes them on
            our behalf. StudyOS does not keep a copy of your address: it is read
            from your account (Clerk) when a reminder is sent, and we store only
            whether email reminders are on and whether your address refused
            delivery. Every email has a one-click unsubscribe link.
          </li>
          <li>
            To read and act on your feedback and, only if you agreed, to email
            you about it.
          </li>
          <li>To bill plans and credits (Stripe).</li>
          <li>To keep the Service safe: rate limits, quotas, abuse detection.</li>
          <li>To fix problems, via server logs and error reports.</li>
        </ul>
        <p>
          <strong>Legal bases</strong> (for readers in the EU, EEA and UK, under
          Article 6(1) GDPR):
        </p>
        <ul>
          <li>
            Providing the Service, the AI work you start, calendar import and
            sync, and billing: performance of our contract with you (point b).
          </li>
          <li>
            Push and email reminders, and emailing you about your feedback: your consent
            (point a), which you can withdraw at any time in Settings or by
            telling us, without affecting what happened before.
          </li>
          <li>
            Security, rate limits, abuse prevention (including the invite-bonus
            fingerprints), server logs and error reports: our legitimate
            interest in a secure and working Service and in preventing misuse
            of free credits (point f).
          </li>
          <li>
            Your optional answer about why you left: our legitimate interest in
            understanding what to improve (point f). Answering is up to you.
          </li>
          <li>
            Keeping records of payments and refunds, also after an account is
            deleted: our legal obligations under tax and commercial law (point
            c).
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Where your data lives</h2>
        <p>
          The signed-in app, its APIs and AI requests, the PostgreSQL database
          that stores your workspaces and study data, and our scheduled jobs
          run on our own server, rented from Hetzner Online GmbH in its data
          centre in Helsinki, Finland (EU). The public website pages (the
          landing page, pricing and the legal pages) are served by Vercel,
          which processes visitors’ requests for those pages (including IP
          addresses and request logs); it has no access to the database.
          Images produced by AI tools are stored in Google Cloud Storage only
          when that optional feature is switched on. Data is encrypted in
          transit, and connected calendar links are additionally encrypted in
          the database.
        </p>
      </section>

      <section>
        <h2>4. Sharing</h2>
        <p>
          We share data only with the processors that make the Service work,
          and only what each needs: Hetzner (server and database hosting),
          Vercel (public website), Clerk (sign-in and accounts), Stripe
          (payments), Anthropic, or OpenRouter and the model provider it routes
          a request to (AI processing), your browser’s push service (reminders
          you turned on), an email delivery service (email reminders you turned
          on), and, only when those features are switched on, Google
          Cloud Storage (generated images) and Daytona (sandboxed rendering).
          We do not sell personal data and we do not use your content to train
          our own models. What an AI provider retains from a request is
          governed by that provider’s terms.
        </p>
      </section>

      <section>
        <h2>5. International transfers</h2>
        <p>
          The database that holds your workspaces and study data is in the EU
          (section 3). Some of our processors, including Clerk, Stripe, Vercel
          and our AI provider, are US companies, so data they process may be
          transferred to the United States. For those transfers we rely on the
          EU–US Data Privacy Framework where the provider is certified under
          it, and otherwise on the European Commission’s Standard Contractual
          Clauses in the provider’s data processing terms.
        </p>
      </section>

      <section>
        <h2>6. Retention & deletion</h2>
        <ul>
          <li>
            Your data is kept while your account exists so your workspaces stay
            available, except for the automatic clean-up below. Feedback you
            send is kept until you delete your account.
          </li>
          <li>
            Workspaces you move to the trash are deleted for good after{" "}
            {RETENTION.trashedWorkspaceDays} days. The AI assistant’s
            conversation history is kept for up to{" "}
            {RETENTION.agentChatMessageDays} days (at most the latest{" "}
            {RETENTION.agentChatMaxPerWorkspace} messages per workspace), the
            history used to undo AI edits for up to{" "}
            {RETENTION.workspaceChangeDays} days, and the log of reminders sent
            for {RETENTION.notificationLogDays} days.
          </li>
          <li>
            A device’s push subscription is deleted when you turn reminders off
            on it, and when its push service reports that it no longer exists or
            keeps refusing our messages.
          </li>
          <li>
            <strong>Download my data</strong> (Settings → Your data) gives you a
            copy of what StudyOS stores for you — workspaces, study material,
            assistant conversations, study history, focus sessions, plans,
            connected calendars, notification settings and devices (without
            their push addresses), the feedback you sent, credits and
            subscription status — as one JSON file. Pages, tables and whole
            workspaces can also be exported as Markdown, CSV or a .zip from the
            workspace.
          </li>
          <li>
            <strong>Delete account</strong> (Settings → Danger zone) permanently
            removes your workspaces, uploaded study material, connected calendar
            links, assistant conversations, daily plans, study history, focus
            sessions, edit history, notification settings, push subscriptions
            and reminder log, the feedback you sent, your shared links and the
            reports about them, your invite code and invite records, credits,
            usage records,
            stored images, subscription record, and your authentication account.
            Any active subscription is canceled immediately. We keep a record
            that the account was deleted (its identifier and the date) so it is
            never billed or re-created by mistake, and the records of past
            payments and refunds.
          </li>
          <li>
            If someone you invited deletes their account, the invite record is
            kept without any link to them (its status and dates only); if you
            delete yours, the invites you made are deleted. Credits already
            granted stay, and the credit history keeps an internal reference so
            a bonus is never granted twice. The invite-bonus fingerprints
            described above are kept.
          </li>
          <li>
            An answer about why you left is stored only after your account is
            deleted, without any link to it, and deleted after{" "}
            {Math.round(RETENTION.deletionReasonDays / 365)} years.
          </li>
          <li>
            A withdrawal or cancellation you send with “Withdraw from contract
            here” or “Cancel contracts here” (the name, email address, contract
            and details you enter, and when we received it) is kept as a record
            of your declaration, to carry it out and to prove its receipt: our
            legal obligations and the performance of our contract (points c and
            b). It is part of Download my data when you sent it signed in, is
            kept without the link to your account if you delete it, and is
            deleted {Math.round(RETENTION.contractNoticeDays / 365)} years after
            we received it.
          </li>
          <li>Backups and logs expire on a rolling basis.</li>
        </ul>
      </section>

      <section>
        <h2>7. Cookies and local storage</h2>
        <p>
          StudyOS uses only what it needs to work, and no advertising or
          analytics cookies, so there is nothing to consent to:
        </p>
        <ul>
          <li>sign-in cookies set by Clerk, which keep you signed in;</li>
          <li>
            <code>studyos_locale</code>, the language you chose (one year);
          </li>
          <li>
            <code>studyos_tz</code>, your device’s time zone (one year), so dates
            and your daily plan use your local day;
          </li>
          <li>
            <code>__Host-studyos_ref</code>, set only when you open an invite link: the
            invite code and when you opened it, for up to 30 days, removed once
            your account is set up;
          </li>
          <li>
            your browser’s local storage, for things like the theme, a running
            focus timer and unsent drafts, which never leave your device unless
            you save them.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          Depending on where you live (e.g. GDPR in Europe, CCPA in
          California), you may have rights to access, correct, export, or
          delete your personal data, and to object to certain processing.
          Downloading your data and deleting your account are self-serve
          (above); for anything else, email {mail} and we’ll respond within
          30 days. In the EU you can also lodge a complaint with a data
          protection supervisory authority, in particular the one where you
          live.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          StudyOS is not directed at children under 13, and we do not knowingly
          collect their data. If you believe a child under 13 has an account,
          contact us and we will delete it.
        </p>
      </section>

      <section>
        <h2>10. Changes</h2>
        <p>
          We’ll update this policy as the Service evolves and announce material
          changes in the app or by email.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        {operator && (
          <p>
            The controller responsible for your data is {operator.name},{" "}
            {operator.address.join(", ")} (see the{" "}
            <Link href="/legal-notice">legal notice</Link>).
          </p>
        )}
        <p>Privacy questions: {mail}.</p>
      </section>
    </LegalLayout>
  );
}
