import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// Executes an approved decision. The trust ladder lives HERE, not in the
// model: only approved decisions reach this function, and in later phases
// a `rules` check will decide whether approval can be implicit (auto).
// In the sandbox every action is a logged no-op; at home each case calls
// the Gmail/Calendar API.

export async function execute(decisionId: number): Promise<string> {
  const decision = db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, decisionId))
    .get();
  if (!decision) throw new Error(`Decision ${decisionId} not found`);
  if (decision.userResponse !== "approved")
    throw new Error(`Decision ${decisionId} is not approved`);
  if (decision.action === "none") return "nothing to execute";

  // Sandbox: record the side effect without performing it.
  const result = `sandbox: would ${decision.action} item ${decision.itemId}`;
  db.insert(schema.actions)
    .values({
      decisionId: decision.id,
      type: decision.action,
      payload: decision.actionParams,
      result,
      executedAt: new Date(),
    })
    .run();
  return result;
}
