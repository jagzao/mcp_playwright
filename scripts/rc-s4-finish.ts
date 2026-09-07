// RC acceptance S4 finish — no-op pointer.
//
// The authoritative S4 flow is `npm run rc:s4-login`, which keeps ONE live
// PlaywrightBrowserRuntime alive across login -> capture -> persist -> validate
// (restart-reuse). The previous split login/finish scripts used SEPARATE runtime
// instances, so the finish script could not access the login session's live state
// (captureAuthState returned undefined -> nothing persisted). That defect is fixed
// by the single-process login flow.
//
// To complete S4:
//   1. npm run rc:s4-login   (opens headed LinkedIn, waits for Juan)
//   2. Juan logs in + MFA in the headed window
//   3. New-Item -ItemType File -Path data/s4-login-done.marker
//   4. The login process captures/persists/validates automatically.
console.log('S4 finish is handled by `npm run rc:s4-login` (single-process flow).');
console.log('Run `npm run rc:s4-login`, log in to LinkedIn, then create data/s4-login-done.marker.');
