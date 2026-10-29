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
function normalizeProposalIdentity(value) {
    return value.normalize("NFC")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("en-US");
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
function refName(value, name) {
    const ref = text(value, name, 32);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(ref))
        throw new CopilotProposalError(`${name} must start with a letter and contain only letters, numbers, underscores or hyphens.`);
    return ref;
}
function target(value) {
    const input = record(value);
    keys(input, ["title", "parentTitle"]);
    if (!("parentTitle" in input) || input.parentTitle !== null && typeof input.parentTitle !== "string")
        throw new CopilotProposalError("Target parentTitle must be text or null.");
    return { title: text(input.title, "Target title", 500), parentTitle: input.parentTitle === null ? null : text(input.parentTitle, "Target parent title", 500) };
}
function parent(value) {
    const input = record(value);
    keys(input, ["task", "title"]);
    return { task: taskId(input.task), title: text(input.title, "Parent title", 500) };
}
function taskReference(item) {
    const hasTask = item.task !== undefined;
    const hasTaskRef = item.taskRef !== undefined;
    if (hasTask === hasTaskRef)
        throw new CopilotProposalError("Choose exactly one task or taskRef for this detail.");
    if (hasTaskRef) {
        if (item.target !== undefined)
            throw new CopilotProposalError("A detail for a newly created task uses taskRef, not a snapshot target.");
        return { taskRef: refName(item.taskRef, "Task reference") };
    }
    return { task: taskId(item.task), ...(item.target === undefined ? {} : { target: target(item.target) }) };
}
function parseProposalChange(value) {
    const item = record(value);
    const reason = text(item.reason, "Reason", 1000);
    if (item.op === "note") {
        keys(item, ["op", "task", "taskRef", "target", "text", "reason"]);
        return { op: "note", ...taskReference(item), text: text(item.text, "Note", 4000), reason };
    }
    if (item.op === "checklist") {
        keys(item, ["op", "task", "taskRef", "target", "label", "done", "reason"]);
        if (item.done !== undefined && typeof item.done !== "boolean")
            throw new CopilotProposalError("Checklist done must be true or false.");
        return { op: "checklist", ...taskReference(item), label: text(item.label, "Checklist item", 500), ...(item.done === undefined ? {} : { done: item.done }), reason };
    }
    if (item.op === "archive" || item.op === "restore") {
        keys(item, ["op", "task", "target", "reason"]);
        return { op: item.op, task: taskId(item.task), ...(item.target === undefined ? {} : { target: target(item.target) }), reason };
    }
    if (item.op !== "create" && item.op !== "update")
        throw new CopilotProposalError("Supported changes are create, update, note, checklist, archive, and restore. Deletion and arbitrary actions are not supported.");
    keys(item, item.op === "create" ? ["op", "set", "reason", "ref", "parent", "parentRef"] : ["op", "task", "target", "set", "reason"]);
    const input = record(item.set);
    keys(input, ["title", "summary", "status", "dueAt", "bucket", "labels"]);
    if (!Object.keys(input).length)
        throw new CopilotProposalError("Choose at least one task field to change.");
    const set = {};
    if ("title" in input)
        set.title = text(input.title, "Title", 500);
    if ("summary" in input)
        set.summary = text(input.summary, "Summary", 4000, true);
    if ("bucket" in input)
        set.bucket = text(input.bucket, "Bucket", 200);
    if ("labels" in input) {
        if (!Array.isArray(input.labels) || input.labels.length > 20)
            throw new CopilotProposalError("Labels must be an array of at most 20 names.");
        const seen = new Set();
        set.labels = input.labels.map(value => text(value, "Label", 100)).filter(value => {
            const key = normalizeProposalIdentity(value);
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
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
        if (!set.title)
            throw new CopilotProposalError("New tasks need a title.");
        if (item.parent !== undefined && item.parentRef !== undefined)
            throw new CopilotProposalError("A new subtask can use parent or parentRef, not both.");
        const parentValue = item.parent === undefined ? undefined : parent(item.parent);
        const parentRef = item.parentRef === undefined ? undefined : refName(item.parentRef, "Parent reference");
        const child = parentValue !== undefined || parentRef !== undefined;
        if (child && set.bucket !== undefined)
            throw new CopilotProposalError("A subtask inherits its parent bucket; do not include bucket.");
        if (!child && !set.bucket)
            throw new CopilotProposalError("A new top-level task needs an existing bucket.");
        return { op: "create", set: set, reason,
            ...(item.ref === undefined ? {} : { ref: refName(item.ref, "Create reference") }),
            ...(parentValue === undefined ? {} : { parent: parentValue }),
            ...(parentRef === undefined ? {} : { parentRef }) };
    }
    return { op: "update", task: taskId(item.task), ...(item.target === undefined ? {} : { target: target(item.target) }), set, reason };
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
    validateProposalGraph(changes);
    return { type: "taskboard-proposal", version: 1, snapshotId, requestId, changes };
}
function validateProposalGraph(changes) {
    const touched = new Set();
    const taskActions = new Map();
    const refs = new Map();
    for (const change of changes)
        if (change.op === "update")
            for (const key of Object.keys(change.set)) {
                const field = `${change.task}:${key}`;
                if (touched.has(field))
                    throw new CopilotProposalError("A proposal cannot change the same task field twice. Ask Copilot to combine those edits.");
                touched.add(field);
            }
    for (const change of changes) {
        if (change.op !== "create" && change.task) {
            const actions = taskActions.get(change.task) ?? new Set();
            if ((change.op === "archive" || change.op === "restore") && actions.size || [...actions].some(action => action === "archive" || action === "restore")) {
                throw new CopilotProposalError("Archive or restore must be the only change for that task in a proposal.");
            }
            actions.add(change.op);
            taskActions.set(change.task, actions);
        }
        if (change.op === "create") {
            if (change.parentRef && !refs.get(change.parentRef)?.topLevel)
                throw new CopilotProposalError("A parentRef must name an earlier top-level create in this proposal.");
            if (change.ref) {
                if (refs.has(change.ref))
                    throw new CopilotProposalError("Create references must be unique in a proposal.");
                refs.set(change.ref, { topLevel: !change.parent && !change.parentRef });
            }
        }
        else if ((change.op === "note" || change.op === "checklist") && change.taskRef && !refs.has(change.taskRef)) {
            throw new CopilotProposalError("A taskRef must name an earlier create in this proposal.");
        }
    }
}
globalThis.TaskboardCopilotProposal = { parse: parseCopilotProposal };
})();
