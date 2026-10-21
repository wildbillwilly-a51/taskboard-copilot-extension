# Handoff

## Objective
Portable public extension with a locally configured Taskboard connection.

## Current State
Public runtime uses optional per-site access and a review-page-only bridge.
Hosting, prompt insertion and user-approved proposal transport are preserved.
Version 1.5.3 detects proposals in read-only Code editors as well as pre/code.
Only contiguous rendered lines are read; editable, partial and oversized code
is ignored. The transfer button sits outside the editor clipping area.

## Validation Completed
18 dependency-free units passed. Four fresh-profile Chromium/Brave browser
flows passed across legacy code blocks and read-only editor markup. Exact JSON
transfer, trusted clicks, preserved drafts, incomplete-line rejection, editor
attribute transitions, acknowledgement and disconnect passed.
Composer regressions passed. Browser fixtures pre-grant only their example
origin; the native optional permission dialog and a real tenant remain manual
acceptance. Never publish profiles or personalized packages.
