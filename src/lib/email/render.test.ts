// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { de } from "@/lib/i18n/dictionaries/de";
import { en } from "@/lib/i18n/dictionaries/en";
import { deadlineMessage, testEmailMessage, type DeadlineReminder } from "@/lib/notifications/content";
import { absoluteLink, escapeHtml, reminderHeaders, renderNotificationEmail } from "./render";

const links = {
  origin: "https://app.studyos.test",
  unsubscribeUrl: "https://app.studyos.test/api/notifications/unsubscribe?t=dXNlcl8x.sig",
};
const operator = { name: "Example GmbH", address: ["Musterstraße 1", "10115 Berlin"] };

/** A reminder about the student's own words, which may contain markup. */
const reminder = (title: string, context: string): DeadlineReminder => ({
  key: "row:r1:2026-11-19:7",
  title,
  context,
  dueDate: "2026-11-19",
  daysLeft: 7,
  exam: false,
  effortMinutes: null,
  target: { workspaceId: "ws1", pageId: "home", databaseId: "db1", rowId: "r1" },
});

describe("the reminder email", () => {
  it("uses the push message's words: title as subject and heading, body as text, link as the button", () => {
    const message = deadlineMessage(reminder("Lab report", "Biology 101"), en, "en");
    const email = renderNotificationEmail(message, en, links, null);
    expect(email.subject).toBe("Lab report is due in 7 days (Thu, Nov 19)");
    expect(email.html).toContain("<h1");
    expect(email.html).toContain(">Lab report is due in 7 days (Thu, Nov 19)</h1>");
    expect(email.html).toContain(`href="https://app.studyos.test/app/ws1?page=home&amp;db=db1&amp;row=r1"`);
    expect(email.html).toContain(">Open in StudyOS</a>");
    expect(email.text).toContain("Open in StudyOS: https://app.studyos.test/app/ws1?page=home&db=db1&row=r1");
    expect(email.text.startsWith("Lab report is due in 7 days (Thu, Nov 19)\n\nBiology 101. A little today keeps it light.\n")).toBe(true);
  });

  it("escapes the student's own words (course and assignment names) everywhere in the HTML", () => {
    const message = deadlineMessage(reminder(`<img src=x onerror="alert(1)">`, `Bio & "Chem" <b>101</b>`), en, "en");
    const { html, subject, text } = renderNotificationEmail(message, en, links, null);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Bio &amp; &quot;Chem&quot; &lt;b&gt;101&lt;/b&gt;");
    // The subject and text part are plain text, never HTML.
    expect(subject).toContain(`<img src=x onerror="alert(1)">`);
    expect(text).toContain(`Bio & "Chem" <b>101</b>`);
  });

  it("ends with why it came, the settings link, the unsubscribe link and the operator's postal address", () => {
    const { html, text } = renderNotificationEmail(testEmailMessage(en, "en"), en, links, operator);
    expect(html).toContain("You’re getting this because you turned on email reminders in StudyOS.");
    expect(html).toContain(`<a href="https://app.studyos.test/app/settings#notifications"`);
    expect(html).toContain(`<a href="https://app.studyos.test/api/notifications/unsubscribe?t=dXNlcl8x.sig"`);
    expect(html).toContain("Example GmbH<br>Musterstraße 1<br>10115 Berlin");
    expect(text).toContain("Change what you get: https://app.studyos.test/app/settings#notifications");
    expect(text).toContain("Unsubscribe: https://app.studyos.test/api/notifications/unsubscribe?t=dXNlcl8x.sig");
    expect(text.trimEnd().endsWith("Example GmbH\nMusterstraße 1\n10115 Berlin")).toBe(true);
    // Without a legal notice there is no operator block.
    expect(renderNotificationEmail(testEmailMessage(en, "en"), en, links, null).html).not.toContain("Example GmbH");
  });

  it("loads nothing from elsewhere: no images, no scripts, no remote styles", () => {
    const { html } = renderNotificationEmail(testEmailMessage(en, "en"), en, links, operator);
    expect(html).not.toMatch(/<img|<script|<link|url\(|src=/i);
    expect(html).toContain("background-color:#FAF9F5");
    expect(html).toContain("background-color:#C8F24A");
    expect(html).toContain("color:#141413");
  });

  it("is written in the student's language, right to left in Arabic", () => {
    const german = renderNotificationEmail(testEmailMessage(de, "de"), de, links, null);
    expect(german.subject).toBe(de.email.testTitle);
    expect(german.html).toContain(`<html lang="de" dir="ltr">`);
    expect(german.html).toContain(">In StudyOS öffnen</a>");
    expect(german.text).toContain(de.email.why);

    const arabic = renderNotificationEmail(testEmailMessage(ar, "ar"), ar, links, null);
    expect(arabic.html).toContain(`<html lang="ar" dir="rtl">`);
    expect(arabic.html).toContain(`<td dir="rtl"`);
    expect(arabic.html).toContain("text-align:right");
    expect(arabic.html).toContain(escapeHtml(ar.email.unsubscribe));
  });

  it("links only into the app", () => {
    expect(absoluteLink("https://a.test", "/app/insights?period=7d")).toBe("https://a.test/app/insights?period=7d");
    expect(absoluteLink("https://a.test", "//evil.test/x")).toBe("https://a.test/app");
    expect(absoluteLink("https://a.test", "https://evil.test")).toBe("https://a.test/app");
    expect(absoluteLink("https://a.test", "/\\evil.test")).toBe("https://a.test/app");
  });
});

describe("the reminder headers", () => {
  it("offer one-click unsubscribe (RFC 8058) by the HTTPS link only, and mark the message automatic", () => {
    expect(reminderHeaders(links.unsubscribeUrl)).toEqual({
      // No mailto: target: nobody processes such mails, so it would unsubscribe nobody.
      "List-Unsubscribe": `<${links.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
    });
  });
});
