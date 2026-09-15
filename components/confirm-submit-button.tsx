"use client";

import { useFormStatus } from "react-dom";

export function ConfirmSubmitButton({
  children,
  confirmation,
  pendingLabel = "Saving…",
  className = "button button-primary",
}: {
  children: React.ReactNode;
  confirmation: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
