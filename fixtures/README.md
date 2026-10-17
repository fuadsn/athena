# Runtime history fixture

`company-history.json` contains synthetic HelioWorks directory facts, three closed trial cases, source text, and observed tool actions. The data is authored for this project and contains no real customer or employee records.

Northstar and Cedar each received seven-day trials. Their expiry/access configuration order differs. Lumen received thirty days after Ravi consented to that historical request. These observations support a proposed procedure but do not authorize future behavior.

The importer accepts only the strict `HistorySeedSchema`. It validates content hashes and literal source references before writing directory, history, and provenance relationships to FalkorDB. Source text is immutable UTF-8; `contentHash` is its SHA-256 without an added newline. Historical workspace snapshots do not create current Lab resources.

Do not add Procedure, Rule, Step, Plan, or Approval seed records. Do not import `evals/acceptance.json` into the graph or give it to the learner. Reusable policy begins only when the authenticated process owner submits the structured review; request-specific approval is a separate action.
