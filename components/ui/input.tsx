import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 placeholder:text-ice-400",
      "focus:outline-none focus:ring-2 focus:ring-ice-500",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium text-ice-200", className)}
    {...props}
  />
));
Label.displayName = "Label";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50",
      "focus:outline-none focus:ring-2 focus:ring-ice-500",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
