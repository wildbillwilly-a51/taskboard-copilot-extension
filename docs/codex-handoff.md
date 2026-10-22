# Handoff

## Objective
Deliver version 1.5.7 with proposal validation before review transfer.

## Current State
The extension validates the complete bounded proposal contract before showing a
review action and again before storing/transferring it. Empty and over-limit
proposals explain recovery in Copilot without opening a failing review tab.
Corrected blocks become reviewable in place. Prompts require 1-20 concrete
changes and retain missing choices as questions. No invented placeholder edits,
conversation scanning, automatic sending or permission/server changes.

## Validation Completed
20 public units and Chromium/Brave editor/legacy browser flows cover invalid
counts, malformed operations, in-place correction, trusted exact transfer,
acknowledgement, preserved drafts, settings and popup lifecycle. Private release
validation checks the generated validator against the authoritative server
parser. Composer/native-toolbar behavior is unchanged from the earlier release.
Fresh-profile fixtures do not certify actual Copilot output compliance.
Never publish profiles, personalized settings or private source history.
