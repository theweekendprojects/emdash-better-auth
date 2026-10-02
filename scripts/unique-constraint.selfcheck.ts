/**
 * Runnable self-check for the org/membership uniqueness logic. Dependency-free.
 *
 * Covers the two decisions that gate the adapter's assertUnique: which creates
 * get checked (constraintToCheck) and whether an existing row collides
 * (recordMatchesConstraint, incl. the composite member/teamMember case).
 */

import { deepEqual, equal } from "./assert.js";
import {
	UNIQUE_CONSTRAINTS,
	constraintToCheck,
	recordMatchesConstraint,
} from "../src/unique-constraint.js";

// 1. organization is a single-field (slug) constraint.
deepEqual(UNIQUE_CONSTRAINTS.organization, ["slug"]);
// member + teamMember are composite.
deepEqual(UNIQUE_CONSTRAINTS.member, ["userId", "organizationId"]);
deepEqual(UNIQUE_CONSTRAINTS.teamMember, ["userId", "teamId"]);

// 2. A model with no constraint is never checked.
equal(constraintToCheck("session", { token: "t" }), null);

// 3. organization with a slug is checked.
deepEqual(constraintToCheck("organization", { slug: "acme" }), ["slug"]);

// 4. A missing/null constraint field skips the check (nothing to collide).
equal(constraintToCheck("organization", { name: "Acme" }), null);
equal(constraintToCheck("member", { userId: "u1", organizationId: null }), null);

// 5. member is checked only when BOTH composite fields are present.
deepEqual(constraintToCheck("member", { userId: "u1", organizationId: "o1" }), [
	"userId",
	"organizationId",
]);

// 6. recordMatchesConstraint: same slug collides, different slug doesn't.
{
	const fields = ["slug"];
	equal(recordMatchesConstraint(fields, { slug: "acme" }, { slug: "acme" }), true);
	equal(recordMatchesConstraint(fields, { slug: "acme" }, { slug: "other" }), false);
}

// 7. Composite: same user in SAME org collides; same user in a DIFFERENT org
//    does not (the whole point of multi-tenancy — a user can be in many orgs).
{
	const fields = ["userId", "organizationId"];
	const data = { userId: "u1", organizationId: "o1" };
	equal(recordMatchesConstraint(fields, data, { userId: "u1", organizationId: "o1" }), true);
	equal(recordMatchesConstraint(fields, data, { userId: "u1", organizationId: "o2" }), false);
	equal(recordMatchesConstraint(fields, data, { userId: "u2", organizationId: "o1" }), false);
}

console.log("unique-constraint self-check: all 7 cases passed");
