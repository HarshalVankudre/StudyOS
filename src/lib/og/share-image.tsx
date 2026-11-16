/**
 * The social share images (Open Graph and Twitter cards) of the public pages,
 * drawn with next/og (Satori: flexbox and a subset of CSS only) in the
 * StudyOS look: warm paper, ink, a lime pill, soft pastel tiles and a bold
 * serif headline. Static, English (an image cannot follow the visitor's
 * language) and rendered once at build time.
 *
 * Fonts: the headline uses Source Serif 4 Bold, the site's own serif
 * fallback (OFL), fetched from Google Fonts at build time and subset to the
 * characters drawn; `next build` already needs Google Fonts for next/font.
 * If that fetch fails, the image is still made, in next/og's default font.
 * Everything else is Geist Regular, the default font next/og ships with.
 * The Anthropic faces in public/fonts are proprietary and never used here.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { en } from "@/lib/i18n/dictionaries/en";

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };
export const SHARE_IMAGE_CONTENT_TYPE = "image/png";

const INK = "#141413";
const INK_SOFT = "#4d4c48";
const PAPER = "#faf9f5";
const CARD = "#fdfdfb";
const LINE = "#e7e4da";
const LIME = "#c8f24a";
const TINTS = {
  matcha: "#eaf9d6",
  cloud: "#e8f1ff",
  heather: "#f1e9ff",
  oat: "#f4ecd9",
} as const;
type Tint = keyof typeof TINTS;

const SERIF = "Source Serif 4";
const SANS = "Geist";

export interface ShareImageContent {
  headline: string;
  /** Pixels; sized so the headline breaks well (two or three lines). */
  headlineSize: number;
  subline: string;
  /** Short text on the lime pill. */
  pill: string;
  /** The card on the right. */
  card:
    | { kind: "prompt"; prompt: string; tiles: { label: string; tint: Tint }[] }
    | { kind: "checks"; items: { label: string; tint: Tint }[] };
}

const L = en.landing;

/**
 * The landing page (app/opengraph-image.tsx, app/twitter-image.tsx): the hero
 * promise, made to measure, and a description turning into a workspace.
 */
export const LANDING_SHARE: { alt: string; content: ShareImageContent } = {
  alt: `StudyOS: ${L.hero.titleLine1} ${L.hero.titleLine2}`,
  content: {
    headline: L.hero.titleLine1,
    headlineSize: 66,
    subline: L.hero.titleLine2,
    pill: "Free trial credits · No card needed",
    card: {
      kind: "prompt",
      prompt: "I’m a CS student taking Data Structures, Discrete Math and Calculus II.",
      tiles: [
        { label: L.chapters.deadlines.label, tint: "matcha" },
        { label: L.chapters.today.label, tint: "cloud" },
        { label: L.chapters.flashcards.label, tint: "heather" },
        { label: L.chapters.grades.label, tint: "oat" },
      ],
    },
  },
};

/** The pricing page (app/pricing/opengraph-image.tsx, twitter-image.tsx). */
export const PRICING_SHARE: { alt: string; content: ShareImageContent } = {
  alt: "StudyOS pricing: studying is free, AI work runs on credits.",
  content: {
    headline: "Studying is free. AI work runs on credits.",
    headlineSize: 74,
    subline: "Every account gets trial credits once, and Pro adds credits every month.",
    pill: "Every feature, on every plan",
    card: {
      kind: "checks",
      items: [
        { label: L.promises.items[0], tint: "matcha" },
        { label: "Unused credits never expire", tint: "cloud" },
        { label: "Cancel Pro anytime", tint: "heather" },
      ],
    },
  },
};

/** The StudyOS mark (components/BrandMark.tsx): two ink sheets over a lime one. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 1.5 21.5 6.6 12 11.7 2.5 6.6Z" fill={INK} />
      <path d="M2.5 10.2 12 15.3l9.5-5.1v3.1L12 18.4l-9.5-5.1Z" fill={INK} />
      <path d="M2.5 15.2 12 20.3l9.5-5.1v2.2L12 22.5l-9.5-5.1Z" fill={LIME} />
    </svg>
  );
}

function Check() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 999,
        background: LIME,
        flexShrink: 0,
      }}
    >
      <svg width={18} height={18} viewBox="0 0 24 24">
        <path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Satori lays a fragment's children out as a row, so every group is a real div. */
function Card({ card }: { card: ShareImageContent["card"] }) {
  // The tiles two to a row.
  const rows =
    card.kind === "prompt" ? card.tiles.reduce<(typeof card.tiles)[]>((acc, tile, i) => {
      if (i % 2 === 0) acc.push([tile]);
      else acc[acc.length - 1].push(tile);
      return acc;
    }, []) : [];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 400,
        padding: 28,
        gap: 16,
        background: CARD,
        border: `2px solid ${LINE}`,
        borderRadius: 36,
      }}
    >
      {card.kind === "prompt" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              padding: "18px 22px",
              borderRadius: 26,
              background: PAPER,
              border: `2px solid ${LINE}`,
              fontSize: 23,
              lineHeight: 1.38,
              color: INK_SOFT,
            }}
          >
            {card.prompt}
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <svg width={30} height={30} viewBox="0 0 24 24">
              <path d="M12 4v15m-6-6 6 6 6-6" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {rows.map((row, r) => (
            <div key={r} style={{ display: "flex", gap: 12 }}>
              {row.map((tile) => (
                <div
                  key={tile.label}
                  style={{
                    display: "flex",
                    flexGrow: 1,
                    flexBasis: 0,
                    padding: "18px 18px",
                    borderRadius: 22,
                    background: TINTS[tile.tint],
                    fontSize: 24,
                    color: INK,
                  }}
                >
                  {tile.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        card.items.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 22px",
              borderRadius: 24,
              background: TINTS[item.tint],
              fontSize: 25,
              lineHeight: 1.25,
              color: INK,
            }}
          >
            <Check />
            {item.label}
          </div>
        ))
      )}
    </div>
  );
}

/** Characters set in the serif: the subset requested from Google Fonts. */
function serifText(content: ShareImageContent): string {
  return [...new Set(`StudyOS${content.headline}`)].join("");
}

/**
 * Source Serif 4 Bold, subset to `text`, as TrueType (Google Fonts answers a
 * client without a browser user agent with TrueType, which Satori reads;
 * it cannot read WOFF2). Null when anything fails.
 */
async function loadSerif(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@700&text=${encodeURIComponent(text)}`,
      { cache: "force-cache", signal: AbortSignal.timeout(8_000) },
    ).then((res) => (res.ok ? res.text() : ""));
    const url = /src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/.exec(css)?.[1];
    if (!url) return null;
    const font = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(8_000) });
    return font.ok ? await font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** next/og's own default font, so body text looks the same with or without the serif. */
async function loadSans(): Promise<ArrayBuffer | null> {
  try {
    const file = await readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"));
    return Uint8Array.from(file).buffer;
  } catch {
    return null;
  }
}

export async function renderShareImage(content: ShareImageContent): Promise<ImageResponse> {
  const [serif, sans] = await Promise.all([loadSerif(serifText(content)), loadSans()]);
  // Custom fonts replace next/og's default, so the serif is used only when the
  // sans can be passed along with it.
  const fonts =
    serif && sans
      ? [
          { name: SERIF, data: serif, weight: 700 as const, style: "normal" as const },
          { name: SANS, data: sans, weight: 400 as const, style: "normal" as const },
        ]
      : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: "56px 56px 56px 64px",
          background: PAPER,
          color: INK,
          fontFamily: SANS,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 650 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Mark size={48} />
            <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 700, fontSize: 38, letterSpacing: -0.5 }}>
              StudyOS
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize: content.headlineSize,
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {content.headline}
            </div>
            <div
              style={{ display: "flex", marginTop: 22, fontSize: 31, lineHeight: 1.3, color: INK_SOFT, textWrap: "balance" }}
            >
              {content.subline}
            </div>
          </div>
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                padding: "15px 30px",
                borderRadius: 999,
                background: LIME,
                fontSize: 25,
                color: INK,
              }}
            >
              {content.pill}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "flex-end" }}>
          <Card card={content.card} />
        </div>
      </div>
    ),
    { ...SHARE_IMAGE_SIZE, ...(fonts ? { fonts } : {}) },
  );
}
