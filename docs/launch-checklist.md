# Launch checklist

What stands between the code and a paying customer. Everything here needs your
accounts, money or legal details, so the code cannot do it for you. Work top to
bottom; each step names the setting it fills (all settings are described in
`src/lib/ops/env.ts` and `.env.example`, and the server refuses to start when a
required one is missing).

Where things run: the signed-in app, every API and AI route, the database and
the scheduled jobs on the Hetzner server (`infra/server/`), the public pages
(landing, pricing, legal) on Vercel, which forwards app paths to the server
(`src/lib/ops/site-split.ts`).

## 1. Domain and hosting

- [ ] Buy the domain. Point `app.<domain>` (A record) at the server,
      `95.216.184.152`. Point the bare domain (and `www`) at Vercel.
- [ ] Deploy the app to its real address, with services so HTTPS, the
      scheduled jobs and the daily backup are installed for it:
      `python infra/server/deploy.py --host herschel@95.216.184.152 --app-origin https://app.<domain> --services`.
      The deploy now applies database migrations and ends with a smoke test of
      the public pages; every line should say 200.
- [ ] Harden the server: `scp infra/server/harden.sh herschel@95.216.184.152:~`
      then `ssh herschel@95.216.184.152 ./harden.sh` (firewall, no SSH
      passwords, automatic security updates). Open a second SSH session to
      confirm you can still log in before closing the first.
- [ ] Off-server backups. The daily dump (02:45 UTC, 14 days kept) sits on
      the same disk as the database, so it does not survive losing the server.
      Either turn on Hetzner's server backups in the Cloud console, or rent a
      Storage Box and put `BACKUP_RSYNC_TARGET` (and `BACKUP_RSYNC_SSH="ssh -p 23"`)
      in `~/studyos.backup.env` on the server. Try one restore (the command is
      at the top of `infra/server/services.sh`).
- [ ] Uptime monitoring from outside (for example UptimeRobot or Better
      Stack, free tiers): check `https://app.<domain>/api/health` and
      `https://<domain>/` every few minutes and alert your phone. Nothing on
      the server can tell you the server is down.
- [ ] Vercel: upgrade the project to Pro (Hobby is for non-commercial use).
      Set `STUDYOS_APP_ORIGIN=https://app.<domain>` plus the public settings
      below, then promote the website build to production. Production there
      still serves the old four-month-old app with its own Neon database:
      decide whether anyone's data from it needs moving first.

## 2. Accounts (Clerk)

- [ ] Create a Clerk production instance for the domain and set
      `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (the server
      still runs on keyless development keys).
- [ ] Require a verified email address at sign-up, and under Restrictions
      turn on blocking of disposable email domains and of email subaddresses
      (`name+tag@`). Every new account gets free trial credits (and invite
      bonuses), so these settings are what keep one person from minting
      hundreds of accounts. If an abuse wave starts anyway,
      `STUDYOS_REFERRALS=off` pauses invite bonuses without a deploy of new
      code (set it and restart).
- [ ] Add the webhook `https://app.<domain>/api/clerk/webhook` with the event
      `user.deleted`, and set `CLERK_WEBHOOK_SIGNING_SECRET`.
- [ ] Sign up once on production and put your new user id (`user_…`) in
      `STUDYOS_ADMIN_USER_IDS`: the operator console is at `/app/admin`.

## 3. AI

- [ ] A production Anthropic key in `ANTHROPIC_API_KEY`, with a monthly spend
      limit set in the Anthropic console.
- [ ] Choose the models: `STUDYOS_FREE_MODEL` and `STUDYOS_PRO_MODEL` (both
      `claude-haiku-5-5` today). If a model costs more per action than the
      price list assumes, the app charges the real cost and shows it up front
      (`src/lib/price-list.ts`), so check the pricing page after changing them.

## 4. Payments (Stripe)

- [ ] In live mode, create the products: Pro monthly, Pro yearly and the credit
      pack (a one-time price). Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`,
      `STRIPE_PRICE_PRO_ANNUAL` and `STRIPE_PRICE_CREDIT_PACK` (without the
      last one the pack is sold at $10 from built-in pricing).
- [ ] Webhook `https://app.<domain>/api/stripe/webhook` with these events:
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `customer.subscription.created`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `invoice.paid`, `charge.refunded`,
      `charge.refund.updated`, `charge.dispute.created`,
      `charge.dispute.closed`. Set `STRIPE_WEBHOOK_SECRET`.
- [ ] Payment methods (Settings → Payments → Payment methods): switch on
      PayPal and SEPA Direct Debit next to cards. German buyers pay online
      mostly with PayPal (about 29% of online sales, EHI 2025) and direct debit;
      cards come fourth. Checkout shows whatever is enabled there (the code
      names no methods) and already handles payments that confirm later (the
      `checkout.session.async_payment_succeeded` webhook below). Do one test
      purchase with each.
- [ ] Customer portal (Settings → Billing → Customer portal): allow cancelling
      and updating the payment method. After a lost credit-pack chargeback the
      app sets the subscription to end at period end; if the portal lets
      customers "renew" a cancelled subscription, they can undo that, so
      consider turning renewing off.
- [ ] Selling to EU consumers:
  - [ ] Stripe Tax: origin address, registrations (Germany, EU One-Stop Shop,
        UK if you sell there), default tax code for a digital service, default
        tax behaviour "inclusive". Then `STRIPE_AUTOMATIC_TAX=1`. Ask a tax
        adviser first if you use the small-business exemption (§ 19 UStG).
  - [ ] Settings → Business → Public details: Terms URL
        `https://<domain>/terms`. Then `STRIPE_TERMS_CONSENT=1` (checkout
        fails without the URL).
  - [ ] With the Terms checkbox on, every credit pack gets an invoice PDF
        whose footer repeats the consent, and the receipt carries a short
        confirmation (the "durable medium" EU consumer law wants before the
        withdrawal waiver counts). Turn on Settings → Customer emails →
        "Successful payments" (and invoice emails), or buyers never receive
        it. `STRIPE_PACK_INVOICES=1` gives pack invoices even without the
        checkbox.
  - [ ] Use single-currency Prices (no extra `currency_options`) whose tax
        behaviour matches `STRIPE_TAX_BEHAVIOR`: the app refuses to sell a
        Price whose shown amount, currency or VAT note could differ from what
        Checkout charges, and reports it in the server log.
  - [ ] Subscription invoices: Settings → Invoices → default footer, so Pro
        invoices carry the confirmation too. Suggested text: "At checkout you
        agreed to the Terms of Service (https://<domain>/terms) and asked
        StudyOS to start Pro immediately. If you are a consumer in the EU, the
        EEA or the UK and withdraw within 14 days, you pay for the share
        already provided (Terms, section 4)."
- [ ] Test the whole path in test mode first (subscribe, buy a pack, refund,
      cancel), then once in live mode with a real card and refund it.

## 5. Legal

- [ ] Legal notice (Impressum, required in Germany and the EU): set
      `STUDYOS_OPERATOR_NAME` and `STUDYOS_OPERATOR_ADDRESS` (plus
      `STUDYOS_OPERATOR_EMAIL`, and `…_REGISTER`, `…_VAT_ID`,
      `…_RESPONSIBLE` if they apply) on BOTH the server and Vercel.
      `/legal-notice` and its footer links appear once name and address are
      set; the Terms' withdrawal form and the privacy policy's controller line
      use them too.
- [ ] `STUDYOS_SUPPORT_EMAIL` on your own domain (it is a personal address
      today and appears on every public page). Optionally
      `STUDYOS_SECURITY_EMAIL` (e.g. security@…) for the vulnerability
      contact in `/.well-known/security.txt`; it falls back to the support
      address.
- [ ] Have a lawyer read `/terms` and `/privacy` (English only today; German
      consumers may expect a German version), the withdrawal section in
      particular.
- [ ] Withdrawal function and cancellation button (§ 356a BGB / Art. 11a of
      the Consumer Rights Directive, and § 312k BGB): `/withdraw` ("Withdraw
      from contract here", „Vertrag widerrufen“) and `/cancel` ("Cancel
      contracts here", „Verträge hier kündigen“) work signed out, in every
      language, and are linked from every public footer, Settings → Plan &
      billing, the credits page and the Terms (the footer links appear once
      billing is configured). Each notice is stored and the sender gets an
      acknowledgement of receipt by email, so **email (section 7) must be
      configured before selling**; the startup log warns otherwise. You get an
      email for each one too. Withdrawals are never processed automatically,
      and neither are cancellations sent signed out, extraordinary ones or
      ones for a chosen date: process the open ones from `/app/admin`
      ("Contract notices"; refund under Terms section 4, or cancel in Stripe),
      confirm the outcome to the customer, then mark them done. An ordinary
      cancellation of Pro by a signed-in subscriber is set to end at period
      end in Stripe at once. Have the lawyer check the labels, the wording of
      both pages and the acknowledgement email.
- [ ] Data processing agreements (Art. 28 GDPR) with Hetzner, Clerk, Stripe,
      Anthropic and Vercel (each offers one in its dashboard or terms), and a
      record of processing activities.

## 6. Reminders and calendar links

- [ ] Push reminders: generate VAPID keys (command in `.env.example`) and set
      `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
      (`mailto:` your support address). Keep the keys forever: changing them
      drops every device's subscription.
- [ ] `FEED_URL_KEY` (encrypts connected calendar links) and
      `MAINTENANCE_SECRET` are generated on the server by the first deploy
      (`~/studyos.secrets.env`). Back that file up somewhere safe: losing
      `FEED_URL_KEY` disconnects every student's calendar.

## 7. Email

- [ ] Choose a provider with SMTP (Postmark, Brevo, Amazon SES, Resend,
      Mailgun…), verify your sending domain there and publish its SPF, DKIM
      and DMARC records. Then set `SMTP_URL` (for example
      `smtps://user:pass@smtp.example.com:465`), `MAIL_FROM`
      (`StudyOS <hello@<domain>>`) and optionally `MAIL_REPLY_TO`. The startup
      summary shows `email: on`. Students turn email reminders on in Settings;
      every email has a one-click unsubscribe, built on `APP_URL`, so that
      must be the app's own origin (`https://app.<domain>`, no redirect).
- [ ] Set `UNSUBSCRIBE_SECRET` (a long random string, in the secrets file)
      before the first reminder goes out, so unsubscribe links do not depend
      on `CLERK_SECRET_KEY`. To rotate it later, move the old value to
      `UNSUBSCRIBE_SECRET_PREVIOUS`.
- [ ] Send yourself a test from Settings → Notifications → "Send a test
      email", and check it lands in the inbox, not spam.
- [ ] Note in the privacy policy is generic ("an email delivery service");
      name the provider there if your lawyer prefers.
- Not built: welcome or marketing emails, and handling the provider's
  later bounce or complaint reports (its own suppression list covers them).
  Rotating `CLERK_SECRET_KEY` breaks outstanding invite cookies, and
  unsubscribe links in emails already sent unless `UNSUBSCRIBE_SECRET` is set
  (both are keyed from it otherwise). It also makes refused addresses get one
  more email each (their stored hash is keyed from it).

## 8. Go-live check

- [ ] New account from a private window: trial credits arrive, build a
      workspace, Today plans the day, a focus session saves, feedback reaches
      `/app/admin`.
- [ ] Share a page and open the link signed out; report it and disable it
      from `/app/admin`.
- [ ] Download my data, then delete the account; the operator console counts
      drop accordingly.
