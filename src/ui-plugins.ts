/**
 * Extra Better Auth UI plugins for this site. Empty by default.
 *
 * Better Auth UI plugins can add settings tabs, avatar-menu items and routable
 * sub-pages. A site that wants one points this module at its own file with the
 * `betterAuthUi()` Vite plugin (see `emdash-better-auth/vite`); the file's default
 * export is an array of Better Auth UI plugin objects, and every view (sign-in,
 * account, admin, organization, audit log) registers them.
 */
// ponytail: loosely typed on purpose; each plugin factory carries its own type.
// oxlint-disable-next-line typescript/no-explicit-any
const extraUiPlugins: any[] = [];
export default extraUiPlugins;
