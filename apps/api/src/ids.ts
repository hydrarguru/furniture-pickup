import { monotonicFactory } from "ulid";

/**
 * ULIDs that always increase within this process, even when several are created in the same
 * millisecond. History is ordered by (created_at, id), so a status change and the email it
 * triggers keep their real order.
 */
export const newId = monotonicFactory();
