import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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
  reserved: real("reserved").notNull().default(0),
  estimated: real("estimated").notNull().default(0),
  actualCredits: real("actual_credits"),
  billingDetails: text("billing_details"),
  settled: integer("settled").notNull().default(0),
  pollStarted: integer("poll_started"),
  nextPoll: integer("next_poll").notNull().default(0),
  pollFailures: integer("poll_failures").notNull().default(0),
});
export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  reserved: integer("reserved").notNull().default(0),
});

export const jobCharges = sqliteTable("job_charges", {
  id: text("id").primaryKey(), job: text("job").notNull(), owner: text("owner").notNull(), kind: text("kind").notNull(),
  attempt: integer("attempt").notNull(), provider: text("provider"), outcome: text("outcome").notNull(),
  estimated: real("estimated").notNull().default(0), actual: real("actual"), details: text("details"), created: integer("created").notNull(),
});
