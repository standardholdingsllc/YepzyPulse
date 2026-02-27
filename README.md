# Yepzy Transaction Processor

A Vercel-hosted web tool that ingests raw debit transaction exports from Unit (CSV), enriches them with employer mapping and remittance vendor classification, and publishes shareable, interactive report links.

## Features

- **CSV Ingestion**: Upload Unit transaction export CSVs (up to 25k+ rows)
- **Employer Mapping**: Automatically fetches the official customer→employer mapping from [hubspot-address-mapper](https://github.com/standardholdingsllc/hubspot-address-mapper), or use a custom JSON file
- **US Location Detection**: Parse merchant/ATM addresses to identify customers currently in the US
  - Explicit counts shown in UI: "Included: X US / Excluded: Y non-US / Unknown: Z"
  - Warning when strict mode excludes many unknown customers
- **Remittance Classification**: Identify remittance vendors (RIA, Remitly, Intermex, Western Union, etc.)
  - Match evidence stored per transaction for debugging misclassifications
  - Supports real Unit export patterns (e.g., `RMTLY*`, `Felix Pago`, `WU DIGITAL USA AFT`)
- **Transaction Type Grouping**: Categorize transactions (Card, ATM, Fee, Book/Payment, Transfer/Other)
- **Interactive Reports**: Searchable, sortable, filterable tables with drill-down capability
- **Shareable Links**: Every report gets a unique URL that anyone can access
- **Auto-Expiry**: Reports automatically expire after 7 days to manage storage costs

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **Hosting**: Vercel
- **Testing**: Jest + ts-jest

## Environment Variables

Create a `.env.local` file with:

```bash
# Supabase connection
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Database Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the migration SQL in your Supabase SQL editor:

```bash
# Copy and paste the contents of:
supabase/migrations/001_initial_schema.sql
```

This creates the following tables:
- `reports` — Report metadata, slug, filter settings, classification rules, expires_at (7 days TTL)
- `report_transactions` — Normalized transaction rows per report (includes vendor_match_evidence)
- `report_employer_rollups` — Precomputed employer-level aggregates
- `report_vendor_rollups` — Precomputed vendor-level aggregates
- `report_customer_locations` — Customer US location status per report

### Automatic Cleanup

Reports expire after 7 days. To enable automatic cleanup, enable the `pg_cron` extension in Supabase and schedule:

```sql
SELECT cron.schedule('cleanup-expired-reports', '0 3 * * *', 'SELECT cleanup_expired_reports()');
```

## Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

1. Push code to a Git repository (GitHub, GitLab, etc.)
2. Import the project in [Vercel](https://vercel.com)
3. Add the environment variables in Vercel project settings
4. Deploy

The app uses `maxDuration: 60` on the report generation API route. If you're on the Vercel Hobby plan (10s limit), consider upgrading to Pro for large CSV processing.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                          # Landing page with upload form
│   ├── layout.tsx                        # Root layout
│   ├── globals.css                       # Tailwind base styles
│   ├── api/
│   │   ├── generate-report/route.ts      # POST: CSV ingestion & report generation
│   │   └── transactions/route.ts         # GET: Paginated transaction queries
│   └── r/
│       └── [slug]/
│           ├── page.tsx                   # Report overview page
│           ├── not-found.tsx              # 404 for invalid slugs
│           └── employer/
│               └── [employerKey]/
│                   └── page.tsx           # Employer detail page
├── components/
│   ├── upload-form.tsx                    # File upload + config form
│   ├── kpi-cards.tsx                      # Report headline metrics
│   ├── employers-table.tsx                # Interactive employer table
│   ├── transactions-table.tsx             # Paginated transaction table
│   ├── vendor-summary.tsx                 # Remittance vendor breakdown
│   ├── share-link.tsx                     # Copy-to-clipboard share link
│   └── ui/
│       ├── card.tsx                       # Card component
│       └── badge.tsx                      # Badge component
└── lib/
    ├── supabase.ts                        # Supabase client (server + browser)
    ├── utils.ts                           # Utility functions (cn, slug, format)
    ├── types.ts                           # Shared TypeScript types
    ├── parsing/
    │   ├── amount.ts                      # Currency string → cents conversion
    │   ├── timestamp.ts                   # Timestamp parsing
    │   ├── csv-parser.ts                  # CSV parsing with PapaParse
    │   └── location.ts                    # Address extraction & US classification
    ├── classification/
    │   ├── transaction-types.ts           # Transaction type grouping rules
    │   ├── remittance-vendors.ts          # Remittance vendor keyword rules
    │   └── employer-mapping.ts            # Employer mapping adapter layer
    ├── pipeline/
    │   ├── ingest.ts                      # Main ingestion pipeline
    │   └── store.ts                       # Database storage
    ├── queries/
    │   └── reports.ts                     # Server-side data fetching
    └── __tests__/
        ├── amount.test.ts                 # Amount parsing tests
        ├── location.test.ts               # Location & in_us tests
        ├── remittance-vendors.test.ts     # Vendor classification tests
        ├── employer-mapping.test.ts       # Employer mapping tests
        └── transaction-types.test.ts      # Transaction type tests
```

## Employer Mapping

### Official Source (Default)

By default, the tool fetches the employer mapping from the official GitHub repository:

```
https://raw.githubusercontent.com/standardholdingsllc/hubspot-address-mapper/main/web-app/data/customer_company.json
```

This mapping is maintained by Standard Holdings and contains the authoritative customer ID → employer name associations. The mapping is fetched fresh on each report generation to ensure you always have the latest data.

### Custom Mapping (Optional)

If you need to use a different mapping, you can upload a custom JSON file. The tool accepts three formats:

#### Format A: Direct Dictionary (Recommended)
```json
{
  "1960476": "Patterson Farms",
  "2022727": "App Farms",
  "2045582": "Hart-T-Trees"
}
```

#### Format B: Array of Records
```json
[
  { "customerId": "1960476", "employerName": "Patterson Farms" },
  { "customerId": "2022727", "employerName": "App Farms" }
]
```

#### Format C: Employer-Keyed with Nested Workers
```json
{
  "emp1": {
    "name": "Patterson Farms",
    "workers": ["1960476", "1960554", "1965578"]
  },
  "emp2": {
    "name": "App Farms",
    "customerIds": ["2022727", "2022743"]
  }
}
```

## Classification Rules

### Transaction Types
| Unit Type | Group |
|-----------|-------|
| purchaseTransaction | Card |
| atmTransaction | ATM |
| feeTransaction | Fee |
| bookTransaction | Book/Payment |
| wireTransaction, achTransaction | Transfer/Other |
| (unknown) | Other:\<rawType\> |

### Remittance Vendors
Detected via keyword matching on `summary` and `counterpartyName`:
RIA, Remitly, Intermex, Felix/Félix, Western Union, MoneyGram, Xoom, Wise, Pangea, Sendwave, WorldRemit, Sigue

Classification rules are versioned and stored per report so that historical report links remain stable when rules are updated.
