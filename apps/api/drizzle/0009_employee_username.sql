-- Staff log in with a username instead of an email address; existing logins keep working as usernames.
ALTER TABLE `employees` RENAME COLUMN `email` TO `username`;
