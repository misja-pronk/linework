---
status: accepted
date: 2026-09-22
deciders: [team-payments, team-data]
supersedes: 2
concerns: [payments.events, "payments.engine -> payments.events", "payments.events -> lake"]
---

# Payment events on Kafka between settlement and everyone else

## Context

[2. The gateway calls the settlement engine synchronously](0002-gateway-calls-settlement-synchronously.md) no longer holds: on the September salary run the ledger slowed down, gateway calls timed out and 4,100 payments were reported as pending. Meanwhile the data platform polls the settlement engine every minute for reporting, and fraud monitoring wants the same stream.

## Options

- Keep the synchronous call and scale the settlement engine out
- Publish every state change of a payment as an event on **Kafka** (Azure Event Hubs, Kafka API)
- Change data capture on the settlement engine's database

## Decision

The settlement engine **publishes every change of a payment** (received, checked, booked, sent, failed) as an event on the `payment-events` topic, keyed by payment id, schema in the registry. The gateway answers the customer as soon as the payment is checked and received; the customer's app follows the payment by its events. The data platform and fraud monitoring consume the topic instead of polling.

## Consequences

- A slow ledger no longer slows down the gateway: payments queue up and are booked in order per account.
- "Accepted" now means checked and received, not booked: the app says *on its way* until the booked event arrives. Product and legal agreed to the wording.
- Events are kept for 7 days; the data platform keeps history. Replaying a topic is now part of the runbook.
- One more thing to operate: the team takes the Event Hubs namespace on its on-call.
