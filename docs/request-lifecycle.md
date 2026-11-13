# Request lifecycle

This document describes the statuses of a request, the permitted status changes, the emails, the
customer cancellation, and the automatic deletion.

## Statuses

The list of statuses is in [statuses.ts](../packages/shared/src/statuses.ts).

| Status | Swedish label | Meaning | Who sets it |
| --- | --- | --- | --- |
| `unverified` | Ej verifierad | The customer sent the request, but did not open the email link yet | The API, when the customer sends the form |
| `new` | Ny | The customer verified the email address. The request waits for an employee. | The API, when the customer opens the link |
| `in_progress` | Under behandling | An employee works on the request | An employee |
| `accepted` | Godkänd | The store accepts the pickup at a confirmed time | An employee |
| `on_the_way` | På väg | The employees are on the way to the pickup | An employee |
| `completed` | Hämtad | The employees collected the items | An employee |
| `declined` | Nekad | The store does not accept the pickup | An employee |
| `cancelled` | Avbokad | Only in old rows. A customer cancellation now deletes the request. | Nobody |

## Status changes

```text
unverified --(customer opens link)--> new
new, in_progress, accepted, on_the_way --> in_progress | accepted | declined
accepted   --> on_the_way
on_the_way --> completed
```

The rules are in `changeStatus` in [admin/service.ts](../apps/api/src/admin/service.ts):

- An employee cannot change the status of an `unverified` request. The request can be spam.
- An employee cannot set `new` or `unverified`. A request that an employee started never goes
  back to `new`.
- `declined` and `completed` are final. The API refuses each status change.
- An employee cannot change a `cancelled` request.
- `on_the_way` is possible only from `accepted`.
- `completed` is possible only from `on_the_way`.
- `accepted` must have a confirmed date and time. The date cannot be in the past.
- An employee can set `accepted` again on an `accepted` request. This changes the pickup time.
- Each status change adds a row to `request_events` with the employee, the old status, and the new
  status.

An employee can delete a request in each status. The delete is immediate and permanent.

## Verification

1. The customer sends the form. The API keeps the request with the status `unverified`.
2. The API sends an email with the link `/bekrafta/<token>`. The link is valid for 24 hours.
3. The customer opens the link. The status changes to `new`.

If the link expires, the customer can ask for a new link on the status page. The limits are:

- 1 minute between two emails
- a maximum of 3 new links for each request
- a maximum of 5 new links for each IP address in 1 hour

A new link replaces the old link and is valid for 24 hours. The deletion date of an `unverified`
request does not change.

Employees can see `unverified` requests in the list, with the label "Ej verifierad". They can
delete them, but they cannot change their status.

## Emails to the customer

| Event | Email |
| --- | --- |
| The customer sends the form | The verification link |
| The customer asks for a new link | A new verification link |
| An employee sets `accepted` | The confirmed time, the message from the employee, and the store phone number |
| An employee sets `on_the_way` | A notice that the employees are on the way |
| An employee sets `declined` | The message from the employee |

The API sends no email for `in_progress` or `completed`.

Each status email has a new status-page link with a new token. All links of a request stay valid
until the system deletes the request. If an email is not sent, the status change stays. The
history then has no `email_sent` row. This tells employees that the email did not go out.

## Customer cancellation

The customer can cancel on the status page only when the status is `unverified` or `new`. The
customer must give a reason of 3 to 500 characters.

When the customer cancels:

1. The API deletes the request rows. It deletes them only if the status is still `unverified` or
   `new`. Thus, the API does not delete a request that an employee started a short time before.
2. The API deletes the photos from storage. If this is not successful, the orphan sweep deletes
   them within 1 day.
3. The API keeps the reason, the item list, and the dates in `cancellations`. It does not keep the
   name, contact details, address, or photos.
4. Employees see the reason on the "Avbokade" tab of the admin panel for 30 days.

When the status is `in_progress`, `accepted` or `on_the_way`, the status page shows the store phone
number. The customer must telephone the store to cancel or change the pickup.

## Automatic deletion

The function `scheduledDeletion` in [statuses.ts](../packages/shared/src/statuses.ts) calculates
the deletion date. The admin panel and the status page show this date. The hourly job `purge-retention`
deletes each request that is past this date. The tests make sure that the two agree.

| Status | Deletion date |
| --- | --- |
| `unverified` | 7 days after the customer sent the request |
| `new`, `in_progress` | 7 days after the last activity of an employee |
| `accepted` | 30 days after the end of the confirmed pickup time |
| `on_the_way` | The same date as for `accepted` |
| `completed`, `declined` | 30 days after the status change |

Activity is a status change or a note. When an employee opens a request, this is not activity.
For a `new` request, the time starts at the verification.
In the admin list, a warning shows when fewer than 3 days remain.

The time when a request closes is in the column `closed_at`. For `accepted`, `closed_at` is the end
of the confirmed pickup, or now if that time is in the past. A pickup can be up to 60 days in the
future. Thus, the deletion date starts at the pickup, not at the acceptance.

When the system deletes a request, it deletes the database rows first. Then it deletes the photos.
The job deletes a maximum of 100 requests in each round. The log contains only counts.

Other data that the system deletes automatically:

| Data | Deletion |
| --- | --- |
| Cancellation reasons | 30 days after the cancellation |
| Photo keys that no request uses (`pending_uploads`) | 2 hours after the API gave out the key |
| Photos in storage that no row refers to | When they are older than 24 hours |
| Backups | After a maximum of 30 days. Refer to [operations.md](operations.md#backups). |

## Pickup times

The customer proposes 1 to 3 times. Each time has a date and a part of the day:

| Part | Hours (Swedish time) |
| --- | --- |
| `forenoon` | 08:00 to 12:00 |
| `afternoon` | 12:00 to 17:00 |
| `evening` | 17:00 to 20:00 |
| `custom` | A start time and an end time from the customer |

The date must be 2 to 60 days after today in the `Europe/Stockholm` time zone
([dates.ts](../packages/shared/src/dates.ts)). The web app and the API use the same rule.

## Limits of the form

| Limit | Value | Source |
| --- | --- | --- |
| Photos for each request | 1 to 8 | `MAX_IMAGES` in [schemas.ts](../packages/shared/src/schemas.ts) |
| Size of each photo | 10 MB maximum | `MAX_IMAGE_BYTES` |
| Photo types | JPEG, PNG, WebP | `IMAGE_CONTENT_TYPES` |
| Proposed times | 1 to 3 | `MAX_TIME_WINDOWS` |
| Requests for each email address | 3 in 1 hour | `MAX_REQUESTS_PER_EMAIL_PER_HOUR` in [requests/service.ts](../apps/api/src/requests/service.ts) |
| Postcode | 5 digits. The API removes spaces. | [postcode.ts](../packages/shared/src/postcode.ts) |
| Phone number | The API keeps it in E.164 format (`+46...`) | [phone.ts](../packages/shared/src/phone.ts) |

The form keeps the typed data in `sessionStorage`. If a phone browser reloads the tab after the
camera opens, the data stays. The form does not keep photos or the consent. The data goes away when
the customer sends the form or closes the tab.
