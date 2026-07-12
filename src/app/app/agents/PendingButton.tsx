"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface PendingButtonProps {
  idleLabel: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}
export function PendingButton({
  idleLabel,
  pendingLabel,
  variant = "default",
  size = "default",
  className,
}: PendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden
        />
      )}
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
