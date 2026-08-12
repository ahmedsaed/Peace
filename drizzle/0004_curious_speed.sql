ALTER TABLE `transactions` ADD `original_amount_minor` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `original_currency` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `fee_for_id` text;