import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalLayout } from "@/components/LegalLayout";
import { getI18n } from "@/lib/i18n/server";
import { operatorDetails, telHref } from "@/lib/legal/operator";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: `${dict.legal.notice} · StudyOS`, description: dict.legal.noticeDescription, alternates: { canonical: "/legal-notice" } };
}

/*
 * The legal notice (Impressum, § 5 DDG), built from the STUDYOS_OPERATOR_*
 * settings (lib/legal/operator.ts). Without a name and a postal address there
 * is nothing to show, so the page does not exist and no footer links to it.
 * No EU online dispute resolution (ODR) link: the platform closed in July
 * 2025 and the duty to link it went with it.
 */
export default async function LegalNoticePage() {
  const operator = operatorDetails();
  if (!operator) notFound();
  const { dict, locale } = await getI18n();

  return (
    <LegalLayout title="Legal Notice" dict={dict} locale={locale}>
      <section>
        <h2>Operator</h2>
        <p>Information pursuant to § 5 of the German Digital Services Act (DDG):</p>
        <address className="mt-3 not-italic text-ink">
          <strong>{operator.name}</strong>
          {operator.address.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      </section>

      <section>
        <h2>Contact</h2>
        <ul>
          <li>
            Email: <a href={`mailto:${operator.email}`}>{operator.email}</a>
          </li>
          {operator.phone && (
            <li>
              Phone: <a href={telHref(operator.phone)}>{operator.phone}</a>
            </li>
          )}
        </ul>
      </section>

      {operator.register && (
        <section>
          <h2>Register entry</h2>
          <p>{operator.register}</p>
        </section>
      )}

      {operator.vatId && (
        <section>
          <h2>VAT ID</h2>
          <p>
            VAT identification number pursuant to § 27a of the German Value Added Tax Act (UStG):{" "}
            {operator.vatId}
          </p>
        </section>
      )}

      {operator.responsible && (
        <section>
          <h2>Responsible for content</h2>
          <p>
            Responsible for the content pursuant to § 18(2) of the German Interstate Media Treaty
            (MStV): {operator.responsible}, address as above.
          </p>
        </section>
      )}

      <section>
        <h2>Consumer dispute resolution</h2>
        <p>
          We are neither obliged nor willing to take part in dispute resolution proceedings before a
          consumer arbitration board.
        </p>
      </section>
    </LegalLayout>
  );
}
