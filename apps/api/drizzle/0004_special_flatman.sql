CREATE TABLE `cancellations` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`reason` text NOT NULL,
	`items` text NOT NULL,
	`request_created_at` text NOT NULL,
	`cancelled_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cancellations_cancelled_at` ON `cancellations` (`cancelled_at`);