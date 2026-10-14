CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text,
	`record_count` integer NOT NULL,
	`created_account_ids` text DEFAULT '[]' NOT NULL,
	`created_category_ids` text DEFAULT '[]' NOT NULL,
	`created_tag_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_id` text;--> statement-breakpoint
CREATE INDEX `idx_tx_import` ON `transactions` (`import_id`);