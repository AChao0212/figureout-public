"use client";

import { useAuth } from "./AuthContext";

export default function AdminEditButton({ figureId }: { figureId: number }) {
  const { user } = useAuth();

  if (!user || (user.role !== "admin" && user.role !== "editor")) return null;

  return (
    <a
      href={`/admin?editFigure=${figureId}`}
      title="在管理後台編輯"
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: "50%",
        background: "rgba(0,0,0,0.5)",
        cursor: "pointer",
        transition: "background 0.15s, transform 0.15s",
        flexShrink: 0,
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.transform = "scale(1.15)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.transform = "scale(1)"; }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </a>
  );
}
