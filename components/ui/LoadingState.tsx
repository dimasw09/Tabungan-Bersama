export function LoadingState({ label = 'Lagi ngambil data...' }: { label?: string }) {
  return (
    <div className="rounded-[2rem] border border-white/80 bg-white/60 p-8 text-center text-sm font-semibold text-stone-500 shadow-soft">
      {label}
    </div>
  );
}
