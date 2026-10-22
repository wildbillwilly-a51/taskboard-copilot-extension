# Taskboard Copilot extension

Open the real Microsoft 365 Copilot website beside your work in Brave or Chrome.
Taskboard prompt shortcuts fill Copilot's message box for you to review and send.
An optional Taskboard connection shows readable task changes with Apply as your
single approval. Review details remains available when you want to inspect or
edit a proposal first. Your server checks permissions and conflicts.

## Install on another computer

1. Download **taskboard-copilot-extension-1.6.0.zip** from this repository's Releases page.
2. Extract the ZIP into a permanent folder on that computer. Keep the folder after installation.
3. Open `brave://extensions` (or `chrome://extensions`) and enable **Developer mode**.
4. Click **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Pin **Taskboard Copilot** to the browser toolbar.
6. For task-change reviews, open the extension's **Settings**, enter your Taskboard website address, and allow access to that one site. Your Taskboard server must support `/copilot-review`.
7. Refresh Copilot and Taskboard. Sign in to each website normally.

The source repository has the same runtime files in `extension/`; you can load
that folder instead of the release ZIP. No build tools, API keys or connection
to the computer that published this repository are needed for installation.
You still need network access to Microsoft 365 and, for reviews, your Taskboard
server. Workplace browser policies may restrict unpacked extensions.

## Use

The toolbar and Settings page show your connection status and configured site.
In Copilot, connection status and Split View guidance appear only inside the
open **Taskboard prompts** panel. Closing it also hides those cards; background
connection updates do not reopen them. A green **Taskboard connected** card means
the browser has site access and the review bridge is registered. It does not
verify your server session or network reachability; sign in normally on
Taskboard. **Connect Taskboard** / **Manage Taskboard connection** opens Settings.

Open the toolbar menu from your Taskboard tab. Browsers with the automatic
pairing API offer **Open Split View**. Older browsers offer **Prepare Split
View**, with the remaining browser-menu step shown before you click.
If automatic pairing is unavailable, both tabs are selected for you: right-click
one and choose the browser's New Split View command. Drag the divider to resize.
The browser controls its minimum widths and may start new pairs at 50/50.
**Separate window** opens another OS window with remembered size and position.
There is no promise of a persistent in-page Copilot overlay or iframe.

The shortcut `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS) opens your preferred mode.
Browser extension-shortcut settings can change that key.

In Copilot, open **Taskboard prompts**. Shortcuts assume a work OneDrive file
named `Taskboard snapshot.md` in `Documents/Taskboard`. Ask Copilot to confirm
the snapshot ID and generated time it read. Your server/connector must provide
that file; neither is included in this extension. Existing drafts are preserved
unless you choose to replace them. Prompts are never sent automatically.
The prompt panel closes when insertion starts or copying succeeds. Draft-replacement
confirmation stays open until you decide or dismiss the panel. Insertion feedback
appears briefly beside the collapsed prompt button.
Feedback has a dismiss button and expires automatically (success after five
seconds, warnings after ten). Escape, clicking outside, resuming editing or
reopening the panel clears it. Warning details remain inside the panel for
review. Closing the panel cancels stale replacement confirmations; late
insertion results cannot reopen feedback or steal focus. When Copilot replaces
its editor, retained prompt text is verified without inserting it a second time.

Describe changes normally in Copilot, such as “Rename this task and move it to
next Friday.” Copilot should explain the changes and return the snapshot's
proposal JSON. The extension builds a readable card from that validated JSON.
**Apply 2 changes** is your single approval; Taskboard checks and applies those
exact changes without a second approval screen. The card reports success only
after Taskboard confirms the outcome. **Review details** queues the proposal for
optional inspection/editing and leaves the board unchanged. **Technical details**
expands the original JSON. Invalid or incomplete blocks cannot be applied.

A cooperating Taskboard tab is reused without navigation or losing its selected
task. Apply keeps focus in Copilot; Review details opens Taskboard's activity
panel. If no compatible tab is open, a separate Taskboard page handles the
transfer and normal sign-in. Older servers reject single-click Apply explicitly;
Review details remains compatible with the existing manual approval flow.

Taskboard's **Discuss this task in Copilot** prepares the selected task's context
in a paired Copilot tab. Existing drafts still require your replacement choice.
Nothing sends automatically. **Copilot activity** retains received proposals and
applied changes; conflicts stay pending for attention. **Continue in Copilot**
prepares a confirmed-result message for you to send. The snapshot must refresh
before another change to the same fields. These controls require the matching
Taskboard conversational update as well as this extension; install them together.

**Review stale tasks** requests recommendations plus concrete supported changes.
**Prepare changes** is a recovery shortcut for existing recommendation prose.
Missing decisions remain questions. Proposals need 1–20 concrete changes; empty,
over-limit or malformed proposals show correction guidance instead of Apply.
For larger requests, apply at most 20, re-read the refreshed snapshot, then prepare
the next batch. No truncation, guessed tasks or placeholder changes.

To update, replace your extracted runtime with the new release and click
**Reload** on the browser's extensions page, then refresh both website tabs.
Recheck Settings if site access has been removed.

## Privacy and permissions

No Taskboard server address, account, credentials, private server code, task
data, tenant identifiers or private Git history is shipped in this repository.
Your instance address is entered locally and stored only in this browser
profile. It is not sent to GitHub. There is no telemetry, analytics, remote
code loading, mailbox scanning or Microsoft API integration in the extension.

- `storage`: browser-local preferences and temporary session handoffs.
- `clipboardWrite`: the explicit Copy prompt fallback.
- `scripting`: registers the bridge at your chosen site; it activates only on the board and activity pages.
- Static content scripts run on the two declared Microsoft 365 Copilot hosts.
- Optional HTTPS host access is declared so an instance can be chosen later.
  It is requested for exactly the site you enter, never for all sites at once.
  Disconnect removes its registration, local address and pending transfers,
  and revokes that site's optional access.

The extension scans bounded `pre`/`code` elements and contiguous rendered lines
in read-only code editors for proposal markers. Editable drafts, incomplete
blocks and oversized proposals are ignored. It does not collect conversation
history. Only the selected proposal transfers after a real user click. A separate real
Taskboard context-button click prepares just its bounded prompt in Copilot. Its body stays in extension session storage for at most
15 minutes (expired records are discarded on the next access), is bound to one
review tab and the configured origin, and is cleared after completion/acknowledgement. A pending task-context prompt is
also tab-bound and expires after 15 minutes; it is cleared when prepared or disconnected.
The review URL contains an opaque transfer ID, not the proposal body. Your
Taskboard server stores proposals and approved changes under its own policy.
Website content, Microsoft 365 and your server have their own privacy policies.

The host-access design follows Chrome's documented
[optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
and [registered content scripts](https://developer.chrome.com/docs/extensions/reference/api/scripting).

## Development

Node.js 22 or later: `npm test` runs the dependency-free unit checks.
No dependency installation is required. Browser regression checks use an
externally supplied Playwright installation and a fresh browser profile;
their commands are documented in `tests/browser.mjs`.

This is an independent extension, not a Microsoft, Brave or Google product.
Their names and trademarks belong to their respective owners. Public source
visibility does not grant an additional open-source license; no such license
has been selected.
