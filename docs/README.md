# Project documentation

This folder contains the documentation for the pickup request system ("Hämtning av second hand").
The text uses ASD-STE100 Simplified Technical English (STE). The section
[Writing rules](#writing-rules) gives the rules to use when you change these documents.

## What the system does

A second-hand store collects used furniture and other items from the homes of customers. A
customer uses a public form in Swedish to send a pickup request. The customer adds photos of the
items and proposes 1 to 3 pickup times. Store employees examine the request in the admin panel.
Then they accept it or decline it. The customer receives an email for each decision.

The system has no customer accounts. The customer confirms the email address with a link. The same
link opens a private status page for the request.

## Documents

| Document | Contents |
| --- | --- |
| [architecture.md](architecture.md) | The parts of the system, how data moves between them, and why the design is as it is |
| [development.md](development.md) | How to install the project on a computer, run it, and do tests |
| [request-lifecycle.md](request-lifecycle.md) | Statuses, status changes, emails, cancellation, and automatic deletion |
| [api.md](api.md) | All API endpoints, their limits, and their error codes |
| [configuration.md](configuration.md) | All environment variables and settings files |
| [deployment.md](deployment.md) | How to install the system on a new server |
| [operations.md](operations.md) | Deploys, rollback, backups, monitoring, restore, and the launch checklist |
| [load-testing.md](load-testing.md) | How to measure the capacity of the system with k6 |

[SPEC.md](../SPEC.md) is the original design specification. It shows the reasons for many
decisions, but some parts are old. If SPEC.md and these documents are different, these documents
are correct. If these documents and the source code are different, the source code is correct.
Correct the documents in the same commit.

## Terms

These documents use each term with one meaning only.

| Term | Meaning |
| --- | --- |
| Request | A pickup request from a customer. It contains contact details, items, photos and proposed times. In Swedish: "ärende". |
| API call | An HTTP request to the API. These documents do not use "request" for this. |
| Customer | The person who sends a request. The customer has no account. |
| Employee | A person who works at the store and has an account for the admin panel. An employee has the role `staff` or `admin`. |
| Admin panel | The web pages under `/admin`. Employees use them to process requests. |
| Status page | The private page `/arende/<token>` where the customer sees the status of a request and can cancel it. |
| Token | A random value of 32 bytes in a link. The database keeps only the SHA-256 hash of the token. |
| Storage | The Garage server. It keeps the photos and has an S3-compatible API. |
| Server | The virtual private server (VPS) in production. |
| Retention | The time that the system keeps data before it deletes the data automatically. |

## Writing rules

Use these STE rules when you write or change a document in this folder:

1. Write one instruction in one sentence. Use the imperative: "Run the command."
2. Write procedural sentences with a maximum of 20 words.
3. Write descriptive sentences with a maximum of 25 words.
4. Write paragraphs with a maximum of 6 sentences and one topic.
5. Use the active voice.
6. Use the simple present, simple past, or simple future tense.
7. Use the terms in the table above. Do not use synonyms for them.
8. Use "must" for a requirement and "can" for a possibility. Do not use "should" or "may".
9. Write numbered lists for steps in a sequence. Write bullet lists for items without a sequence.
10. Put a warning or a caution before the step that it applies to. A warning is about a risk to
    people or data. A caution is about a risk to equipment or service.
11. Do not use contractions ("don't", "can't") or Latin abbreviations ("e.g.", "i.e.", "etc.").
    Write "for example" and "and others".
12. Write the names of files, commands, variables and code values in `code format`.
