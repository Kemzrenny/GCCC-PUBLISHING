// One block of settings: a title, a line on what it's for, an optional status, then the
// controls. Rows inside are separated by a rule (use <Row>).
export function Section({
  id,
  title,
  description,
  status,
  children,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-6 overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-line px-6 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex max-w-2xl min-w-0 flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </header>
      <div className="flex flex-col divide-y divide-line">{children}</div>
    </section>
  );
}

export function Row({ title, hint, children, wide }: { title?: string; hint?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  if (!title) return <div className="flex flex-col gap-3 px-6 py-5">{children}</div>;
  return (
    <div className={`grid gap-3 px-6 py-5 ${wide ? "" : "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8"}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-medium">{title}</h3>
        {hint && <p className="text-[13px] text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-field/60 px-4 py-3">
      <span className="font-display text-2xl font-semibold">{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

export function when(iso: string) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}
