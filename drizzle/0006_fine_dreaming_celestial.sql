CREATE TABLE `asset_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_bp` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_asset_classes_sort` ON `asset_classes` (`sort_order`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`asset_class_id` text NOT NULL,
	`units_micro` integer DEFAULT 0 NOT NULL,
	`price_minor` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_holdings_class` ON `holdings` (`asset_class_id`);