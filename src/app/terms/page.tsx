import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import {
  ACTION_PRICES,
  FREE_FAILURES_PER_DAY,
  PRO_MONTHLY_CREDITS,
  REFERRAL_CREDITS,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
} from "@/lib/price-list";
import { getI18n } from "@/lib/i18n/server";
import { operatorDetails } from "@/lib/legal/operator";
import { supportEmail } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.termsTitle, description: dict.meta.termsDescription, alternates: { canonical: "/terms" } };
}

/*
 * Section 3 states the credit rules lib/credits.ts and the charging paths
 * implement; every number is read from the price list (lib/price-list.ts),
 * so the two cannot drift apart. Section 4 (EU/UK right of withdrawal) is
 * what the checkout consent text (STRIPE_TERMS_CONSENT, lib/billing.ts)
 * refers to: change them together.
 */
export default async function TermsPage() {
  const { dict, locale } = await getI18n();
  const CONTACT = supportEmail();
  const n = (value: number) => value.toLocaleString("en-US");
  // Withdrawal notices go to the operator named in the legal notice when it
  // is configured (lib/legal/operator.ts), otherwise to support.
  const operator = operatorDetails();
  const operatorLine = operator ? [operator.name, ...operator.address].join(", ") : "StudyOS";
  const withdrawalEmail = operator?.email ?? CONTACT;
  return (
    <LegalLayout title="Terms of Service" effectiveDate="2026-11-13" dict={dict} locale={locale}>
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
          AI assistant that can edit them on your instruction. It can also make
          study material (notes, flashcards and practice questions) from
          documents you upload, import deadlines from calendar links you
          connect, and plan your study days. Features may change, improve, or
          be withdrawn as the product evolves.
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
            New accounts receive a one-time trial of {n(TRIAL_CREDITS)}{" "}
            <strong>credits</strong>. The Free plan includes no further
            credits. The Pro subscription includes {n(PRO_MONTHLY_CREDITS)}{" "}
            credits for each paid month (with yearly billing, for each month of
            the paid year), higher hourly limits and a higher limit on what one
            assistant message may spend; it does not unlock additional
            features. Every grant is added to your balance; credits do not
            expire and nothing resets the balance. Separately purchased credit
            packs never expire.
          </li>
          <li>
            AI features consume credits at the published price of each action,
            which is shown in the Service before you start the action: building
            a workspace (its setup questions included) costs{" "}
            {n(ACTION_PRICES.build)} credits, one assistant message{" "}
            {n(ACTION_PRICES.message)} credits, a study kit{" "}
            {n(ACTION_PRICES.studyKitPart)} credits for each part of your
            material it processes, and a rendered visual{" "}
            {n(ACTION_PRICES.render)} credits.
          </li>
          <li>
            If the AI model in use makes an action cost more than its listed
            price, that action is charged what it actually costs, and the most
            it can cost is shown before you start it. One assistant message
            never costs more than {n(TURN_CREDIT_CAP.free)} credits on Free or{" "}
            {n(TURN_CREDIT_CAP.pro)} credits on Pro, its rendered visuals
            included.
          </li>
          <li>
            An action that fails and delivers nothing is not charged; for
            assistant messages this applies to up to{" "}
            {n(FREE_FAILURES_PER_DAY)} failed messages a day, and a further
            failed message is charged like a stopped one. If you stop an
            action, you are charged the share of its price for the work done
            before you stopped it, never more than its price; a stopped study
            kit is charged for each part it had finished. A study-kit part that
            fails is not charged.
          </li>
          <li>
            Studying itself — reviewing flashcards, taking quizzes, the daily
            plan, grade tracking, editing your workspaces, deadline import and
            sync, and export — does not consume credits on any plan.
          </li>
          <li>
            Payments and subscriptions are processed by Stripe. Subscriptions
            renew each billing period (monthly, or yearly where offered) until
            canceled; you can cancel anytime from the billing portal and keep
            Pro until the end of the paid period. You can also cancel without
            signing in with <a href="/cancel">“Cancel contracts here”</a>{" "}
            (linked at the bottom of every page), or by email to{" "}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>; we confirm receipt by
            email. Deleting your account cancels any subscription immediately.
          </li>
          <li>
            <strong>Invite friends.</strong> When someone who signed up through
            your personal invite link builds their first workspace, with a
            verified email address, you each receive{" "}
            {n(REFERRAL_CREDITS)} credits. You can earn invite credits for up
            to {n(REFERRAL_MAX_REWARDS)} friends, and for{" "}
            {n(REFERRAL_MAX_PER_DAY)} in any 24 hours; friends you invite beyond
            that still receive theirs. Only new accounts count. Inviting
            yourself or your own other accounts, or other misuse, earns nothing,
            and we may remove credits obtained that way. Invite credits have no
            cash value and cannot be exchanged, transferred or refunded.
          </li>
          <li>
            Rate limits apply to keep the Service reliable for everyone.
          </li>
          <li>
            A second subscription created by mistake, and any payment taken
            after your account was deleted, are refunded automatically. When a
            credit pack payment is refunded or successfully disputed, the
            matching share of its credits is removed from what is left of your
            balance (never below zero). If you successfully dispute a credit
            pack payment, your Pro subscription will not renew: you keep Pro,
            and the monthly credits of the period you have already paid for,
            until that period ends, and you are not charged again. If you
            successfully dispute a Pro subscription payment, the subscription
            ends at once. When a subscription payment is refunded
            in full, it stops adding further monthly credits; credits already
            added stay, except after a withdrawal (section 4).
          </li>
          <li>
            If something goes wrong with a purchase, contact{" "}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will make it
            right.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Right of withdrawal (consumers in the EU, EEA and UK)</h2>
        <p>
          If you are a consumer living in the European Union, the European
          Economic Area or the United Kingdom, you have the right to withdraw
          from a purchase (a Pro subscription or a credit pack) within 14 days
          without giving any reason.
        </p>
        <ul>
          <li>
            <strong>Withdrawal period.</strong> 14 days from the day the
            contract is concluded, which is the day of your purchase.
          </li>
          <li>
            <strong>How to withdraw.</strong> Tell us ({operatorLine}) by a
            clear statement. The simplest way is our online withdrawal
            function, <a href="/withdraw">“Withdraw from contract here”</a>{" "}
            (also linked at the bottom of every page; no sign-in needed): fill
            in the form and select “Confirm withdrawal”, and we email you an
            acknowledgement of receipt with the date and time we received it.
            You can also send an email to{" "}
            <a href={`mailto:${withdrawalEmail}`}>{withdrawalEmail}</a> or use
            the model form below, but you do not have to. Sending your notice
            before the 14 days have passed is enough.
          </li>
          <li>
            <strong>What happens then.</strong> We refund every payment we
            received from you for that purchase without undue delay and at the
            latest within 14 days of receiving your notice, to the same means
            of payment and at no cost to you.
          </li>
          <li>
            <strong>Pro started right away.</strong> If you asked for Pro to
            start during the withdrawal period and then withdraw, you pay an
            amount in proportion to what was provided until you told us, and
            the rest is refunded. That share is the part of the billing period
            that had passed or, if higher, the part of that period’s Pro
            credits you had already used. Pro credits of that period you had
            not used are removed from your balance. The right of withdrawal
            ends once the service has been fully provided.
          </li>
          <li>
            <strong>Credit packs.</strong> Credits are digital content supplied
            at once. If at checkout you expressly agreed that we add the
            credits immediately and acknowledged that you thereby lose your
            right of withdrawal, the right of withdrawal ends when the credits
            are added to your balance.
          </li>
        </ul>
        <p>
          <strong>Model withdrawal form</strong> (complete and return it only
          if you wish to withdraw):
        </p>
        <blockquote>
          To: {operatorLine}, {withdrawalEmail}
          <br />
          I hereby give notice that I withdraw from my contract for the
          provision of the following service: …
          <br />
          Ordered on: …
          <br />
          Name of consumer: …
          <br />
          Address of consumer (or the email address of the StudyOS account): …
          <br />
          Signature (only if this form is sent on paper): …
          <br />
          Date: …
        </blockquote>
      </section>

      <section>
        <h2>5. AI-generated content</h2>
        <p>
          StudyOS uses large language models to generate workspaces, edits, and
          study material. <strong>AI output can be wrong.</strong> Always verify
          dates, facts, calculations, and academic content before relying on
          them. StudyOS is a study aid, not a source of professional, legal, or
          academic advice, and is not responsible for academic outcomes.
        </p>
      </section>

      <section>
        <h2>6. Your content</h2>
        <p>
          You own the content you put into StudyOS and the workspaces generated
          for you. You grant us the limited rights needed to operate the
          Service: storing your content, processing it with AI providers to
          fulfil your requests, fetching the calendar links you connect, and
          displaying it back to you. We do not sell
          your content or use it to train our own models.
        </p>
      </section>

      <section>
        <h2>7. Acceptable use</h2>
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
        <h2>8. Disclaimers & liability</h2>
        <p>
          The Service is provided “as is” without warranties of any kind. To
          the maximum extent permitted by law, our total liability for any
          claim related to the Service is limited to the amount you paid us in
          the twelve months before the claim. We are not liable for indirect or
          consequential damages, or for loss of data caused by events outside
          our reasonable control.
        </p>
        <p>
          None of these limits applies where the law does not allow liability
          to be limited: in particular for intent or gross negligence, for
          injury to life, body or health, under mandatory product liability
          law, or for the breach of an essential contractual obligation, where
          liability is limited to the damage typically foreseeable. If you are
          a consumer, your statutory rights are not affected.
        </p>
      </section>

      <section>
        <h2>9. Termination</h2>
        <p>
          You may stop using StudyOS at any time. We may suspend or terminate
          accounts that violate these Terms or create risk for the Service or
          other users; where reasonable, we will warn you first.
        </p>
      </section>

      <section>
        <h2>10. Changes</h2>
        <p>
          We may update these Terms as the Service evolves. Material changes
          will be announced in the app or by email at least 30 days before
          they take effect. If you do not agree, you can cancel your
          subscription or delete your account before then; continuing to use
          the Service after a change takes effect means you accept the updated
          Terms.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about these Terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>
    </LegalLayout>
  );
}
