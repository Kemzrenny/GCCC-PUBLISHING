// Readable long-form text for the public pages.
export default function Prose({ children }: { children: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-4 text-[15px] leading-7 [&_a]:font-medium [&_a]:text-accent [&_a:hover]:underline [&_h1]:font-display [&_h1]:text-4xl [&_h1]:leading-tight [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
      {children}
    </article>
  );
}
