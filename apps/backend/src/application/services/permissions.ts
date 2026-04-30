// Re-export of the canonical role → permission map from
// `@plexus/shared-types`. Backend authorization middleware and frontend UI
// gating consume the same matrix so disabled-buttons and 403 responses
// stay aligned without manual duplication.
export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  type Permission,
} from "@plexus/shared-types";
