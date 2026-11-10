---
status: superseded
superseded-by: 3
date: 2026-04-15
deciders: [team-payments]
concerns: ["payments.gateway -> payments.engine", payments.engine]
---

# The gateway calls the settlement engine synchronously

## Context

The first version of the Payments hub has to go live with instant payments in June. The gateway checks a payment (limits, sanctions, duplicate detection) and must tell the customer within two seconds whether it was accepted. The settlement engine books it with the core ledger and, for other banks, sends it over SWIFT.

## Options

- The gateway calls the settlement engine over gRPC and waits for the booking
- The gateway puts the payment on a queue and answers "accepted" before it is settled

## Decision

The gateway calls the settlement engine **synchronously over gRPC** and answers the customer once the engine has booked the payment. Timeouts are 1.5 seconds; a payment that times out is reported as pending and reconciled at night.

## Consequences

- Simple to build and to reason about for the first release: one call, one answer.
- The gateway can only take as many payments as the engine can book; a slow ledger slows down every customer.
- Revisit when volumes pass 50 payments a second or when salary runs make the ledger slow.
