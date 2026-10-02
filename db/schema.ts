import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  data: text("data").notNull(),
  updated: integer("updated").notNull(),
  revision: integer("revision").notNull().default(0),
});
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  project: text("project").notNull(),
  owner: text("owner").notNull(),
  kind: text("kind").notNull(),
  target: text("target").notNull(),
  status: text("status").notNull(),
  provider: text("provider"),
  payload: text("payload").notNull(),
  result: text("result"),
  error: text("error"),
  attempt: integer("attempt").notNull().default(1),
  updated: integer("updated").notNull(),
  reserved: integer("reserved").notNull().default(0),
});
export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  reserved: integer("reserved").notNull().default(0),
});
