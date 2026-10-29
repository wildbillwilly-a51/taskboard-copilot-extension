# Handoff

## Objective
Prepare version 1.7.1 with complete one-turn task construction and ordinary task operations.

## Current State
Readable cards come from validated JSON. Apply is the single approval and
Review details queues changes without applying them. Raw JSON is expandable.
The bridge reuses compatible board tabs without navigation, preserves drafts,
returns confirmed results and refuses Apply on older servers. Task context and
confirmed-result prompts use guarded draft insertion with manual sending.
Board/activity route activation stays limited to the configured site's origin.
Explicit Send on a plain Taskboard request appends verified snapshot/proposal
rules and continues that same native action once. No startup prompt or separate
setup message; rich references/attachments stay intact. Unknown insertion,
changed chat/draft or disconnected target fails closed. Ordinary messages stay
native. No conversation history scanning or automatic follow-up sending.
Human-facing answers and cards lead with task titles and hierarchy; IDs remain
technical disambiguators. New snapshots require exact title and immediate-parent
echoes that Taskboard verifies on import and Apply. One proposal can create a
top-level task, its direct subtasks, working notes and checklist items atomically.
Existing tasks support labels and recoverable whole-tree archive/restore in
addition to normal field updates. Duplicate requests with new request IDs are
blocked at Apply, while dismissed proposals may be proposed again.
Apply results stay in Copilot; only explicit Review details opens activity.
Temporary Apply receivers open in the background and close after success unless
the user activates or navigates them. Existing board tabs are never closed.
This repository contains only the extension; matching Taskboard support is
required. A staged package does not establish a deployed server or public release.

## Validation Completed
Public units plus Chromium automatic-context, proposal-card and editor Apply/Review
fixtures; existing 20-result composer suites. Private app/DB checks cover single-click
application, optional editing, conflicts, replay, dropped-response reconciliation,
context drafts, same-tab selection, responsive activity and copy recovery.
Fixtures do not certify actual Copilot output or OneDrive indexing.
Never publish profiles, personalized settings or private source history.
