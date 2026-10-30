# Data Isolation and Child Safety Rules

SparkKindly has no tenants, but it has boundaries that are security boundaries all the same.

- **Server-derived context is authoritative.** The signed-in account, the active profile (adult or child) and
  circle membership are resolved on the server from the session, never from a client-supplied id.
- **Every scoped query constrains its scope.** Account data by account id; circle data by membership; child-profile
  data by the owning account. Cache keys, email recipients, job payloads and share images carry the same scope.
- **Missing context fails closed.** No session → anonymous capabilities only. No membership → no circle data.
- **Cross-scope references are rejected even when the id is valid.** Another account's profile id, a circle the
  caller does not belong to, an item id in a daily set the circle was not given.
- **Audience is a safety filter, not a preference.** A child profile, and any circle containing one, never receives
  `adults` items, comments or sponsorship, on any route, in any email, in any job output.
- **Age-group permissions are enforced on the server** from the account's date of birth and consent state:
  under-13 no account; 13–15 consent-pending or consent-confirmed with the younger-teen restrictions; 16–17; 18+.
- **Agent keys are scoped.** An agent reads and writes only its own items and its own world's brief.
- **Admin is an allow-list plus a second factor.** Admin routes check both on every request.

Required adversarial cases for any change that touches these paths:
own account → own data allowed
account A → account B's data denied
non-member → circle denied
child profile → `adults` item denied (list, detail, search, dashboard, daily set, email)
child profile → settings, invites, comments, contribute, admin denied
13–15 account → public comment, community join, contribute denied
agent key A → agent B's items denied
tampered profile id / circle id / item id in payload denied
anonymous → anything beyond read and play denied
