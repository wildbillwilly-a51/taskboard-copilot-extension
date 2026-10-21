# Taskboard Copilot extension

Open the real Microsoft 365 Copilot website beside your work in Brave or Chrome.
Taskboard prompt shortcuts fill Copilot's message box for you to review and send.
An optional Taskboard connection transfers a selected task-change proposal to
your server's review screen. Task changes require your approval there.

## Install on another computer

1. Download **taskboard-copilot-extension-1.5.2.zip** from this repository's Releases page.
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

The toolbar, Settings page and Copilot prompt dock show a persistent connection
indicator and your configured site. A green **Taskboard connected** card means
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
The prompt panel closes when insertion starts. Draft-replacement confirmation
stays open until you decide; insertion warnings remain visible outside the panel.

When Copilot returns a compatible `taskboard-proposal` code block, click
**Review changes in Taskboard** beside it. Review, edit, select and approve
changes on your signed-in Taskboard server. No task is changed by the extension
alone. Microsoft page changes and tenant policy can affect detection/insertion.

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
- `scripting`: registers the review bridge only at your chosen site's review page.
- Static content scripts run on the two declared Microsoft 365 Copilot hosts.
- Optional HTTPS host access is declared so an instance can be chosen later.
  It is requested for exactly the site you enter, never for all sites at once.
  Disconnect removes its registration, local address and pending transfers,
  and revokes that site's optional access.

The extension scans bounded `pre`/`code` elements for proposal markers; it does
not collect conversation history. Only the selected proposal transfers, after
a real user click. Its body stays in extension session storage for at most
15 minutes (expired records are discarded on the next access), is bound to one
review tab and the configured origin, and is cleared after acknowledgement.
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
