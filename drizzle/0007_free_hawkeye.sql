CREATE TABLE `recurring_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `recurring_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_skip_rule_date` ON `recurring_skips` (`rule_id`,`occurred_on`);