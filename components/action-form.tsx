"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

export type FormResult = { error?: string; success?: string };
export function ActionForm({ action, children, className }: {
  action: (data: FormData) => Promise<FormResult>;
  children: ReactNode;
  className?: string;
}) {
  const [result, formAction] = useActionState(async (_previous: FormResult, data: FormData) => action(data), {});
  return <form action={formAction} className={className} onReset={(event) => event.preventDefault()}>
    {children}
    {result.error && <p className="form-error form-feedback" role="alert">{result.error}</p>}
    {result.success && <p className="info-box form-feedback" role="status">{result.success}</p>}
  </form>;
}
