import type { Database, DatabaseProperty, SelectOption } from "./types";

export function getProperty(
  db: Database,
  id: string,
): DatabaseProperty | undefined {
  return db.properties.find((p) => p.id === id);
}

export function getOption(
  prop: DatabaseProperty | undefined,
  id: string,
): SelectOption | undefined {
  return prop?.options?.find((o) => o.id === id);
}

/** The property treated as a row's title: first text property, else the first. */
export function titleProperty(db: Database): DatabaseProperty {
  return db.properties.find((p) => p.type === "text") ?? db.properties[0];
}
