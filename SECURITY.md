# Security

## Model
This is a static site on GitHub Pages, which cannot require a login. Access is controlled by **encryption**: every content file is AES-256-GCM encrypted with a key derived from a password (PBKDF2-SHA-256, 600,000 iterations, random salt). Without the password, the files in this repository and on the live site are unreadable.

## What this protects against
- Anyone who finds the URL or browses the repository: they see only ciphertext.
- Search engines and archives: the site asks not to be indexed, and indexed pages would contain no readable content anyway.
- Script injection and third-party tracking: a strict CSP allows only same-origin scripts and blocks inline script.

## Limits
- **Password strength:** security depends on the password. Use the generated one and keep it in a password manager.
- **Sharing:** anyone you give the password to can read everything, and can keep a copy.
- **Unlocked devices:** a device left unlocked (with *Keep me unlocked* on) gives access until you choose **Settings → Lock now** or clear site data.
- **Changing the password:** this requires re-encrypting and re-publishing the content. Old ciphertext remains in git history, so a leaked old password still opens old commits.

## Reporting
Open a private security advisory in this repository's **Security** tab.
