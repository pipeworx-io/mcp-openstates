interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * OpenStates MCP — bills, legislators, votes in all 50 US states
 *
 * Federal congress packs cover Washington; OpenStates covers the other 50
 * statehouses + DC + 5 territories. Indexed at the bill, person, vote, and
 * committee level.
 *
 * API: https://docs.openstates.org/api-v3/
 * Auth: header `X-API-KEY`. Free tier ~5,000 req/day.
 *
 * Tools:
 * - search_bills:       text + jurisdiction + session search
 * - get_bill:           single bill with versions, sponsors, votes
 * - search_legislators: filter by state, name, chamber, party
 * - get_legislator:     full record by OpenStates person ID
 */


const BASE_URL = 'https://v3.openstates.org';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_bills',
    description:
      'Search bills in any US statehouse. Pass jurisdiction as a 2-letter state code (e.g., "CA", "NY", "TX") or full name. Returns bill identifiers, titles, classifications, last action, sponsors, and OpenStates IDs for use with get_bill.',
    inputSchema: {
      type: 'object',
      properties: {
        jurisdiction: { type: 'string', description: '2-letter state code or jurisdiction name' },
        query: { type: 'string', description: 'Free-text search across title/summary' },
        session: { type: 'string', description: 'Session identifier (e.g., "20232024")' },
        classification: { type: 'string', description: 'bill | resolution | constitutional amendment | etc.' },
        sponsor: { type: 'string', description: 'Legislator name filter' },
        sort: {
          type: 'string',
          description: 'updated_desc | updated_asc | first_action_desc | first_action_asc | latest_action_desc | latest_action_asc',
        },
        per_page: { type: 'number', description: '1-50 (default 20)' },
        page: { type: 'number', description: '1-based page (default 1)' },
      },
      required: ['jurisdiction'],
    },
  },
  {
    name: 'get_bill',
    description:
      'Fetch a single bill with full detail: versions, sponsorships, related/companion bills, actions, and votes. Pass the OpenStates ID (e.g., "ocd-bill/abc...") or a state/session/identifier triple.',
    inputSchema: {
      type: 'object',
      properties: {
        openstates_id: { type: 'string', description: 'OpenStates bill ID (preferred, e.g., "ocd-bill/...")' },
        jurisdiction: { type: 'string', description: 'State code (use with session + identifier)' },
        session: { type: 'string', description: 'Session ID (use with jurisdiction + identifier)' },
        identifier: { type: 'string', description: 'Bill identifier within the session (e.g., "AB-123")' },
      },
      required: [],
    },
  },
  {
    name: 'search_legislators',
    description:
      'Find state legislators. Filter by jurisdiction, name, chamber (upper/lower), party, or district. Returns name, current/prior roles, party, contact details, OpenStates IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        jurisdiction: { type: 'string', description: '2-letter state code or name' },
        name: { type: 'string', description: 'Name fragment' },
        org_classification: { type: 'string', description: 'upper | lower | legislature' },
        district: { type: 'string', description: 'District identifier' },
        party: { type: 'string', description: 'Party name (e.g., "Democratic", "Republican")' },
        per_page: { type: 'number', description: '1-50 (default 20)' },
        page: { type: 'number', description: '1-based page' },
      },
      required: [],
    },
  },
  {
    name: 'get_legislator',
    description: 'Fetch a single legislator by OpenStates person ID. Returns biographical info, current roles, prior offices, contact methods, sources.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: { type: 'string', description: 'OpenStates person ID (e.g., "ocd-person/...")' },
      },
      required: ['person_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'OpenStates requires an API key. Contact the operator about platform credentials, or BYO via ?_apiKey=<key> after registering at https://openstates.org/account/profile/.',
    );
  }
  switch (name) {
    case 'search_bills':
      return searchBills(apiKey, args);
    case 'get_bill':
      return getBill(apiKey, args);
    case 'search_legislators':
      return searchLegislators(apiKey, args);
    case 'get_legislator':
      return getLegislator(apiKey, reqStr(args, 'person_id', '"ocd-person/..."'));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing or empty. Pass a string like ${example}.`);
  }
  return v;
}

async function osFetch<T>(apiKey: string, path: string, params: URLSearchParams): Promise<T> {
  const url = `${BASE_URL}${path}${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('OpenStates: unauthorized — check the API key');
  if (res.status === 404) throw new Error('OpenStates: not found (HTTP 404)');
  if (res.status === 429) throw new Error('OpenStates: rate-limit (HTTP 429) — free tier ~5k req/day');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenStates error: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface OsBill {
  id?: string;
  identifier?: string;
  title?: string;
  jurisdiction?: { id?: string; name?: string };
  session?: string;
  classification?: string[];
  subject?: string[];
  from_organization?: { name?: string; classification?: string };
  latest_action_date?: string;
  latest_action_description?: string;
  openstates_url?: string;
  sources?: { url?: string }[];
  sponsorships?: { name?: string; classification?: string; primary?: boolean; person?: { id?: string; name?: string } }[];
  versions?: { date?: string; note?: string; links?: { url?: string; media_type?: string }[] }[];
  actions?: { date?: string; description?: string; classification?: string[] }[];
  votes?: { id?: string; motion_text?: string; start_date?: string; result?: string; counts?: { option?: string; value?: number }[] }[];
}

function normalizeBill(b: OsBill, full = false) {
  const base: Record<string, unknown> = {
    openstates_id: b.id ?? null,
    identifier: b.identifier ?? null,
    title: b.title ?? null,
    jurisdiction: b.jurisdiction?.name ?? null,
    session: b.session ?? null,
    classification: b.classification ?? [],
    subject: b.subject ?? [],
    chamber: b.from_organization?.classification ?? b.from_organization?.name ?? null,
    latest_action_date: b.latest_action_date ?? null,
    latest_action: b.latest_action_description ?? null,
    openstates_url: b.openstates_url ?? null,
  };
  if (full) {
    base.sponsors = (b.sponsorships ?? []).map((s) => ({
      name: s.name ?? null,
      person_id: s.person?.id ?? null,
      classification: s.classification ?? null,
      primary: s.primary ?? null,
    }));
    base.versions = (b.versions ?? []).map((v) => ({
      date: v.date ?? null,
      note: v.note ?? null,
      links: (v.links ?? []).map((l) => ({ url: l.url ?? null, media_type: l.media_type ?? null })),
    }));
    base.actions = (b.actions ?? []).map((a) => ({
      date: a.date ?? null,
      description: a.description ?? null,
      classification: a.classification ?? [],
    }));
    base.votes = (b.votes ?? []).map((v) => ({
      id: v.id ?? null,
      motion: v.motion_text ?? null,
      start_date: v.start_date ?? null,
      result: v.result ?? null,
      counts: v.counts ?? [],
    }));
    base.sources = (b.sources ?? []).map((s) => s.url).filter(Boolean);
  }
  return base;
}

async function searchBills(apiKey: string, args: Record<string, unknown>) {
  const params = new URLSearchParams({
    jurisdiction: String(args.jurisdiction),
    per_page: String(Math.min(50, Math.max(1, (args.per_page as number) ?? 20))),
    page: String(Math.max(1, (args.page as number) ?? 1)),
  });
  if (args.query) params.set('q', String(args.query));
  if (args.session) params.set('session', String(args.session));
  if (args.classification) params.set('classification', String(args.classification));
  if (args.sponsor) params.set('sponsor', String(args.sponsor));
  if (args.sort) params.set('sort', String(args.sort));

  const data = await osFetch<{
    results?: OsBill[];
    pagination?: { total_items?: number; total_pages?: number; page?: number };
  }>(apiKey, '/bills', params);

  return {
    total: data.pagination?.total_items ?? 0,
    page: data.pagination?.page ?? null,
    total_pages: data.pagination?.total_pages ?? null,
    returned: data.results?.length ?? 0,
    bills: (data.results ?? []).map((b) => normalizeBill(b, false)),
  };
}

async function getBill(apiKey: string, args: Record<string, unknown>) {
  const id = (args.openstates_id as string | undefined)?.trim();
  const params = new URLSearchParams({ include: 'sponsorships,actions,votes,versions,sources,abstracts' });

  if (id) {
    const data = await osFetch<OsBill>(apiKey, `/bills/${encodeURIComponent(id)}`, params);
    return normalizeBill(data, true);
  }
  const jurisdiction = (args.jurisdiction as string | undefined)?.trim();
  const session = (args.session as string | undefined)?.trim();
  const identifier = (args.identifier as string | undefined)?.trim();
  if (!jurisdiction || !session || !identifier) {
    throw new Error('Pass either openstates_id, OR all three of jurisdiction + session + identifier.');
  }
  const data = await osFetch<OsBill>(
    apiKey,
    `/bills/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(session)}/${encodeURIComponent(identifier)}`,
    params,
  );
  return normalizeBill(data, true);
}

interface OsPerson {
  id?: string;
  name?: string;
  family_name?: string;
  given_name?: string;
  party?: string;
  current_role?: { title?: string; org_classification?: string; district?: string; division_id?: string };
  jurisdiction?: { id?: string; name?: string };
  birth_date?: string;
  death_date?: string;
  gender?: string;
  image?: string;
  email?: string;
  links?: { url?: string; note?: string }[];
  sources?: { url?: string }[];
  offices?: { name?: string; classification?: string; address?: string; voice?: string; email?: string }[];
  openstates_url?: string;
  other_names?: { name?: string }[];
}

function normalizeLegislator(p: OsPerson, full = false) {
  const base: Record<string, unknown> = {
    person_id: p.id ?? null,
    name: p.name ?? null,
    party: p.party ?? null,
    jurisdiction: p.jurisdiction?.name ?? null,
    chamber: p.current_role?.org_classification ?? null,
    district: p.current_role?.district ?? null,
    title: p.current_role?.title ?? null,
    image: p.image ?? null,
    email: p.email ?? null,
    openstates_url: p.openstates_url ?? null,
  };
  if (full) {
    base.given_name = p.given_name ?? null;
    base.family_name = p.family_name ?? null;
    base.gender = p.gender ?? null;
    base.birth_date = p.birth_date ?? null;
    base.death_date = p.death_date ?? null;
    base.other_names = (p.other_names ?? []).map((n) => n.name).filter(Boolean);
    base.offices = (p.offices ?? []).map((o) => ({
      name: o.name ?? null,
      classification: o.classification ?? null,
      address: o.address ?? null,
      voice: o.voice ?? null,
      email: o.email ?? null,
    }));
    base.links = (p.links ?? []).map((l) => ({ url: l.url ?? null, note: l.note ?? null }));
    base.sources = (p.sources ?? []).map((s) => s.url).filter(Boolean);
  }
  return base;
}

async function searchLegislators(apiKey: string, args: Record<string, unknown>) {
  const params = new URLSearchParams({
    per_page: String(Math.min(50, Math.max(1, (args.per_page as number) ?? 20))),
    page: String(Math.max(1, (args.page as number) ?? 1)),
  });
  if (args.jurisdiction) params.set('jurisdiction', String(args.jurisdiction));
  if (args.name) params.set('name', String(args.name));
  if (args.org_classification) params.set('org_classification', String(args.org_classification));
  if (args.district) params.set('district', String(args.district));
  if (args.party) params.set('party', String(args.party));

  const data = await osFetch<{
    results?: OsPerson[];
    pagination?: { total_items?: number; total_pages?: number; page?: number };
  }>(apiKey, '/people', params);

  return {
    total: data.pagination?.total_items ?? 0,
    page: data.pagination?.page ?? null,
    total_pages: data.pagination?.total_pages ?? null,
    returned: data.results?.length ?? 0,
    legislators: (data.results ?? []).map((p) => normalizeLegislator(p, false)),
  };
}

async function getLegislator(apiKey: string, personId: string) {
  const params = new URLSearchParams({ include: 'other_names,offices,sources,links' });
  const data = await osFetch<OsPerson>(apiKey, `/people/${encodeURIComponent(personId)}`, params);
  return normalizeLegislator(data, true);
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
