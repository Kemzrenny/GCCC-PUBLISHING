import { Section, Row } from "@/components/settings/Section";
import { ImportForm } from "@/components/SettingsForms";

export const metadata = { title: "Settings · Import" };

export default function ImportPage() {
  return (
    <Section
      title="Import the Publishing sheet"
      description="Brings in the Publishing Central Content System sheet: titles, dates, speakers and manual links. Rows are matched by their ID and Podbean link, so importing again updates them instead of adding duplicates."
    >
      <Row>
        <ImportForm />
      </Row>
    </Section>
  );
}
