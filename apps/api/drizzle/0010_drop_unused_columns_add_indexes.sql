PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_images` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`s3_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_images`("id", "request_id", "s3_key", "content_type", "size_bytes", "position") SELECT "id", "request_id", "s3_key", "content_type", "size_bytes", "position" FROM `images`;--> statement-breakpoint
DROP TABLE `images`;--> statement-breakpoint
ALTER TABLE `__new_images` RENAME TO `images`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `images_s3_key_unique` ON `images` (`s3_key`);--> statement-breakpoint
CREATE INDEX `idx_images_request` ON `images` (`request_id`);--> statement-breakpoint
CREATE TABLE `__new_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`street` text NOT NULL,
	`postcode` text NOT NULL,
	`city` text NOT NULL,
	`access_notes` text,
	`has_elevator` integer,
	`floor` integer,
	`message` text,
	`consent_at` text NOT NULL,
	`verified_at` text,
	`seen_at` text,
	`token_hash` text NOT NULL,
	`token_expires` text NOT NULL,
	`confirmed_start` text,
	`confirmed_end` text,
	`staff_message` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "requests_status_check" CHECK("__new_requests"."status" IN ('unverified','new','in_progress','accepted','on_the_way','declined','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "status", "name", "email", "phone", "street", "postcode", "city", "access_notes", "has_elevator", "floor", "message", "consent_at", "verified_at", "seen_at", "token_hash", "token_expires", "confirmed_start", "confirmed_end", "staff_message", "closed_at", "created_at", "updated_at") SELECT "id", "status", "name", "email", "phone", "street", "postcode", "city", "access_notes", "has_elevator", "floor", "message", "consent_at", "verified_at", "seen_at", "token_hash", "token_expires", "confirmed_start", "confirmed_end", "staff_message", "closed_at", "created_at", "updated_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
CREATE INDEX `idx_requests_status_created` ON `requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_requests_closed_at` ON `requests` (`closed_at`) WHERE "requests"."closed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_requests_token_hash` ON `requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_requests_email_created` ON `requests` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_items_request` ON `items` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_request_events_request` ON `request_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_time_windows_request` ON `time_windows` (`request_id`);--> statement-breakpoint
ALTER TABLE `pending_uploads` DROP COLUMN `ip_hash`;