CREATE TABLE `bank_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_key` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`posted_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`amount_minor` integer,
	`currency` text,
	`direction` text,
	`merchant` text,
	`occurred_on` text,
	`account_tail` text,
	`transaction_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_captures_capture_key_unique` ON `bank_captures` (`capture_key`);--> statement-breakpoint
CREATE INDEX `idx_bank_captures_status` ON `bank_captures` (`status`,`posted_at`);