-- "Bekräftad" now names the in_progress status, so the email verification note says "verifierad".
UPDATE `request_events` SET `note` = 'verifierad via e-post'
WHERE `type` = 'status_change' AND `from_status` = 'unverified' AND `note` = 'Bekräftad via e-post';
