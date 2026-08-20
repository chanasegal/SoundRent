# Data sync across devices and screens

## Problem

Updates such as marking an item **Returned**, clearing a debt, or changing forgotten equipment were saved to the API on the acting device, but other open clients (desktop + tablet, or another browser tab) kept stale UI until a manual refresh.

## Resolution

Two complementary mechanisms:

### 1. Immediate API writes (already required)

Every mutation (return, mark debt paid, lost-equipment CRUD, unreturned resolve) continues to call the central HTTP API immediately via `DataService`. Persistence is not deferred to a later sync queue.

### 2. Client refresh without full page reloads

| Layer | Mechanism | Scope |
|-------|-----------|--------|
| Same browser tab | `OrdersSyncService` RxJS subjects (`orderChanged$`, `unreturnedChanged$`, `debtChanged$`, `lostEquipmentChanged$`, `loanChanged$`) | Instant: other views in the same Angular app instance refetch or patch |
| Other devices / tabs | `startLiveDataRefresh()` — targeted API GETs on a ~15s interval while the tab is visible, plus an immediate refetch on `visibilitychange` / window `focus` | Cross-device: open ops screens pull fresh lists without reloading the whole page |

There is no SignalR/WebSocket layer. Cross-device freshness is intentional API polling of list endpoints, not blind `location.reload()`.

## Where it is wired

- **Notify after mutate:** order returns, tool/library loan returns, debt create/mark-paid, lost-equipment create/update/delete, unreturned create/resolve.
- **Subscribe (same tab):** active loans, accessory returns, unreturned admin, tools lending/returns, reports (debts), lost-equipment admin, order-form / tools-lending customer risk & forgotten-equipment alerts.
- **Live refresh (cross-device):** the same ops screens call `startLiveDataRefresh` so a tablet sees a desktop return/debt/forgotten change within about one poll interval, or sooner when the tablet tab is focused again.

## Operator expectation

- Acting device: UI updates as soon as the API succeeds (local patch + sync notify).
- Other open devices: lists refresh automatically in the background; no manual F5 required for the covered screens.
