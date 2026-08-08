CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'cash' NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`interest_rate` real,
	`icon` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_sort` ON `accounts` (`archived`,`sort_order`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`width` integer,
	`height` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_tx` ON `attachments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`period` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_budgets_category_period` ON `budgets` (`category_id`,`period`);--> statement-breakpoint
CREATE INDEX `idx_budgets_period` ON `budgets` (`period`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`parent_id` text,
	`icon` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_categories_kind` ON `categories` (`kind`,`archived`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_categories_parent` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`type` text DEFAULT 'expense' NOT NULL,
	`account_id` text NOT NULL,
	`counter_account_id` text,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`fx_rate` real DEFAULT 1 NOT NULL,
	`note` text,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`anchor_day` integer,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`next_run_on` text,
	`last_run_on` text,
	`auto_post` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_due` ON `recurring_rules` (`active`,`next_run_on`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`fx_rate` real DEFAULT 1 NOT NULL,
	`note` text,
	`transfer_pair_id` text,
	`counter_account_id` text,
	`recurring_rule_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_rule_id`) REFERENCES `recurring_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tx_occurred_at` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_account_occurred` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_category_occurred` ON `transactions` (`category_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_transfer_pair` ON `transactions` (`transfer_pair_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_recurring` ON `transactions` (`recurring_rule_id`);