/**
 * Conventional Commits, enforced locally via the Husky `commit-msg` hook.
 * The PR-title workflow enforces the same on squash-merge.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
