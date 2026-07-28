# WordPress must-use plugins

Small artifacts that get installed on every TM WordPress site as part of
onboarding. They are deployed to the client's site, not run here.

## `tm-growth-os-seo-rest.php`

Makes Rank Math (and Yoast) SEO title and meta description readable and writable
through the WordPress REST API.

**Why it is needed:** WordPress does not expose arbitrary post meta over REST.
Meta must be registered with `show_in_rest`, and Rank Math stores its SEO fields
as plain post meta without registering them — so they are invisible to the API
even though the plugin is installed and working normally.

Found on the first WordPress site connected (alphazetaent.com, 2026-07-28):
Growth OS authenticated fine, could write page titles and content, and could not
see the SEO fields at all.

**Why it belongs here rather than in one site:** every TM non-eCommerce build is
WordPress, so this is true on all of them. Same shape as the GBP API application
— solve it once as a standard step rather than eleven times.

### Install

1. Copy the file into `wp-content/mu-plugins/` (create the directory if absent)
2. Nothing to activate — must-use plugins load automatically and cannot be
   switched off from the admin by accident
3. Verify: `/api/ops/wordpress-check?client=<uuid>` → `seo_fields_writable: true`

On WP Engine: SFTP, the file manager, or commit it to the site repo under
`wp-content/mu-plugins/`.

### What it does and does not do

- Exposes **four** meta keys and nothing else. Not a wildcard — exposing all meta
  would hand out whatever any other plugin stores on a post.
- Writes require `edit_post` on the **specific** post, so an Editor can change
  SEO on content they may already edit, and a Subscriber can change nothing.
- Grants no new capability. It makes an existing permission reachable over REST.

### Onboarding

Runbook step 8b covers WordPress connection. Install this at the same time as
creating the `growth-os` Editor account and its application password.
