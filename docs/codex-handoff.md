# Handoff

## Objective
Portable public extension with a locally configured Taskboard connection.

## Current State
Public runtime uses optional per-site access and a review-page-only bridge.
Hosting, prompt insertion and user-approved proposal transport are preserved.

## Validation Completed
18 dependency-free units passed. Fresh-profile Chromium and Brave setup,
registered bridge, trusted transfer, acknowledgement and disconnect passed.
Composer regressions passed. Browser fixtures pre-grant only their example
origin; the native optional permission dialog and a real tenant remain manual
acceptance. Never publish profiles or personalized packages.
