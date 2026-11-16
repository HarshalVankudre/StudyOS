/**
 * The help centre's articles: which exist, under which topic, and which
 * others each one points to. The words live in the `help` namespace of every
 * dictionary, keyed by these slugs; lib/help/content.ts puts the two together
 * and fills in the numbers from the product's own constants.
 *
 * Slugs are English in every language: one address per article, so search
 * engines see one page, whatever language the visitor reads it in.
 *
 * Pure and client-safe.
 */

/** Topics, in the order the index shows them. */
export const HELP_TOPICS = ["start", "deadlines", "study", "account"] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export const HELP_ARTICLES = [
  { slug: "getting-started", topic: "start", related: ["plans-and-credits", "import-deadlines", "notion-anki-quizlet"] },
  { slug: "notion-anki-quizlet", topic: "start", related: ["getting-started", "flashcards", "your-data"] },
  { slug: "plans-and-credits", topic: "start", related: ["invite-friends", "getting-started", "your-data"] },
  { slug: "import-deadlines", topic: "deadlines", related: ["subscribe-to-your-calendar", "agenda", "reminders"] },
  { slug: "subscribe-to-your-calendar", topic: "deadlines", related: ["import-deadlines", "agenda"] },
  { slug: "agenda", topic: "deadlines", related: ["import-deadlines", "focus-and-insights", "subscribe-to-your-calendar"] },
  { slug: "reminders", topic: "deadlines", related: ["agenda", "flashcards", "import-deadlines"] },
  { slug: "flashcards", topic: "study", related: ["quizzes", "notion-anki-quizlet", "focus-and-insights"] },
  { slug: "quizzes", topic: "study", related: ["flashcards", "grades"] },
  { slug: "grades", topic: "study", related: ["quizzes", "agenda"] },
  { slug: "focus-and-insights", topic: "study", related: ["flashcards", "agenda"] },
  { slug: "share-a-page", topic: "account", related: ["flashcards", "invite-friends"] },
  { slug: "invite-friends", topic: "account", related: ["plans-and-credits", "share-a-page"] },
  { slug: "your-data", topic: "account", related: ["plans-and-credits", "share-a-page"] },
] as const satisfies readonly { slug: string; topic: HelpTopic; related: readonly string[] }[];

export type HelpSlug = (typeof HELP_ARTICLES)[number]["slug"];

export const HELP_SLUGS: readonly HelpSlug[] = HELP_ARTICLES.map((a) => a.slug);

export function isHelpSlug(value: string): value is HelpSlug {
  return (HELP_SLUGS as readonly string[]).includes(value);
}

/** The index, or one article. */
export const helpPath = (slug?: HelpSlug): string => (slug ? `/help/${slug}` : "/help");
