/* global globalThis */
(() => {
  const shortcuts = [
    { id: "snapshot", title: "Read snapshot", detail: "Check board context and freshness", question: "Read the snapshot and give me a short overview of my active work, blocked tasks, and upcoming due dates. Confirm the Snapshot ID and Generated time you actually read." },
    { id: "priorities", title: "Daily priorities", detail: "Plan around mail and meetings", question: "What should I focus on today, given my Taskboard tasks, upcoming meetings, recent work email, and Teams messages? Give me up to five priorities with task IDs, reasons, and the next action. Cite the Microsoft 365 sources you use. Flag conflicts or missing context." },
    { id: "meeting", title: "Meeting prep", detail: "Connect the next meeting to tasks", question: "Help me prepare for my next upcoming work meeting. Identify the meeting and its time, find clearly related Taskboard tasks, and summarize relevant recent email and Teams discussions with citations. Give me a short agenda, open questions, and decisions needed. If several meetings could be meant, ask me which one." },
    { id: "review", title: "Review stale tasks", detail: "Prepare changes for approval", question: "Review my board for stale, duplicated, blocked, or possibly completed tasks. Use task dates and recent Microsoft 365 evidence, with citations, to explain each suggestion. This request includes preparing supported, concrete task changes for my review: after the recommendations, return ONE JSON code block using the snapshot's taskboard-proposal contract. Include only changes justified by the available facts and my instructions. Keep conditional or uncertain recommendations outside the proposal and ask for missing decisions. Age, a placeholder title or a past due date alone does not prove completion. Do not invent owners, dates, titles, or completion facts. If no concrete change is ready, explain what decision or evidence is needed; do not fabricate a proposal merely to produce a button." },
    { id: "prepare", title: "Prepare changes", detail: "Turn recommendations into a proposal", question: "Prepare the supported Taskboard changes from our recommendations and my explicit change requests in this conversation so I can review them in plain language and click Apply. Return ONE JSON code block using the snapshot's taskboard-proposal contract, with its actual Snapshot ID, exact task IDs, concrete field values and brief reasons. Use only choices already established by my instructions and the available facts. Keep conditional recommendations and missing decisions outside the proposal; ask me to resolve them rather than inventing owners, dates, replacement titles or completion facts. Do not interpret a general acknowledgement as proof that work is completed. Do not emit unsupported operations. If nothing concrete is ready, ask the specific question needed to prepare a valid proposal. No changes are applied by preparing this proposal." },
  ];

  function buildContext(now = new Date()) {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return [
      `Today is ${day} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
      "[Taskboard request instructions]",
      "Taskboard means my separate Taskboard application, not Microsoft To Do, Planner, or a private Microsoft task. Do not use Microsoft task actions as a substitute for Taskboard changes. A native Microsoft task is not confirmation that Taskboard changed.",
      'Read my work OneDrive file "Taskboard snapshot.md" in Documents/Taskboard and follow the instructions in it.',
      "Tell me the Snapshot ID and Generated time you actually read. If you cannot retrieve the file, say so instead of inventing board contents. If its Generated time is more than a day old, flag that before making recommendations.",
      "When connecting a task to mail, a meeting, or a chat, require the same issue and compatible dates; a shared topic alone is not enough. Cite task IDs and supporting sources.",
      "Answer questions normally. When I request task changes, follow the snapshot’s taskboard-proposal format so I can review them in plain language and click Apply. Do not claim changes are applied before Taskboard confirms the result.",
      "State proposed changes in plain language before the JSON. The extension displays a readable card with Apply as my single approval; Taskboard checks conflicts and applies the exact JSON without a second approval screen. Review details is optional and leaves changes pending. Ordinary explicit requests should produce this card without requiring a separate Prepare changes command. You do not need a Taskboard action tool to prepare the JSON. Keep citations and explanatory prose outside the JSON, and copy the actual Snapshot ID and task IDs from the file.",
      "A proposal must contain 1–20 concrete changes. Never return an empty changes array or placeholder changes. If no change is ready, explain the specific missing decision without emitting proposal JSON. If more than 20 changes are ready, prepare the first batch of at most 20 and explain what remains; after approval, re-read the refreshed snapshot before preparing another batch.",
      "Before creating a task, check the current snapshot for a matching existing task to avoid duplicates. Use only supported operations. If real subtask creation is unsupported, explain that limitation; do not substitute working notes and claim that subtasks were created.",
      "[/Taskboard request instructions]",
    ].join("\n");
  }
  function needsContext(text) {
    if (/\b(?:not|without|don't use|do not use)\s+(?:my\s+)?task[ -]?board\b/i.test(text) && /\b(?:Microsoft To Do|Planner|Microsoft task)\b/i.test(text)) return false;
    return /\btask[ -]?board\b/i.test(text) && !(text.includes("[Taskboard request instructions]") && text.includes("[/Taskboard request instructions]"));
  }
  function buildPrompt(id, now = new Date()) {
    const shortcut = shortcuts.find((item) => item.id === id);
    if (!shortcut) throw new Error("Unknown Taskboard shortcut.");
    return `${buildContext(now)}\n\n${shortcut.question}`;
  }
  globalThis.TaskboardCopilotPrompts = { shortcuts, buildPrompt, buildContext, needsContext };
})();
