# Handoff

## Objective
Portable public extension with a locally configured Taskboard connection.

## Current State
Public runtime uses optional per-site access and a review-page-only bridge.
Hosting, prompt insertion and user-approved proposal transport are preserved.
Version 1.5.4 keeps connection status and Split View guidance inside the popup.
Close, Escape and prompt insertion hide them together; background updates and
reloads preserve the closed state. Read-only Code editors and pre/code remain
supported for proposal detection.
Only contiguous rendered lines are read; editable, partial and oversized code
is ignored. The transfer button sits outside the editor clipping area.

## Validation Completed
18 dependency-free units passed. Four fresh-profile Chromium/Brave browser
flows passed across legacy code blocks and read-only editor markup. Exact JSON
transfer, trusted clicks, preserved drafts, incomplete-line rejection, editor
attribute transitions, acknowledgement and disconnect passed. Popup dismissal
checks cover Close, Escape, insertion, background updates and reload at desktop,
390px and 320px widths in light/dark. Composer regressions passed. Browser fixtures pre-grant only their example
origin; the native optional permission dialog and a real tenant remain manual
acceptance. Never publish profiles or personalized packages.
