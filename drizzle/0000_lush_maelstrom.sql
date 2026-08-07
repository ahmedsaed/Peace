CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'cash' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`icon` text,
	`color` text,
	`budget_minor` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fx_rate` real DEFAULT 1 NOT NULL,
	`note` text,
	`transfer_pair_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tx_occurred_at` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_account_occurred` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_category` ON `transactions` (`category_id`);