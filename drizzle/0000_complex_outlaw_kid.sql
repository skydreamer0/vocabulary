CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`word_id` text NOT NULL,
	`term` text NOT NULL,
	`rating` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`due_before` integer NOT NULL,
	`due_after` integer NOT NULL,
	`interval_after` real NOT NULL,
	`streak_after` integer NOT NULL,
	`word_revision` integer NOT NULL,
	`timezone` text NOT NULL,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviews_user_event` ON `reviews` (`user_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `idx_reviews_user_time` ON `reviews` (`user_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`term` text NOT NULL,
	`norm_term` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`norm_context` text DEFAULT '' NOT NULL,
	`sense` text DEFAULT '' NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`phonetic` text DEFAULT '' NOT NULL,
	`dictionary` text DEFAULT '[]' NOT NULL,
	`lookup_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`interval_days` real DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_words_identity` ON `words` (`user_id`,`norm_term`,`norm_context`,`sense`);--> statement-breakpoint
CREATE INDEX `idx_words_user_due` ON `words` (`user_id`,`archived_at`,`due_at`);