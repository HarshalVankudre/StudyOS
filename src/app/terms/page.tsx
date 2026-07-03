import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service · StudyOS",
  description: "The terms that govern your use of StudyOS.",
};

const CONTACT = "harshalvankudre@gmail.com";

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" effectiveDate="July 3, 2026">
      <section>
        <p>
          These Terms of Service (“Terms”) govern your use of StudyOS (the
          “Service”), an AI-powered study workspace. By creating an account or
          using the Service you agree to these Terms. If you do not agree, do
          not use the Service.
        </p>
      </section>

      <section>
        <h2>1. The Service</h2>
        <p>
          StudyOS generates and hosts study workspaces — pages, databases,
          planners, and related tools — from your descriptions, and provides an
          AI assistant that can edit them on your instruction. Features may
          change, improve, or be withdrawn as the product evolves.
        </p>
      </section>

      <section>
        <h2>2. Eligibility & accounts</h2>
        <ul>
          <li>You must be at least 13 years old to use StudyOS.</li>
          <li>
            You are responsible for your account and for keeping your sign-in
            method secure. Authentication is provided by Clerk.
          </li>
          <li>
            You may delete your account at any time from Settings; this
            permanently removes your workspaces and data (see the Privacy
            Policy).
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Plans, credits & billing</h2>
        <ul>
          <li>
            AI features consume <strong>credits</strong>. Free accounts receive
            a monthly credit allowance; the Pro subscription includes a larger
            monthly allowance. Monthly allowances refresh but do not stack;
            separately purchased credit packs never expire.
          </li>
          <li>
            Payments and subscriptions are processed by Stripe. Subscriptions
            renew monthly until canceled; you can cancel anytime from the
            billing portal and keep Pro until the end of the paid period.
          </li>
          <li>
            Credit consumption scales with how much work the AI performs for a
            request. Rate limits apply to keep the Service reliable for
            everyone.
          </li>
          <li>
            If something goes wrong with a purchase, contact{" "}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will make it
            right.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. AI-generated content</h2>
        <p>
          StudyOS uses large language models to generate workspaces, edits, and
          study material. <strong>AI output can be wrong.</strong> Always verify
          dates, facts, calculations, and academic content before relying on
          them. StudyOS is a study aid, not a source of professional, legal, or
          academic advice, and is not responsible for academic outcomes.
        </p>
      </section>

      <section>
        <h2>5. Your content</h2>
        <p>
          You own the content you put into StudyOS and the workspaces generated
          for you. You grant us the limited rights needed to operate the
          Service: storing your content, processing it with AI providers to
          fulfil your requests, and displaying it back to you. We do not sell
          your content or use it to train our own models.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <ul>
          <li>No unlawful, infringing, or harmful use.</li>
          <li>
            No attempts to break, overload, or circumvent limits, quotas, or
            security measures (including the sandboxed rendering and embedded
            component environments).
          </li>
          <li>No reselling or automated scraping of the Service.</li>
          <li>
            Use StudyOS honestly in your studies — you are responsible for
            complying with your institution’s academic-integrity rules.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Disclaimers & liability</h2>
        <p>
          The Service is provided “as is” without warranties of any kind. To
          the maximum extent permitted by law, our total liability for any
          claim related to the Service is limited to the amount you paid us in
          the twelve months before the claim. We are not liable for indirect or
          consequential damages, or for loss of data caused by events outside
          our reasonable control.
        </p>
      </section>

      <section>
        <h2>8. Termination</h2>
        <p>
          You may stop using StudyOS at any time. We may suspend or terminate
          accounts that violate these Terms or create risk for the Service or
          other users; where reasonable, we will warn you first.
        </p>
      </section>

      <section>
        <h2>9. Changes</h2>
        <p>
          We may update these Terms as the Service evolves. Material changes
          will be announced in the app or by email. Continuing to use the
          Service after a change takes effect means you accept the updated
          Terms.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          Questions about these Terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>
    </LegalLayout>
  );
}
