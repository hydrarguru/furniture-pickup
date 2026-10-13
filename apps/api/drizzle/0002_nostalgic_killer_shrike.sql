PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`assigned_to` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assigned_to`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "requests_status_check" CHECK("__new_requests"."status" IN ('unverified','new','in_progress','accepted','on_the_way','declined','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "status", "name", "email", "phone", "street", "postcode", "city", "access_notes", "has_elevator", "floor", "message", "consent_at", "verified_at", "seen_at", "token_hash", "token_expires", "confirmed_start", "confirmed_end", "staff_message", "assigned_to", "closed_at", "created_at", "updated_at") SELECT "id", "status", "name", "email", "phone", "street", "postcode", "city", "access_notes", "has_elevator", "floor", "message", "consent_at", "verified_at", "seen_at", "token_hash", "token_expires", "confirmed_start", "confirmed_end", "staff_message", "assigned_to", "closed_at", "created_at", "updated_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_requests_status_created` ON `requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_requests_closed_at` ON `requests` (`closed_at`) WHERE "requests"."closed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_requests_token_hash` ON `requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_requests_email_created` ON `requests` (`email`,`created_at`);