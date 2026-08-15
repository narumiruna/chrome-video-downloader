# Privacy Policy

Last updated: August 15, 2026.

Chrome Video Downloader processes the active page's title, URL, video source URLs, source type, video dimensions, and duration only when the user invokes the extension.

This information is used only to identify direct video files, show safe candidate details, and start a download selected by the user.

Processing occurs locally on the user's device.

The extension does not transmit page data, media URLs, media content, download history, or usage data to the developer or any developer-controlled service.

When the user chooses a candidate, Chrome makes the normal network request to that video's source host to perform the requested download.

The extension does not add a separate recipient or remote processing service to that request.

The extension does not persist page data, media URLs, candidates, or download history.

Candidate data exists only in the popup's memory and is discarded when the popup closes or scans again.

The extension does not use analytics, advertising, tracking, telemetry, accounts, or a remote processing service.

## Permissions

`activeTab` grants temporary access to the current page only after the user invokes the extension.

`scripting` runs a read-only collector in the current top-level page to find video source information.

`downloads` sends the video URL selected by the user to Chrome's download manager.

The production extension does not request persistent host access, browsing history, cookies, storage, background monitoring, `webRequest`, `debugger`, or offscreen documents.

Chrome may include existing cookies for the destination hostname when it performs an HTTP(S) download.

The extension does not read, copy, store, or transmit those cookies.

## Data sharing and retention

No user data is sold, transferred, or shared by the developer.

The source website still receives the normal request needed to serve a user-selected download.

No user data is retained by the developer because no user data is received.

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## User choices

The extension runs only when the user invokes it and starts a download only when the user selects a candidate.

Users can close the popup to discard candidate data, cancel a download through Chrome, or uninstall the extension at any time.

## Security and content rights

The extension allows only direct HTTP(S) candidates to reach Chrome's download API.

It does not bypass DRM, authentication, paywalls, CAPTCHAs, or website restrictions.

Users are responsible for downloading only content they own or have permission to save.

## Contact

The public repository's issue tracker is the support and privacy contact channel.

Before Chrome Web Store submission, the publisher must replace this sentence with the final public repository URL and publish this policy at a stable HTTPS URL.
