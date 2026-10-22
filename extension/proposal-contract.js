// Generated from src/lib/copilot-proposal.ts; run scripts/build-copilot-extension-contract.mjs.
(() => {
// Shared, bounded proposal contract. No network, database or browser access.
const COPILOT_PROPOSAL_MAX_BYTES = 32768;
const COPILOT_PROPOSAL_MAX_CHANGES = 20;
class CopilotProposalError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new CopilotProposalError("Expected a proposal object.");
    return value;
}
function keys(value, allowed) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new CopilotProposalError("Proposal contains unsupported fields. Ask Copilot for supported task changes only.");
}
function text(value, name, limit, empty = false) {
    if (typeof value !== "string" || (!empty && !value.trim()) || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
        throw new CopilotProposalError(`${name} must be ${empty ? "" : "nonempty "}text of at most ${limit} characters.`);
    }
    return value.trim();
}
function parseProposalChange(value) {
    const item = record(value);
    const reason = text(item.reason, "Reason", 1000);
    if (item.op === "note") {
        keys(item, ["op", "task", "text", "reason"]);
        return { op: "note", task: taskId(item.task), text: text(item.text, "Note", 4000), reason };
    }
    if (item.op !== "create" && item.op !== "update")
        throw new CopilotProposalError("Supported changes are create, update, and note. Deletion and arbitrary actions are not supported.");
    keys(item, item.op === "create" ? ["op", "set", "reason"] : ["op", "task", "set", "reason"]);
    const input = record(item.set);
    keys(input, ["title", "summary", "status", "dueAt", "bucket"]);
    if (!Object.keys(input).length)
        throw new CopilotProposalError("Choose at least one task field to change.");
    const set = {};
    if ("title" in input)
        set.title = text(input.title, "Title", 500);
    if ("summary" in input)
        set.summary = text(input.summary, "Summary", 4000, true);
    if ("bucket" in input)
        set.bucket = text(input.bucket, "Bucket", 200);
    if ("status" in input) {
        if (!["todo", "active", "waiting", "done"].includes(input.status))
            throw new CopilotProposalError("Unknown task status.");
        set.status = input.status;
    }
    if ("dueAt" in input) {
        if (input.dueAt === null)
            set.dueAt = null;
        else {
            const date = text(input.dueAt, "Due date", 40);
            if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date)))
                throw new CopilotProposalError("Due dates need an ISO timestamp with a time zone, or null to clear.");
            // Reject rollover dates, which Date.parse otherwise silently normalizes.
            const day = date.slice(0, 10);
            if (!Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
                throw new CopilotProposalError("Due date is not a real calendar date.");
            set.dueAt = new Date(date).toISOString();
        }
    }
    if (item.op === "create") {
        if (!set.title || !set.bucket)
            throw new CopilotProposalError("New tasks need a title and an existing bucket.");
        return { op: "create", set: set, reason };
    }
    return { op: "update", task: taskId(item.task), set, reason };
}
function taskId(value) {
    const id = text(value, "Task ID", 36).replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{8,32}$/.test(id))
        throw new CopilotProposalError("Use a task ID from the snapshot.");
    return id;
}
function parseCopilotProposal(value) {
    if (typeof value === "string") {
        if (new TextEncoder().encode(value).length > COPILOT_PROPOSAL_MAX_BYTES)
            throw new CopilotProposalError("Proposal is too large.");
        try {
            value = JSON.parse(value);
        }
        catch {
            throw new CopilotProposalError("Copilot’s proposal is not valid JSON. Ask it to regenerate the proposal block.");
        }
    }
    const input = record(value);
    if (new TextEncoder().encode(JSON.stringify(input)).length > COPILOT_PROPOSAL_MAX_BYTES)
        throw new CopilotProposalError("Proposal is too large.");
    keys(input, ["type", "version", "snapshotId", "requestId", "changes"]);
    if (input.type !== "taskboard-proposal" || input.version !== 1)
        throw new CopilotProposalError("Unsupported proposal format.");
    const snapshotId = text(input.snapshotId, "Snapshot ID", 64);
    if (!/^[0-9a-f]{12}$/.test(snapshotId))
        throw new CopilotProposalError("Use the Snapshot ID from the file Copilot read.");
    const requestId = text(input.requestId, "Request ID", 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(requestId))
        throw new CopilotProposalError("Proposal needs a stable request ID of 8–80 letters, numbers, dots, underscores or hyphens.");
    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > COPILOT_PROPOSAL_MAX_CHANGES)
        throw new CopilotProposalError(`A proposal needs 1–${COPILOT_PROPOSAL_MAX_CHANGES} changes.`);
    const changes = input.changes.map(parseProposalChange);
    const touched = new Set();
    for (const change of changes)
        if (change.op === "update")
            for (const key of Object.keys(change.set)) {
                const field = `${change.task}:${key}`;
                if (touched.has(field))
                    throw new CopilotProposalError("A proposal cannot change the same task field twice. Ask Copilot to combine those edits.");
                touched.add(field);
            }
    return { type: "taskboard-proposal", version: 1, snapshotId, requestId, changes };
}
globalThis.TaskboardCopilotProposal = { parse: parseCopilotProposal };
})();
