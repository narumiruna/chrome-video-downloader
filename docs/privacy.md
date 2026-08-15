# Privacy Policy

Last updated: August 15, 2026.

Chrome Video Downloader processes page titles, page URLs, video source URLs, media request URLs, HTTP byte ranges, media types, dimensions, and durations locally on the user's device.

The background service worker observes media-like requests so the extension can discover video and audio fragments loaded by cross-origin players.

Captured request metadata is grouped by tab, kept only in memory, capped, and removed after five minutes of inactivity or when the tab closes.

When the user selects **Assemble MP4**, the extension requests the captured media URLs from their original hosts and remuxes compatible unencrypted MP4 audio and video fragments in the popup.

The extension does not transmit page data, media URLs, media content, download history, or usage data to the developer or any developer-controlled service.

The source websites receive the normal requests needed to fetch or download user-selected media.

The extension does not use analytics, advertising, tracking, telemetry, accounts, or remote processing.

## Permissions

`activeTab` grants temporary access to the current page after the user invokes the extension.

`scripting` runs a read-only collector in the current top-level page to find video source and iframe information.

`webRequest` observes media request URLs, response media types, and HTTP byte ranges needed to identify fragmented playback.

`host_permissions` allows observation and user-requested fetching of cross-origin media from embedded players and CDNs.

`alarms` removes stale in-memory request metadata.

`storage` uses Chrome's non-persistent `storage.session` area so captured fragments survive service-worker suspension within the current browser session.

`downloads` sends a selected direct video or locally assembled MP4 to Chrome's download manager.

The extension does not request browsing history, cookie, persistent storage, debugger, or offscreen-document permissions.

A media host may receive existing cookies when Chrome performs a normal authorized request.

The extension does not inspect, copy, persist, or transmit cookie values.

## Data sharing and retention

No user data is sold, transferred, or shared by the developer.

No user data is retained by the developer because no user data is received.

Captured request metadata remains in extension memory only and is automatically discarded.

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## User choices

Users choose whether to download a direct file or assemble a captured fragmented MP4 stream.

Users can close the popup to stop an in-progress browser-side assembly, cancel a download through Chrome, close the source tab to clear its captured metadata, or uninstall the extension.

## Security and content rights

The extension supports direct HTTP(S) files and a bounded best-effort remux of compatible unencrypted fragmented MP4 tracks.

It does not decrypt media, bypass DRM, defeat authentication, cross paywalls, solve CAPTCHAs, or circumvent website restrictions.

Users are responsible for downloading only content they own or have permission to save.

## Contact

The public repository's issue tracker is the support and privacy contact channel.

Before Chrome Web Store submission, the publisher must replace this sentence with the final public repository URL and publish this policy at a stable HTTPS URL.
