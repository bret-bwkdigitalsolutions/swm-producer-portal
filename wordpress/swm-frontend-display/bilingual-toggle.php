<?php
/**
 * Bilingual toggle for swm_blog posts.
 *
 * Renders both language versions with a client-side toggle when
 * bilingual meta fields exist on the post.
 */

if (!defined('ABSPATH')) exit;

/**
 * Register bilingual meta fields so they're available via REST API.
 */
function swm_register_bilingual_meta() {
    $fields = [
        '_swm_blog_title_en',
        '_swm_blog_content_en',
        '_swm_blog_excerpt_en',
        '_swm_blog_seo_description_en',
        '_swm_blog_seo_keyphrase_en',
    ];

    foreach ($fields as $field) {
        register_post_meta('swm_blog', $field, [
            'show_in_rest' => true,
            'single'       => true,
            'type'         => 'string',
            'auth_callback' => function() {
                return current_user_can('edit_posts');
            },
        ]);
    }
}
add_action('init', 'swm_register_bilingual_meta');

/**
 * Filter the_content on swm_blog single posts to add the bilingual toggle.
 */
function swm_bilingual_content_filter($content) {
    if (!is_singular('swm_blog')) {
        return $content;
    }

    $post_id = get_the_ID();
    $en_content = get_post_meta($post_id, '_swm_blog_content_en', true);

    // No translation — render normally
    if (empty($en_content)) {
        return $content;
    }

    $en_title = get_post_meta($post_id, '_swm_blog_title_en', true);

    // Enqueue assets
    $plugin_url = plugin_dir_url(__FILE__);
    wp_enqueue_style('swm-bilingual-toggle', $plugin_url . 'bilingual-toggle.css', [], '1.0');
    wp_enqueue_script('swm-bilingual-toggle', $plugin_url . 'bilingual-toggle.js', [], '1.0', true);

    // Build the toggle + dual-content HTML
    $toggle = '<div class="swm-lang-toggle" role="tablist" aria-label="Language">'
        . '<button class="swm-lang-btn active" role="tab" aria-selected="true" data-lang="es">ES</button>'
        . '<button class="swm-lang-btn" role="tab" aria-selected="false" data-lang="en">EN</button>'
        . '</div>';

    $primary = '<div class="swm-lang-content" data-lang="es">' . $content . '</div>';
    $secondary = '<div class="swm-lang-content" data-lang="en" style="display:none">'
        . ($en_title ? '<h1>' . esc_html($en_title) . '</h1>' : '')
        . $en_content
        . '</div>';

    return $toggle . $primary . $secondary;
}
add_filter('the_content', 'swm_bilingual_content_filter', 20);
