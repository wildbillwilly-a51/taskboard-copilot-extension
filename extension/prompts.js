/* global globalThis */
(() => {
  const shortcuts = [
    { id: "priorities", title: "Daily priorities", detail: "Plan around mail and meetings", question: "What should I focus on today, given my Taskboard tasks, upcoming meetings, recent work email, and Teams messages? Give me up to five priorities with task titles, reasons, and the next action. Cite the Microsoft 365 sources you use. Flag conflicts or missing context." },
    { id: "meeting", title: "Meeting prep", detail: "Connect the next meeting to tasks", question: "Help me prepare for my next upcoming work meeting. Identify the meeting and its time, find clearly related Taskboard tasks, and summarize relevant recent email and Teams discussions with citations. Give me a short agenda, open questions, and decisions needed. If several meetings could be meant, ask me which one." },
  ];

  function buildContext(now = new Date()) {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return [
      `Today is ${day} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
      "[Taskboard request instructions]",
      "Taskboard means my separate Taskboard application, not Microsoft To Do, Planner, or a private Microsoft task. Do not use Microsoft task actions as a substitute for Taskboard changes. A native Microsoft task is not confirmation that Taskboard changed.",
      'Read my work OneDrive file "Taskboard snapshot.md" in Documents/Taskboard and follow the instructions in it.',
      "Tell me the Snapshot ID and Generated time you actually read. If you cannot retrieve the file, say so instead of inventing board contents. If its Generated time is more than a day old, flag that before making recommendations.",
      "When connecting a task to mail, a meeting, or a chat, require the same issue and compatible dates; a shared topic alone is not enough. Cite supporting Microsoft 365 sources.",
      "When a requested change comes from mail, a meeting, or a chat, name the source in the plain-language proposal before the JSON: sender or organizer, subject or meeting title, and source date. If the source is missing or ambiguous, ask me which item I mean instead of proposing changes.",
      "Resolve relative dates such as today, tomorrow, or Friday using the date and time zone above. Show the resulting absolute date in the plain-language proposal before the JSON so I can verify it before Apply.",
      "In every user-facing answer, identify a Taskboard item by its quoted title, never by a bare task ID. On first mention include its bucket, whether it is a top-level task or subtask, its parent title when applicable, and then its ID in parentheses for disambiguation. Later mentions may use the title alone. Keep exact IDs in proposal JSON.",
      "Before calling an existing item a match or duplicate, compare both subject and scope. A project, top-level task, work item, and subtask are different scopes; a related item at another level does not satisfy the request. Date proximity is supporting evidence, not identity. Do not repurpose, widen, narrow, promote, or reparent an existing item unless I explicitly requested that outcome.",
      "Answer questions normally. When I request task changes, follow the snapshot’s taskboard-proposal format so I can review them in plain language and click Apply. Do not claim changes are applied before Taskboard confirms the result.",
      "State proposed changes in plain language before the JSON. The extension displays a readable card with Apply as my single approval; Taskboard checks conflicts and applies the exact JSON without a second approval screen. Review details is optional and leaves changes pending. Ordinary explicit requests should produce this card without requiring a separate Prepare changes command. You do not need a Taskboard action tool to prepare the JSON. Keep citations and explanatory prose outside the JSON, and copy the actual Snapshot ID and task IDs from the file.",
      "A proposal must contain 1–20 concrete changes. Never return an empty changes array or placeholder changes. If no change is ready, explain the specific missing decision without emitting proposal JSON. If more than 20 changes are ready, prepare the first batch of at most 20 and explain what remains; after approval, re-read the refreshed snapshot before preparing another batch.",
      "Treat one request to create a task and organize its known work as one atomic change set. Use the current snapshot contract's refs to include the new task, its ready direct subtasks, checklist items, and working notes in the same proposal. Never tell me to send another prompt merely because the new task does not have a server-assigned ID yet; target same-proposal details with taskRef as instructed by the snapshot.",
      "Before creating a task, check the current snapshot for a matching existing task to avoid duplicates. Before the JSON, state what Taskboard items will exist after Apply and which requested results, if any, remain unsupported or unresolved. Use only supported operations. A supported change that independently advances the request may be emitted as a clearly labeled partial proposal; never imply that it fulfills unsupported parts.",
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
