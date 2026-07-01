import { cn } from "@/lib/cn";
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("rounded-xl border border-border bg-card text-card-foreground p-6", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) =>
  <h3 className={cn("text-heading-16 mb-3", className)} {...p} />;
