export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="soft-pop rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <p className="text-lg font-bold text-stone-700">{title}</p>
      {description ? <p className="mt-2 text-sm text-stone-500">{description}</p> : null}
    </div>
  );
}
