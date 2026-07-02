import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import * as gmail from "@/connectors/gmail";
import * as gcal from "@/connectors/gcal";

// Executes an approved decision. The trust ladder lives HERE, not in the
// model: only approved decisions reach this function, and in later phases
// a `rules` check will decide whether approval can be implicit (auto).
//
// Dispatch is by the item's external_id prefix: real Gmail/Calendar items
// hit the real APIs; fixture items are logged no-ops. Either way the side
// effect is recorded in `actions` for auditability.

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

  const item = db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, decision.itemId))
    .get();
  if (!item) throw new Error(`Item ${decision.itemId} not found`);

  const result = await perform(decision.action, item.externalId, decision.actionParams);

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

// Actions Argus can take back with one tap. Deliberately the same set that
// promoted rules may auto-execute: autonomy is only granted where undo exists.
export const REVERSIBLE_ACTIONS = ["archive", "label", "flag"];

// Reverse an executed action. Marks the action row reversed and restores
// the external state (or logs the no-op for sandbox items).
export async function undo(decisionId: number): Promise<string> {
  const action = db
    .select()
    .from(schema.actions)
    .where(eq(schema.actions.decisionId, decisionId))
    .get();
  if (!action) throw new Error(`No executed action for decision ${decisionId}`);
  if (action.reversedAt) throw new Error(`Action already undone`);
  if (!REVERSIBLE_ACTIONS.includes(action.type))
    throw new Error(`Action "${action.type}" is not reversible`);

  const decision = db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, decisionId))
    .get();
  const item = decision
    ? db.select().from(schema.items).where(eq(schema.items.id, decision.itemId)).get()
    : undefined;
  if (!item) throw new Error(`Item for decision ${decisionId} not found`);

  const params = action.payload
    ? (JSON.parse(action.payload) as Record<string, string>)
    : {};

  let result: string;
  if (item.externalId.startsWith("gmail:")) {
    const messageId = item.externalId.slice("gmail:".length);
    switch (action.type) {
      case "archive":
        result = await gmail.unarchive(messageId);
        break;
      case "label":
        result = await gmail.unlabel(messageId, params.label ?? "Argus");
        break;
      case "flag":
        result = await gmail.unlabel(messageId, "Argus/Needs-you");
        break;
      default:
        throw new Error(`No reverse for ${action.type}`);
    }
  } else {
    result = `sandbox: would reverse ${action.type} on ${item.externalId}`;
  }

  db.update(schema.actions)
    .set({ reversedAt: new Date() })
    .where(eq(schema.actions.id, action.id))
    .run();
  return result;
}

async function perform(
  action: string,
  externalId: string,
  paramsJson: string | null,
): Promise<string> {
  const params = paramsJson ? (JSON.parse(paramsJson) as Record<string, string>) : {};

  if (externalId.startsWith("gmail:")) {
    const messageId = externalId.slice("gmail:".length);
    switch (action) {
      case "archive":
        return gmail.archive(messageId);
      case "label":
        return gmail.label(messageId, params.label ?? "Argus");
      case "draft_reply":
        return gmail.draftReply(
          messageId,
          params.body ?? "(Argus drafted this placeholder — edit before sending.)",
        );
      case "flag":
        return gmail.label(messageId, "Argus/Needs-you");
      default:
        throw new Error(`Unsupported gmail action: ${action}`);
    }
  }

  if (externalId.startsWith("gcal:")) {
    const eventId = externalId.slice("gcal:".length);
    switch (action) {
      case "accept_event":
        return gcal.respond(eventId, "accepted");
      case "decline_event":
        return gcal.respond(eventId, "declined");
      default:
        throw new Error(`Unsupported calendar action: ${action}`);
    }
  }

  // Fixture items: record without performing.
  return `sandbox: would ${action} item ${externalId}`;
}
