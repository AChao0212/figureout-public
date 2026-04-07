"use client";

// Legacy component — replaced by UserMenu.tsx
// Kept for backward compatibility, redirects to UserMenu
import UserMenu from "./UserMenu";

export default function AuthButton() {
  return <UserMenu />;
}
