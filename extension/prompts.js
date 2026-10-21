/* global globalThis */
(() => {
  const shortcuts = [
    { id: "snapshot", title: "Read snapshot", detail: "Check board context and freshness", question: "Read the snapshot and give me a short overview of my active work, blocked tasks, and upcoming due dates. Confirm the Snapshot ID and Generated time you actually read." },
    { id: "priorities", title: "Daily priorities", detail: "Plan around mail and meetings", question: "What should I focus on today, given my Taskboard tasks, upcoming meetings, recent work email, and Teams messages? Give me up to five priorities with task IDs, reasons, and the next action. Cite the Microsoft 365 sources you use. Flag conflicts or missing context." },
    { id: "meeting", title: "Meeting prep", detail: "Connect the next meeting to tasks", question: "Help me prepare for my next upcoming work meeting. Identify the meeting and its time, find clearly related Taskboard tasks, and summarize relevant recent email and Teams discussions with citations. Give me a short agenda, open questions, and decisions needed. If several meetings could be meant, ask me which one." },
    { id: "review", title: "Review stale tasks", detail: "Find duplicates and loose ends", question: "Review my board for stale, duplicated, blocked, or possibly completed tasks. Use task dates and recent Microsoft 365 evidence, with citations, to explain each suggestion. Age alone does not mean a task is finished. Give me a short checklist of specific changes I can make in Taskboard, with task IDs and reasons; mark uncertain suggestions as uncertain." },
  ];

  function buildPrompt(id, now = new Date()) {
    const shortcut = shortcuts.find((item) => item.id === id);
    if (!shortcut) throw new Error("Unknown Taskboard shortcut.");
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return [
      `Today is ${day} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
      'Read my work OneDrive file "Taskboard snapshot.md" in Documents/Taskboard and follow the instructions in it.',
      "Tell me the Snapshot ID and Generated time you actually read. If you cannot retrieve the file, say so instead of inventing board contents. If its Generated time is more than a day old, flag that before making recommendations.",
      "When connecting a task to mail, a meeting, or a chat, require the same issue and compatible dates; a shared topic alone is not enough. Cite task IDs and supporting sources.",
      "Answer questions normally. When I request task changes, follow the snapshot’s taskboard-proposal format so I can review and approve them in Taskboard. Do not claim changes are applied before approval.",
      "",
      shortcut.question,
    ].join("\n");
  }
  globalThis.TaskboardCopilotPrompts = { shortcuts, buildPrompt };
})();
