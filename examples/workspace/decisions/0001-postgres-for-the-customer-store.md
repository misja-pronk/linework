---
status: accepted
date: 2026-03-04
deciders: [team-digital, security]
concerns: [online.db, "online.api.signin -> online.db"]
---

# PostgreSQL for the customer store

## Context

Harbour Online keeps logins, devices and customer preferences apart from the core ledger, which only holds accounts and bookings. The store is small (a few million rows), read far more than it is written, and holds personal data, so it must be encrypted at rest, backed up to a second region, and easy to audit. The team knows PostgreSQL well; nobody on it has run a document database in production.

## Options

- **PostgreSQL 16** on Azure Database for PostgreSQL, flexible server
- Azure Cosmos DB (NoSQL API)
- A schema in the core ledger's Oracle database

## Decision

We will keep the customer store in **PostgreSQL 16** on the managed flexible server, zone-redundant, with customer-managed keys and point-in-time restore of 35 days. The sign-in controller is the only writer of logins; it reaches the store over JDBC with a managed identity, never a password.

## Consequences

- One relational store the team can operate, query and audit with tools it already has.
- Row-level security and column encryption for personal data are ours to build; Cosmos would not have given them either.
- Putting it in the ledger's database was rejected: it would tie Harbour Online's releases to the ledger's change windows.
