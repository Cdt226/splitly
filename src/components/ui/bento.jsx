import { cn } from "@/lib/utils"

export function BentoGrid({ children, className }) {
  return (
    <div className={cn(
      "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
      className
    )}>
      {children}
    </div>
  )
}

export function BentoCard({ children, className, span = 1, onClick }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-card text-card-foreground shadow-sm",
        "transition-all duration-200",
        onClick && "cursor-pointer hover:shadow-md hover:-translate-y-0.5",
        span === 2 && "sm:col-span-2",
        span === 3 && "sm:col-span-2 lg:col-span-3",
        className
      )}
    >
      {children}
    </div>
  )
}

export function BentoCardHeader({ children, className }) {
  return (
    <div className={cn("flex items-center justify-between p-4 pb-2", className)}>
      {children}
    </div>
  )
}

export function BentoCardTitle({ children, className }) {
  return (
    <p className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </p>
  )
}

export function BentoCardContent({ children, className }) {
  return (
    <div className={cn("p-4 pt-2", className)}>
      {children}
    </div>
  )
}
