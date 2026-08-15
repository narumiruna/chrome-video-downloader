# Chrome Web Store policy baseline

Review date: August 15, 2026.

This is an implementation baseline, not legal advice or authorization to publish.

## Official references reviewed

- [Chrome Web Store Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Chrome Web Store user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Prepare to publish](https://developer.chrome.com/docs/webstore/prepare)
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

The main policy page reports that it was last updated on May 22, 2025.

Policies may change, so the publisher must repeat this review immediately before submission.

## Product assessment

| Requirement | Project response |
| --- | --- |
| Narrow, understandable single purpose | The product downloads authorized videos by using a direct source or locally remuxing observed compatible fragmented MP4 tracks. |
| No unauthorized content access | The product does not bypass login, paywall, CAPTCHA, DRM, encryption, anti-hotlinking, or website controls. |
| Respect copyright | The popup and listing tell users to download only content they own or may save. |
| Least permissions | `webRequest`, host access, a read-only top-frame playback monitor, a background worker, `storage.session`, and `alarms` are required for playback progress, cross-origin fragment discovery, service-worker suspension, delayed readiness, and bounded cleanup. |
| Browsing activity limited to a user-facing feature | The top-frame monitor records only bounded video timing state; the worker filters media-like requests, retains bounded metadata by tab for five minutes, and exposes it only for playback progress and assembly. |
| User-data disclosure | The listing draft and popup disclose local request-URL processing, while `docs/privacy.md` documents use, recipients, retention, and Limited Use compliance. |
| Remote code prohibition | All executable muxing code is packaged locally, and the artifact audit rejects remote scripts, remote CSS, `eval`, and source-map references. |
| Accurate metadata | The listing limits assembly to compatible unencrypted fragmented MP4 and identifies general HLS, DASH manifests, DRM, missing fragments, and bypass behavior as unsupported or prohibited. |
| Listing completeness | Icons exist, but final screenshots, category, public support URL, homepage URL, and hosted privacy-policy URL still require publisher input. |
| Dashboard accuracy | The final privacy fields must match `docs/privacy.md`, `docs/store-listing.md`, and the submitted manifest. |
| Account security | The publisher must use an eligible Chrome Web Store developer account with 2-Step Verification. |

Chrome notes that video downloaders may be ineligible for store featuring even when otherwise policy-compliant.

Policy compliance and store approval cannot be guaranteed because Google performs the final review.

## Submission blockers

No external submission is authorized by this task.

Before submission, the publisher must provide stable HTTPS support, homepage, and privacy URLs, capture accurate screenshots from the submitted version, complete dashboard declarations, verify contact details and 2-Step Verification, run the branded Chrome Stable manual smoke test, and approve the exact zip.
