import { requireContentTypeAccess } from "@/lib/auth-guard";
import { ContentType } from "@/lib/constants";
import { getCachedShows, getCachedTaxonomyTerms } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { CaseDocumentForm } from "@/components/forms/case-document-form";

export default async function CaseDocumentPage() {
  const session = await requireContentTypeAccess(ContentType.CASE_DOCUMENT);

  const [allShows, caseSeries, docTypes] = await Promise.all([
    getCachedShows(),
    getCachedTaxonomyTerms("swm_case_series"),
    getCachedTaxonomyTerms("swm_doc_type"),
  ]);

  // Filter shows to producer's allowed set (admins see all)
  let allowedShows = allShows.map((s) => ({
    id: String(s.id),
    title: s.title.rendered,
  }));

  if (session.user.role !== "admin") {
    const userShows = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    const allowedIds = new Set(userShows.map((us) => String(us.wpShowId)));
    allowedShows = allowedShows.filter((s) => allowedIds.has(s.id));
  }

  const caseSeriesOptions = caseSeries.map((t) => ({
    id: String(t.id),
    name: t.name,
  }));

  const docTypeOptions = docTypes.map((t) => ({
    id: String(t.id),
    name: t.name,
  }));

  return (
    <div className="container py-8">
      <CaseDocumentForm
        allowedShows={allowedShows}
        caseSeries={caseSeriesOptions}
        docTypes={docTypeOptions}
      />
    </div>
  );
}
