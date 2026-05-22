-- High-intent keyword phrases (JSON array) proposed at analyze time and
-- attached as swm_blog tags when the post is published to WordPress.
ALTER TABLE "blog_posts" ADD COLUMN "keywords" TEXT;
