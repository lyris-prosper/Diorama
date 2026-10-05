import { say } from "./say";
import { bindings } from "./storage";
import { WORLD_ESTIMATE, TRIPO_ESTIMATE } from "./provider-http";
export const estimate = (kind: string) => kind === "world" ? WORLD_ESTIMATE : kind === "furniture" ? TRIPO_ESTIMATE : 0;
export function budgetLimit(kind: string) {
  const secrets = bindings().secrets;
  const value = Number(kind === "world" ? secrets.WORLDLABS_CREDIT_LIMIT ?? 6770 : secrets.TRIPO_CREDIT_LIMIT ?? 5000);
  if (!Number.isFinite(value) || value < 0) throw say("预算上限配置无效，已停止提交。", "The budget limit setting is invalid, so nothing was submitted.");
  return kind === "world" ? Math.min(7000,value) : value;
}
// Keys are shared by this installation, so the cap includes every owner/project.
export const BUDGET_USED_SQL = `(SELECT COALESCE(SUM(reserved),0) FROM jobs WHERE kind=?) + (SELECT COALESCE(SUM(COALESCE(actual,estimated)),0) FROM job_charges WHERE kind=?)`;
export async function budgetSummary(kind: string) {
  const row = await bindings().db.prepare(`SELECT
    (SELECT COALESCE(SUM(reserved),0) FROM jobs WHERE kind=?) AS reserved,
    (SELECT COALESCE(SUM(actual),0) FROM job_charges WHERE kind=?) AS actual,
    (SELECT COALESCE(SUM(estimated),0) FROM job_charges WHERE kind=? AND actual IS NULL) AS unconfirmed`).bind(kind,kind,kind).first<any>();
  return { limit: budgetLimit(kind), reserved: row.reserved, actual: row.actual, unconfirmed: row.unconfirmed };
}
export async function settle(j: any, outcome: string, cost: number | null, details: unknown) {
  const { db } = bindings();
  const serialized = JSON.stringify(details ?? null);
  // Preserve each attempt's charge. Download retries cannot duplicate a charge.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO job_charges(id,job,owner,kind,attempt,provider,outcome,estimated,actual,details,created)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=? AND attempt=?)`)
      .bind(`${j.id}:${j.attempt}`,j.id,j.owner,j.kind,j.attempt,j.provider,outcome,
        ["success","expired"].includes(outcome) ? j.estimated : 0,cost,serialized,Date.now(),j.id,j.attempt),
    db.prepare("UPDATE jobs SET reserved=0,actual_credits=?,billing_details=?,settled=1 WHERE id=? AND attempt=?")
      .bind(cost,serialized,j.id,j.attempt),
  ]);
}
