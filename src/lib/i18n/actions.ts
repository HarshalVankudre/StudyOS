"use server";

/**
 * Server Action: persist the user's chosen language.
 *
 * Cookies can only be written from a Server Action or Route Handler (not during
 * render), so the language switcher calls this, then refreshes. We set a plain,
 * year-long cookie readable by the server on every subsequent request.
 */
import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from "./config";

export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}
