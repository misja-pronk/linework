---
status: proposed
date: 2026-11-03
deciders: [team-digital, team-core]
concerns: [ledger, "online.api.accounts -> ledger"]
---

# Read balances from a read replica of the ledger

## Context

Most calls Harbour Online makes to the core ledger are balance reads: 92% of them in October, peaking at 1,800 a second on the first of the month. They share the ledger with booking, and the ledger team wants to protect booking from them. Customers accept a balance that is a second old; they do not accept one that is a minute old.

## Options

- A read replica of the ledger database, read by the accounts controller
- A balance cache in Harbour Online, filled from payment events
- Leave it, and buy a bigger ledger server

## Decision

Proposed: the accounts controller reads balances from a **read replica** of the ledger with a replication lag alarm at 2 seconds; bookings and anything a payment decision depends on still go to the primary.

## Consequences

- Booking no longer competes with balance reads.
- Two places to read from: the controller must be clear which reads may be stale.
- The cache option stays open for later; it would build on the events of [3](0003-kafka-for-payment-events.md).
