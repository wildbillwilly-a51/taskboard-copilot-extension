# Handoff

## Objective
Prepare version 1.6.1 with automatic Taskboard context and single confirmations.

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
Apply results stay in Copilot; only explicit Review details opens activity.
Temporary Apply receivers open in the background and close after success unless
the user activates or navigates them. Existing board tabs are never closed.
This repository contains only the extension; matching Taskboard support is
required. A staged package does not establish a deployed server or public release.

## Validation Completed
26 public units; Chromium/Brave automatic-context and legacy/editor Apply/Review
fixtures; existing 20-result composer suites. Private app/DB checks cover single-click
application, optional editing, conflicts, replay, dropped-response reconciliation,
context drafts, same-tab selection, responsive activity and copy recovery.
Fixtures do not certify actual Copilot output or OneDrive indexing.
Never publish profiles, personalized settings or private source history.
