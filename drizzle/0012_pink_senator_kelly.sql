ALTER TABLE `bank_captures` ADD `matched_category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `bank_captures` ADD `is_withdrawal` integer DEFAULT false NOT NULL;