<?php
/**
 * Plugin Name:  TM Growth OS — expose SEO meta to REST
 * Description:  Registers Rank Math (and Yoast) SEO title and meta description as REST-visible post meta, so Growth OS can read and write them through the WordPress REST API.
 * Version:      1.0.0
 * Author:       Trusted Marketing
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * WordPress does not expose arbitrary post meta through the REST API. Meta is
 * only readable and writable if it has been registered with `show_in_rest`.
 * Rank Math stores its SEO fields as ordinary post meta (`rank_math_title`,
 * `rank_math_description`) and does not register them, so they are invisible to
 * the REST API even though the plugin is installed and working.
 *
 * Verified on alphazetaent.com, 2026-07-28: Growth OS authenticated, could write
 * titles and content, and could not see the SEO fields at all.
 *
 * Every TM non-eCommerce build is WordPress, so this is true on all of them.
 * Installing it once per site as part of onboarding is the fix; patching one
 * site at a time is not.
 *
 * ---------------------------------------------------------------------------
 * INSTALL
 *
 * Drop this file into `wp-content/mu-plugins/` (create the directory if it does
 * not exist). Must-use plugins load automatically — there is nothing to
 * activate, and it cannot be deactivated by accident from the admin.
 *
 * On WP Engine, upload via SFTP or the file manager, or commit it to the site
 * repo under `wp-content/mu-plugins/`.
 *
 * VERIFY:  /api/ops/wordpress-check?client=<uuid>  →  seo_fields_writable: true
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 *
 * This exposes exactly four meta keys and nothing else. Writes require the
 * `edit_post` capability for the specific post being edited, so an Editor can
 * change SEO on posts they may edit and a Subscriber can change nothing. It
 * grants no capability that WordPress did not already grant — it only makes an
 * existing permission reachable over REST.
 */

if (!defined('ABSPATH')) {
    exit; // called directly
}

add_action('init', function () {

    /**
     * Only the SEO fields Growth OS actually writes. Deliberately not a
     * wildcard: exposing all meta to REST would hand out whatever any other
     * plugin happens to store on a post.
     */
    $keys = array(
        // Rank Math
        'rank_math_title'       => 'string',
        'rank_math_description' => 'string',
        // Yoast, for sites that run it instead
        '_yoast_wpseo_title'    => 'string',
        '_yoast_wpseo_metadesc' => 'string',
    );

    /**
     * Per-post capability check.
     *
     * `edit_post` rather than a blanket `edit_posts`: the question is whether
     * this user may edit THIS post, which is what WordPress would ask anywhere
     * else. Returning a blanket true here would let any authenticated user
     * rewrite SEO on content they cannot otherwise touch.
     */
    $auth = function ($allowed, $meta_key, $post_id) {
        return current_user_can('edit_post', $post_id);
    };

    // Public, REST-enabled post types only. A meta key registered against a post
    // type that has no REST route is invisible anyway, and registering against
    // internal types would be noise.
    $post_types = get_post_types(array('public' => true, 'show_in_rest' => true), 'names');

    foreach ($post_types as $post_type) {
        foreach ($keys as $key => $type) {
            register_post_meta($post_type, $key, array(
                'type'          => $type,
                'single'        => true,
                'show_in_rest'  => true,
                'auth_callback' => $auth,
                // Yoast keys are underscore-prefixed, which WordPress treats as
                // protected. Registering them explicitly is what makes them
                // addressable; the auth callback above still governs writes.
            ));
        }
    }
}, 20); // after plugins have registered their post types
