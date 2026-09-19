export function EmptyState({ title = 'Nothing here yet', message = 'New items will appear here when available.', children }) { return <div role="status" className="rounded-card border border-dashed border-border bg-white p-8 text-center"><p className="font-sans text-lg text-charcoal">{title}</p><p className="mt-1 text-sm text-muted">{message}</p>{children}</div> }

