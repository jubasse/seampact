---
---

DRF apis now run the authentication, permission and throttle classes you name per access kind in `settings.SEAMPACT` (never the app's DRF defaults), answer DRF's authentication, permission, throttle and session CSRF failures with the contract's codes, write absolute page links from `public_origin`, and leave CORS preflights to your CORS middleware.
