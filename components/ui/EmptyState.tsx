export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-[2rem] border border-dashed border-blush-300 palette-card p-8 text-center shadow-sm">
      <p className="text-lg font-black text-stone-800">{title}</p>
      {description ? <p className="mt-2 text-sm font-semibold text-stone-500">{description}</p> : null}
    </div>
  );
}
