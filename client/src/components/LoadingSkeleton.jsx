export function LoadingSkeleton({ rows = 3 }) { return <div className="space-y-3">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-card bg-primary-light/60" />)}</div> }

