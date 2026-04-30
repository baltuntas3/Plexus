import type { OrganizationRole } from "@plexus/shared-types";

// UI-only color mapping for role badges. Owner is the visually
// "elevated" role; admin/editor/approver/viewer follow descending
// authority. Centralized so the same role consistently renders in the
// same color across members table, invitations table, and any future
// audit/event surface.
export const roleColor: Record<OrganizationRole, string> = {
  owner: "violet",
  admin: "blue",
  editor: "teal",
  approver: "orange",
  viewer: "gray",
};
